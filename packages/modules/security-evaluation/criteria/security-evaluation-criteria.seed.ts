import { ConflictException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { EvaluationCriteriaService } from "@modules/evaluation/evaluation-criteria.service";

import {
  SECURITY_EVALUATION_CLOUD_CONFIG_CRITERIA_VERSION,
  SECURITY_EVALUATION_DEPENDENCY_CRITERIA_VERSION,
  SECURITY_EVALUATION_DEPENDENCY_CRITERION_KEY,
  SECURITY_EVALUATION_FAMILY_CLOUD_CONFIGURATION,
  SECURITY_EVALUATION_FAMILY_DEPENDENCY,
  SECURITY_EVALUATION_SUBJECT_KIND_CLOUD_ACCOUNT,
  SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
} from "../security-evaluation.constants";
import {
  SECURITY_EVALUATION_CLOUD_CONFIG_BENCHMARK,
  SECURITY_EVALUATION_CLOUD_CONFIG_RULEBOOK,
} from "../judgment/cloud-config/security-evaluation-cloud-config.rulebook";

interface CriterionSeed {
  criterionKey: string;
  name: string;
  description: string;
  metadata: Record<string, unknown>;
}

interface BaselineSeed {
  kind: string;
  family: string;
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
      family: SECURITY_EVALUATION_FAMILY_DEPENDENCY,
      version: SECURITY_EVALUATION_DEPENDENCY_CRITERIA_VERSION,
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
    await this.ensureBaseline({
      kind: SECURITY_EVALUATION_SUBJECT_KIND_CLOUD_ACCOUNT,
      family: SECURITY_EVALUATION_FAMILY_CLOUD_CONFIGURATION,
      version: SECURITY_EVALUATION_CLOUD_CONFIG_CRITERIA_VERSION,
      description: `${SECURITY_EVALUATION_CLOUD_CONFIG_BENCHMARK}: collected account configuration facts are asserted per control.`,
      metadata: { benchmark: SECURITY_EVALUATION_CLOUD_CONFIG_BENCHMARK },
      criteria: SECURITY_EVALUATION_CLOUD_CONFIG_RULEBOOK.map((entry) => ({
        criterionKey: entry.criterionKey,
        name: entry.name,
        description: `${SECURITY_EVALUATION_CLOUD_CONFIG_BENCHMARK} control ${entry.controlId}.`,
        metadata: {
          controlId: entry.controlId,
          severity: entry.severity,
          remediation: entry.remediation,
          factRequirements: [...entry.requiredFactTypes],
          benchmark: SECURITY_EVALUATION_CLOUD_CONFIG_BENCHMARK,
        },
      })),
    });
  }

  private async ensureAllBaselines(): Promise<void> {
    await this.ensureDependencyBaseline();
    await this.ensureCloudConfigBaseline();
  }

  private async ensureBaseline(baseline: BaselineSeed): Promise<void> {
    const seedKey = `${baseline.kind}/${baseline.family}/${baseline.version}`;
    if (this.seededFamilies.has(seedKey)) return;

    let row = await this.findVersion(baseline.kind, baseline.family, baseline.version);
    if (!row) {
      try {
        row = await this.criteria.createVersion({
          kind: baseline.kind,
          family: baseline.family,
          version: baseline.version,
          description: baseline.description,
          metadata: baseline.metadata,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        row = await this.findVersion(baseline.kind, baseline.family, baseline.version);
        if (!row) throw error;
      }
    }

    const criterionCount = await this.prisma.evaluationCriterion.count({
      where: { criteriaVersionId: row.id },
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

    const latest = await this.findVersion(baseline.kind, baseline.family, baseline.version);
    if (!latest) {
      throw new Error(
        `Criteria version ${baseline.kind}/${baseline.family}/${baseline.version} disappeared during seeding`,
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

  private findVersion(kind: string, family: string, version: string) {
    return this.prisma.evaluationCriteriaVersion.findFirst({ where: { kind, family, version } });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
