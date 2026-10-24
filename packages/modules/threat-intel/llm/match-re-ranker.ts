import { Injectable, Logger } from "@nestjs/common";
import { ChatModelResolver } from "@modules/llm/chat-model.resolver";
import { ChatModelPort } from "@modules/llm/chat-model.port";

/** LLM scope bound to the threat-intel re-ranker connection. */
export const THREAT_INTEL_LLM_SCOPE = "threat-intel";

/**
 * A single project entity that the intel item is checked against.
 *
 * The host builds these from its project security profile. Examples:
 * "next@14.0.0", "postgres@15", "aws", "cloudflare", "example.com".
 */
export interface ProfileEntity {
  /** Entity label, e.g. package name with version, vendor, domain. */
  value: string;
  /** Optional human-readable context shown in the prompt. */
  context?: string;
}

/** Per-entity match result emitted by the LLM re-ranker. */
export interface EntityMatchResult {
  entity: string;
  matched: boolean;
  evidence: string | null;
}

/**
 * Structured verdict from the LLM re-ranker. The system enforces the
 * hard constraint: finalRelevant === true requires at least one
 * entityMatches[i].matched === true. semanticMatch alone never passes.
 */
export interface ReRankVerdict {
  entityMatches: EntityMatchResult[];
  semanticMatch: boolean;
  finalRelevant: boolean;
  reason: string;
}

const SYSTEM_PROMPT = `You are a threat intelligence relevance judge.
Given a threat intel item and a list of project entities, decide whether
the item affects the project.

Rules:
- For each entity, set matched=true ONLY when the item explicitly mentions
  that entity (package name, vendor, product, domain) in a way that implies
  impact. Version ranges count as matches when the entity version falls in.
- semanticMatch=true means the item is topically related to the entity's
  domain, but NOT necessarily that this specific entity is affected.
- finalRelevant MUST be true only if at least one entity has matched=true.
  semanticMatch alone is NOT enough to set finalRelevant=true.
- Output strict JSON matching the requested schema. No markdown.`;

/**
 * LLM-backed re-ranker for candidates that survived hard rule recall.
 *
 * Implements the B3 protocol from ADR-031: the LLM never decides freely;
 * it must emit per-entity match verdicts, and the caller enforces the
 * finalRelevant hard constraint. This prevents the "LLM泛化放过无关新闻"
 * failure (experience 1342209).
 */
@Injectable()
export class MatchReRanker {
  private readonly logger = new Logger(MatchReRanker.name);

  constructor(private readonly resolver: ChatModelResolver) {}

  async reRank(item: { title: string; summary?: string }, entities: ProfileEntity[]): Promise<ReRankVerdict> {
    if (entities.length === 0) {
      return {
        entityMatches: [],
        semanticMatch: false,
        finalRelevant: false,
        reason: "No project entities to match against.",
      };
    }

    const userContent = JSON.stringify({
      item: { title: item.title, summary: item.summary ?? null },
      entities: entities.map((e) => ({ value: e.value, context: e.context ?? null })),
    });

    let chatModel: ChatModelPort;
    try {
      chatModel = await this.resolver.resolve(THREAT_INTEL_LLM_SCOPE);
    } catch (error) {
      this.logger.warn(
        `Cannot resolve LLM scope "${THREAT_INTEL_LLM_SCOPE}": ${error instanceof Error ? error.message : String(error)}. Falling back to not-relevant.`,
      );
      return {
        entityMatches: entities.map((e) => ({ entity: e.value, matched: false, evidence: null })),
        semanticMatch: false,
        finalRelevant: false,
        reason: "LLM scope not bound; defaulted to not relevant.",
      };
    }

    try {
      const result = await chatModel.complete({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        responseFormat: "json",
        temperature: 0,
      });

      const verdict = this.parseVerdict(result.text);
      return this.enforceHardConstraint(verdict, entities);
    } catch (error) {
      this.logger.warn(
        `LLM re-rank failed, falling back to not-relevant: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        entityMatches: entities.map((e) => ({ entity: e.value, matched: false, evidence: null })),
        semanticMatch: false,
        finalRelevant: false,
        reason: "LLM re-rank failed; defaulted to not relevant.",
      };
    }
  }

  private parseVerdict(text: string): ReRankVerdict {
    const parsed = JSON.parse(text);
    if (
      !parsed ||
      !Array.isArray(parsed.entityMatches) ||
      typeof parsed.semanticMatch !== "boolean" ||
      typeof parsed.finalRelevant !== "boolean" ||
      typeof parsed.reason !== "string"
    ) {
      throw new Error("LLM re-rank output does not match the verdict schema.");
    }
    return {
      entityMatches: parsed.entityMatches.map((m: { entity: string; matched: boolean; evidence: string | null }) => ({
        entity: String(m.entity),
        matched: Boolean(m.matched),
        evidence: m.evidence == null ? null : String(m.evidence),
      })),
      semanticMatch: Boolean(parsed.semanticMatch),
      finalRelevant: Boolean(parsed.finalRelevant),
      reason: String(parsed.reason),
    };
  }

  /**
   * Enforce the B3 hard constraint: finalRelevant requires at least one
   * entity match. We do not trust the LLM's own finalRelevant flag alone.
   */
  private enforceHardConstraint(verdict: ReRankVerdict, entities: ProfileEntity[]): ReRankVerdict {
    const hasEntityMatch = verdict.entityMatches.some((m) => m.matched);
    if (!hasEntityMatch) {
      return { ...verdict, finalRelevant: false };
    }
    // Defensive: if the LLM returned entityMatches with different entity
    // labels than we sent, fall back to not relevant to avoid silent
    // mismatches.
    const sentLabels = new Set(entities.map((e) => e.value));
    const returnedLabels = new Set(verdict.entityMatches.map((m) => m.entity));
    for (const label of returnedLabels) {
      if (!sentLabels.has(label)) {
        return {
          entityMatches: entities.map((e) => ({ entity: e.value, matched: false, evidence: null })),
          semanticMatch: false,
          finalRelevant: false,
          reason: "LLM returned entities not in the input profile; rejected as unsafe.",
        };
      }
    }
    return verdict;
  }
}
