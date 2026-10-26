import { ConflictException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { EvaluationCriteriaService } from "@modules/evaluation/evaluation-criteria.service";

import {
  SECURITY_EVALUATION_DEPENDENCY_CRITERIA_VERSION,
  SECURITY_EVALUATION_DEPENDENCY_CRITERION_KEY,
  SECURITY_EVALUATION_FAMILY_DEPENDENCY,
  SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
} from "../security-evaluation.constants";

/**
 * SecurityEvaluationCriteriaSeed — code-defined criteria, published once.
 *
 * Criteria content is part of this build, not admin data: the dependency
 * baseline is a single ASSERTION criterion, and the version string is the only
 * thing that changes when the rules change. Seeding is idempotent and safe
 * under concurrent instances (unique-violation and already-published races are
 * absorbed), and it is retried lazily if the first attempt failed — e.g. before
 * the consumer has pushed the schema.
 */
@Injectable()
export class SecurityEvaluationCriteriaSeed implements OnModuleInit {
  private readonly logger = new Logger(SecurityEvaluationCriteriaSeed.name);
  private seeded = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly criteria: EvaluationCriteriaService,
  ) {}

  onModuleInit(): void {
    void this.ensureDependencyBaseline().catch((error: unknown) => {
      this.logger.warn(`Dependency criteria baseline not seeded yet: ${describe(error)}`);
    });
  }

  async ensureDependencyBaseline(): Promise<void> {
    if (this.seeded) return;

    const kind = SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY;
    const family = SECURITY_EVALUATION_FAMILY_DEPENDENCY;
    const version = SECURITY_EVALUATION_DEPENDENCY_CRITERIA_VERSION;

    let row = await this.findVersion(kind, family, version);
    if (!row) {
      try {
        row = await this.criteria.createVersion({
          kind,
          family,
          version,
          description: "Dependency vulnerability baseline: installed npm packages are matched against OSV.",
          metadata: { ecosystem: "npm", dataSource: "https://osv.dev" },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        row = await this.findVersion(kind, family, version);
        if (!row) throw error;
      }
    }

    const criterionCount = await this.prisma.evaluationCriterion.count({
      where: { criteriaVersionId: row.id },
    });
    if (criterionCount === 0) {
      try {
        await this.criteria.addCriterion(row.id, {
          criterionKey: SECURITY_EVALUATION_DEPENDENCY_CRITERION_KEY,
          kind: "ASSERTION",
          name: "Vulnerable dependency",
          description: "An installed npm package version is listed as affected by an OSV vulnerability.",
          metadata: { ecosystem: "npm", dataSource: "https://osv.dev" },
        });
      } catch (error) {
        // A concurrent instance added the criterion first; that is the goal.
        if (!isUniqueViolation(error)) throw error;
      }
    }

    const latest = await this.findVersion(kind, family, version);
    if (!latest) throw new Error(`Criteria version ${kind}/${family}/${version} disappeared during seeding`);
    if (!latest.publishedAt) {
      try {
        await this.criteria.publishVersion(latest.id);
      } catch (error) {
        // Published concurrently; a later read proves the published row exists.
        if (!(error instanceof ConflictException)) throw error;
      }
    }
    this.seeded = true;
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
