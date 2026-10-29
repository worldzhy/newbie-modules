import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type {
  EvaluationFindingCandidate,
  EvaluationFindingSeverity,
} from "@modules/evaluation/ports/evaluation.contracts";
import type { EvaluationJudgment, JudgmentInput } from "@modules/evaluation/ports/judgment.port";

import {
  SECURITY_EVALUATION_KEY_THREAT_INTEL,
  SECURITY_EVALUATION_INTELLIGENCE_CRITERION_KEY,
} from "../../security-evaluation.constants";
import { SecurityEvaluationKnowledgeSeverity } from "../../knowledge/security-evaluation-knowledge.constants";
import {
  SecurityEvaluationScopeEntitiesProvider,
  SECURITY_EVALUATION_SCOPE_ENTITIES_PROVIDER,
} from "./security-evaluation-scope-entities.port";
import { SecurityEvaluationIntelMatchService } from "./security-evaluation-intel-match.service";

const SEVERITY_TO_FINDING: Record<SecurityEvaluationKnowledgeSeverity, EvaluationFindingSeverity> = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
  info: "INFO",
};

/**
 * INTEL judgment (ADR-039) — recent threat-intel knowledge items matched
 * against the subject's scope entity set.
 *
 * Hard entity recall fires a finding directly (confidence high, verdictSource
 * "hard-recall"); otherwise the LLM re-ranks candidates that pass the
 * severity/signal threshold. Non-relevant LLM verdicts are negative-cached
 * per (item, scope) so they are not retried; unavailable verdicts are never
 * cached (ADR-018).
 */
@Injectable()
export class SecurityEvaluationIntelJudgment {
  private readonly logger = new Logger(SecurityEvaluationIntelJudgment.name);

  constructor(
    private readonly matchService: SecurityEvaluationIntelMatchService,
    @Optional()
    @Inject(SECURITY_EVALUATION_SCOPE_ENTITIES_PROVIDER)
    private readonly scopeEntitiesProvider: SecurityEvaluationScopeEntitiesProvider | undefined,
  ) {}

  async judge(input: JudgmentInput): Promise<EvaluationJudgment> {
    if (input.ruleSetVersion.evaluationKey !== SECURITY_EVALUATION_KEY_THREAT_INTEL) {
      return { verdicts: [], findings: [], evaluatedRefs: [] };
    }

    if (!this.scopeEntitiesProvider) {
      this.logger.warn("ScopeEntitiesProvider is not bound; INTEL judgment produces no findings.");
      return { verdicts: [], findings: [], evaluatedRefs: [] };
    }

    const scopes = await this.scopeEntitiesProvider.listScopeEntities();
    const scope = scopes.find((s) => s.scopeType === input.subject.scopeType && s.scopeId === input.subject.scopeId);
    if (!scope || scope.entities.length === 0) {
      return { verdicts: [], findings: [], evaluatedRefs: [] };
    }

    const matches = await this.matchService.matchScope(scope);
    const findings: EvaluationFindingCandidate[] = matches.map((match) => this.toFinding(match));

    return {
      verdicts: [],
      findings,
      // INTEL matching does not consume skeleton evidence items; the
      // knowledge store is the evidence layer. Returning empty evaluatedRefs
      // keeps the coverage invariant satisfied (ADR-020).
      evaluatedRefs: [],
      metadata: { matchedCount: matches.length, scopeEntities: scope.entities.length },
    };
  }

  private toFinding(match: {
    itemId: string;
    itemTitle: string;
    itemSeverity: string;
    matchedEntity: string;
    confidence: string;
    evidence: string | null;
    verdictSource: "hard-recall" | "llm";
  }): EvaluationFindingCandidate {
    const severity = SEVERITY_TO_FINDING[match.itemSeverity as SecurityEvaluationKnowledgeSeverity] ?? "MEDIUM";
    return {
      criterionKey: SECURITY_EVALUATION_INTELLIGENCE_CRITERION_KEY,
      fingerprint: `threat-intel:${match.itemId}:${match.matchedEntity}`,
      severity,
      title: match.itemTitle,
      detail: match.evidence ?? undefined,
      metadata: {
        knowledgeItemId: match.itemId,
        matchedEntity: match.matchedEntity,
        confidence: match.confidence,
        verdictSource: match.verdictSource,
      },
    };
  }
}
