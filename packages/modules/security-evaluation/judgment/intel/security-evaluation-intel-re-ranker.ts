import { Injectable, Logger } from "@nestjs/common";
import { ChatModelResolver } from "@modules/llm/chat-model.resolver";
import { ChatModelPort } from "@modules/llm/chat-model.port";
import { buildSecurityEvaluationIntelReRankRequest } from "./security-evaluation-intel-request";
import { SecurityEvaluationScopeEntity } from "./security-evaluation-scope-entities.port";

/** LLM scope bound to the security-evaluation INTEL match connection. */
export const SECURITY_EVALUATION_INTEL_LLM_SCOPE = "security-evaluation-intel";

/** Per-entity match result emitted by the LLM re-ranker. */
export interface SecurityEvaluationEntityMatchResult {
  entity: string;
  matched: boolean;
  evidence: string | null;
}

/**
 * How the verdict was reached. The caller negative-caches only explicit
 * "not-relevant" outcomes; "unavailable" means the LLM could not judge at
 * all (scope unbound, call failed, malformed output) and the pair must be
 * retried on a later run instead of being cached as a negative.
 */
export type SecurityEvaluationReRankVerdictKind = "relevant" | "not-relevant" | "unavailable";

/**
 * Structured verdict from the LLM re-ranker. The system enforces the
 * hard constraint: finalRelevant === true requires at least one
 * entityMatches[i].matched === true. semanticMatch alone never passes.
 */
export interface SecurityEvaluationReRankVerdict {
  kind: SecurityEvaluationReRankVerdictKind;
  entityMatches: SecurityEvaluationEntityMatchResult[];
  semanticMatch: boolean;
  finalRelevant: boolean;
  reason: string;
  /**
   * Content address of the request that produced this verdict (ADR-045,
   * R6-09). Null when no request was sent, so nothing may be cached under it.
   */
  signature: string | null;
}

/**
 * LLM-backed re-ranker for INTEL candidates that survived hard rule recall.
 *
 * Implements the B3 matching protocol (ADR-018): the LLM never decides
 * freely; it must emit per-entity match verdicts, and the caller enforces
 * the finalRelevant hard constraint.
 */
@Injectable()
export class SecurityEvaluationIntelReRanker {
  private readonly logger = new Logger(SecurityEvaluationIntelReRanker.name);

  constructor(private readonly resolver: ChatModelResolver) {}

  /**
   * The model bound to the INTEL scope, or null when the scope cannot be
   * resolved. The collection layer needs it to compute the same cache
   * signature the judgment will record (ADR-045, R6-09).
   */
  async currentModelId(): Promise<string | null> {
    try {
      return (await this.resolver.resolve(SECURITY_EVALUATION_INTEL_LLM_SCOPE)).modelId;
    } catch {
      return null;
    }
  }

  async reRank(
    item: { title: string; summary?: string },
    entities: SecurityEvaluationScopeEntity[],
  ): Promise<SecurityEvaluationReRankVerdict> {
    if (entities.length === 0) {
      return {
        kind: "not-relevant",
        entityMatches: [],
        semanticMatch: false,
        finalRelevant: false,
        reason: "No project entities to match against.",
        signature: null,
      };
    }

    let chatModel: ChatModelPort;
    try {
      chatModel = await this.resolver.resolve(SECURITY_EVALUATION_INTEL_LLM_SCOPE);
    } catch (error) {
      this.logger.warn(
        `Cannot resolve LLM scope "${SECURITY_EVALUATION_INTEL_LLM_SCOPE}": ${
          error instanceof Error ? error.message : String(error)
        }.`,
      );
      return {
        kind: "unavailable",
        entityMatches: entities.map((e) => ({ entity: e.value, matched: false, evidence: null })),
        semanticMatch: false,
        finalRelevant: false,
        reason: "LLM scope not bound.",
        signature: null,
      };
    }

    // The request and its signature are built together so the hash covers
    // exactly the bytes sent to the model.
    const request = buildSecurityEvaluationIntelReRankRequest(item, entities, chatModel.modelId);

    try {
      const result = await chatModel.complete({
        messages: request.messages,
        responseFormat: request.responseFormat,
        temperature: request.temperature,
      });

      const verdict = this.parseVerdict(result.text, request.signature);
      return this.enforceHardConstraint(verdict, entities);
    } catch (error) {
      this.logger.warn(`LLM re-rank failed: ${error instanceof Error ? error.message : String(error)}`);
      return {
        kind: "unavailable",
        entityMatches: entities.map((e) => ({ entity: e.value, matched: false, evidence: null })),
        semanticMatch: false,
        finalRelevant: false,
        reason: "LLM re-rank failed.",
        signature: null,
      };
    }
  }

  private parseVerdict(text: string, signature: string): SecurityEvaluationReRankVerdict {
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
      kind: parsed.finalRelevant === true ? "relevant" : "not-relevant",
      entityMatches: parsed.entityMatches.map((m: { entity: string; matched: boolean; evidence: string | null }) => ({
        entity: String(m.entity),
        matched: Boolean(m.matched),
        evidence: m.evidence == null ? null : String(m.evidence),
      })),
      semanticMatch: Boolean(parsed.semanticMatch),
      finalRelevant: Boolean(parsed.finalRelevant),
      reason: String(parsed.reason),
      signature,
    };
  }

  /**
   * Enforce the B3 hard constraint: finalRelevant requires at least one
   * entity match. We do not trust the LLM's own finalRelevant flag alone.
   */
  private enforceHardConstraint(
    verdict: SecurityEvaluationReRankVerdict,
    entities: SecurityEvaluationScopeEntity[],
  ): SecurityEvaluationReRankVerdict {
    const hasEntityMatch = verdict.entityMatches.some((m) => m.matched);
    if (!hasEntityMatch) {
      return { ...verdict, kind: "not-relevant", finalRelevant: false };
    }
    const sentLabels = new Set(entities.map((e) => e.value.toLowerCase()));
    const returnedLabels = new Set(verdict.entityMatches.map((m) => m.entity.toLowerCase()));
    for (const label of returnedLabels) {
      if (!sentLabels.has(label)) {
        // An output naming entities the caller never sent is not evidence of
        // "not relevant" — it is an untrustworthy judgment. Do not cache it.
        return {
          kind: "unavailable",
          entityMatches: entities.map((e) => ({ entity: e.value, matched: false, evidence: null })),
          semanticMatch: false,
          finalRelevant: false,
          reason: "LLM returned entities not in the input profile; rejected as unavailable.",
          signature: null,
        };
      }
    }
    return { ...verdict, kind: verdict.finalRelevant ? "relevant" : "not-relevant" };
  }
}
