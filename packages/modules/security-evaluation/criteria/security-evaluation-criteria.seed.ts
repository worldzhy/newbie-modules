import { ConflictException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { EvaluationCriteriaService } from "@modules/evaluation/evaluation-criteria.service";

import {
  SECURITY_EVALUATION_AWS_CIS_RULE_SET_VERSION,
  SECURITY_EVALUATION_AWS_CUSTOM_RULE_SET_VERSION,
  SECURITY_EVALUATION_DEPENDENCY_RULE_SET_VERSION,
  SECURITY_EVALUATION_DEPENDENCY_CRITERION_KEY,
  SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
  SECURITY_EVALUATION_KEY_AWS_CUSTOM,
  SECURITY_EVALUATION_KEY_NPM_OSV,
  SECURITY_EVALUATION_KEY_THREAT_INTEL,
  SECURITY_EVALUATION_INTELLIGENCE_RULE_SET_VERSION,
  SECURITY_EVALUATION_INTELLIGENCE_CRITERION_KEY,
  SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT,
  SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
} from "../security-evaluation.constants";
import {
  SECURITY_EVALUATION_AWS_CIS_BENCHMARK,
  SECURITY_EVALUATION_AWS_CONFIG_RULEBOOK,
} from "../judgment/aws-config/security-evaluation-cloud-config.rulebook";

interface CriterionSeed {
  criterionKey: string;
  name: string;
  description: string;
  metadata: Record<string, unknown>;
}

interface BaselineSeed {
  kind: string;
  evaluationKey: string;
  version: string;
  description: string;
  metadata: Record<string, unknown>;
  criteria: CriterionSeed[];
}

/**
 * SecurityEvaluationCriteriaSeed — code-defined criteria, published once.
 *
 * Criteria content is part of this build, not admin data, and the version
 * string is the only thing that changes when the rules change. Seeding is
 * idempotent and safe under concurrent instances (unique-violation and
 * already-published races are absorbed), and it is retried lazily if the first
 * attempt failed — e.g. before the consumer has pushed the schema.
 */
@Injectable()
export class SecurityEvaluationCriteriaSeed implements OnModuleInit {
  private readonly logger = new Logger(SecurityEvaluationCriteriaSeed.name);
  private readonly seededFamilies = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly criteria: EvaluationCriteriaService,
  ) {}

  onModuleInit(): void {
    void this.ensureAllBaselines().catch((error: unknown) => {
      this.logger.warn(`Criteria baselines not seeded yet: ${describe(error)}`);
    });
  }

  async ensureDependencyBaseline(): Promise<void> {
    await this.ensureBaseline({
      kind: SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
      evaluationKey: SECURITY_EVALUATION_KEY_NPM_OSV,
      version: SECURITY_EVALUATION_DEPENDENCY_RULE_SET_VERSION,
      description: "Dependency vulnerability baseline: installed npm packages are matched against OSV.",
      metadata: { ecosystem: "npm", dataSource: "https://osv.dev" },
      criteria: [
        {
          criterionKey: SECURITY_EVALUATION_DEPENDENCY_CRITERION_KEY,
          name: "Vulnerable dependency",
          description: "An installed npm package version is listed as affected by an OSV vulnerability.",
          metadata: { ecosystem: "npm", dataSource: "https://osv.dev" },
        },
      ],
    });
  }

  /** CIS AWS Foundations Benchmark v1.5 initial set (ADR-027 D3). */
  async ensureCloudConfigBaseline(): Promise<void> {
    const entries = SECURITY_EVALUATION_AWS_CONFIG_RULEBOOK.filter(
      (entry) => entry.evaluationKey === SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
    );
    await this.ensureBaseline({
      kind: SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT,
      evaluationKey: SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
      version: SECURITY_EVALUATION_AWS_CIS_RULE_SET_VERSION,
      description: `${SECURITY_EVALUATION_AWS_CIS_BENCHMARK}: collected account configuration items are asserted per control.`,
      metadata: { benchmark: SECURITY_EVALUATION_AWS_CIS_BENCHMARK },
      criteria: entries.map((entry) => ({
        criterionKey: entry.criterionKey,
        name: entry.name,
        description: `${SECURITY_EVALUATION_AWS_CIS_BENCHMARK} control ${entry.controlId}.`,
        metadata: {
          controlId: entry.controlId,
          severity: entry.severity,
          remediation: entry.remediation,
          knowledgeRequirements: [...entry.requiredKnowledgeTypes],
          benchmark: SECURITY_EVALUATION_AWS_CIS_BENCHMARK,
        },
      })),
    });
  }

  /** aws-custom rules inherited from the predecessor aws-audit module (ADR-033/ADR-037). */
  async ensureCloudCustomBaseline(): Promise<void> {
    const entries = SECURITY_EVALUATION_AWS_CONFIG_RULEBOOK.filter(
      (entry) => entry.evaluationKey === SECURITY_EVALUATION_KEY_AWS_CUSTOM,
    );
    await this.ensureBaseline({
      kind: SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT,
      evaluationKey: SECURITY_EVALUATION_KEY_AWS_CUSTOM,
      version: SECURITY_EVALUATION_AWS_CUSTOM_RULE_SET_VERSION,
      description:
        "aws-custom: non-benchmark cloud configuration checks (access keys, IAM policies, RDS/S3/EC2 hardening) inherited from the predecessor aws-audit module.",
      metadata: { benchmark: null },
      criteria: entries.map((entry) => ({
        criterionKey: entry.criterionKey,
        name: entry.name,
        description: entry.remediation,
        metadata: {
          severity: entry.severity,
          remediation: entry.remediation,
          knowledgeRequirements: [...entry.requiredKnowledgeTypes],
        },
      })),
    });
  }

  /** INTEL criteria: recent threat-intel items matched to the subject's scope (ADR-039). */
  async ensureIntelligenceBaseline(): Promise<void> {
    await this.ensureBaseline({
      kind: SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
      evaluationKey: SECURITY_EVALUATION_KEY_THREAT_INTEL,
      version: SECURITY_EVALUATION_INTELLIGENCE_RULE_SET_VERSION,
      description:
        "Threat-intel relevance: recently collected threat-intelligence items are matched against the subject's scope entity set (hard entity recall + LLM structured re-rank).",
      metadata: { matchProtocol: "b3-hard-recall-plus-llm-rerank", negativeCache: "per-item-per-scope" },
      criteria: [
        {
          criterionKey: SECURITY_EVALUATION_INTELLIGENCE_CRITERION_KEY,
          name: "Threat exposure",
          description:
            "A recently collected threat-intel item affects the subject's scope (matched entity or LLM-confirmed relevance).",
          metadata: { verdictSources: ["hard-recall", "llm"] },
        },
      ],
    });
  }

  private async ensureAllBaselines(): Promise<void> {
    await this.ensureDependencyBaseline();
    await this.ensureCloudConfigBaseline();
    await this.ensureCloudCustomBaseline();
    await this.ensureIntelligenceBaseline();
  }

  private async ensureBaseline(baseline: BaselineSeed): Promise<void> {
    const seedKey = `${baseline.kind}/${baseline.evaluationKey}/${baseline.version}`;
    if (this.seededFamilies.has(seedKey)) return;

    let row = await this.findVersion(baseline.kind, baseline.evaluationKey, baseline.version);
    if (!row) {
      try {
        row = await this.criteria.createVersion({
          kind: baseline.kind,
          evaluationKey: baseline.evaluationKey,
          version: baseline.version,
          description: baseline.description,
          metadata: baseline.metadata,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        row = await this.findVersion(baseline.kind, baseline.evaluationKey, baseline.version);
        if (!row) throw error;
      }
    }

    const criterionCount = await this.prisma.evaluationCriterion.count({
      where: { ruleSetVersionId: row.id },
    });
    if (criterionCount === 0) {
      for (const criterion of baseline.criteria) {
        try {
          await this.criteria.addCriterion(row.id, { kind: "ASSERTION", ...criterion });
        } catch (error) {
          // A concurrent instance added the criterion first; that is the goal.
          if (!isUniqueViolation(error)) throw error;
        }
      }
    }

    const latest = await this.findVersion(baseline.kind, baseline.evaluationKey, baseline.version);
    if (!latest) {
      throw new Error(
        `Criteria version ${baseline.kind}/${baseline.evaluationKey}/${baseline.version} disappeared during seeding`,
      );
    }
    if (!latest.publishedAt) {
      try {
        await this.criteria.publishVersion(latest.id);
      } catch (error) {
        // Published concurrently; a later read proves the published row exists.
        if (!(error instanceof ConflictException)) throw error;
      }
    }
    this.seededFamilies.add(seedKey);
  }

  private findVersion(kind: string, evaluationKey: string, version: string) {
    return this.prisma.evaluationRuleSetVersion.findFirst({ where: { kind, evaluationKey, version } });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
