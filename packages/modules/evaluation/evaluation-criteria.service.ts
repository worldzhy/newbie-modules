import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { EvaluationCriterionKind, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { EvaluationCriterionKind as CriterionKind, EvaluationCriterionRef } from "./ports/evaluation.contracts";
import { isCriteriaVersionMutable } from "./evaluation-invariants";

export interface CreateEvaluationCriteriaVersionInput {
  kind: string;
  family: string;
  version: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateEvaluationCriteriaVersionInput {
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateEvaluationCriterionInput {
  criterionKey: string;
  kind: CriterionKind;
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface ListEvaluationCriteriaVersionsInput {
  kind: string;
  family?: string;
  includeDrafts?: boolean;
  page?: number;
  pageSize?: number;
}

/**
 * EvaluationCriteriaService — versioned criteria (ADR-020 D5.5).
 *
 * A version is a draft until it is published, and publication is one-way:
 * after `publishVersion` every write is rejected and a change means a new
 * version. Runs only ever reference published versions.
 */
@Injectable()
export class EvaluationCriteriaService {
  constructor(private readonly prisma: PrismaService) {}

  async createVersion(input: CreateEvaluationCriteriaVersionInput) {
    return this.prisma.evaluationCriteriaVersion.create({
      data: {
        kind: input.kind,
        family: input.family,
        version: input.version,
        description: input.description,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  /**
   * Draft-only, written as a conditional update: the `publishedAt: null` guard
   * is part of the UPDATE, so a publication that lands between the check and
   * the write cannot be overwritten — the write simply matches no row.
   */
  async updateVersion(id: string, input: UpdateEvaluationCriteriaVersionInput) {
    const updated = await this.prisma.evaluationCriteriaVersion.updateMany({
      where: { id, publishedAt: null },
      data: {
        description: input.description,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    });
    if (updated.count === 0) await this.assertNotPublished(id, "update criteria version");
    return this.requireVersion(id);
  }

  /**
   * Publish exactly once. The conditional update is what makes two concurrent
   * publications safe: only the request that flips `publishedAt` from null
   * wins, the other sees the row already published. A version with no criteria
   * is refused — publishing an empty rubric would make every run vacuous.
   */
  async publishVersion(id: string) {
    const version = await this.requireVersion(id);
    if (version.publishedAt) {
      throw new ConflictException(
        `Evaluation criteria version ${version.kind}/${version.family}/${version.version} is already published`,
      );
    }
    const criteriaCount = await this.prisma.evaluationCriterion.count({ where: { criteriaVersionId: id } });
    if (criteriaCount === 0) {
      throw new BadRequestException(
        `Cannot publish evaluation criteria version ${version.kind}/${version.family}/${version.version}: it has no criteria`,
      );
    }
    const published = await this.prisma.evaluationCriteriaVersion.updateMany({
      where: { id, publishedAt: null },
      data: { publishedAt: new Date() },
    });
    if (published.count === 0) {
      throw new ConflictException(
        `Evaluation criteria version ${version.kind}/${version.family}/${version.version} is already published`,
      );
    }
    return this.requireVersion(id);
  }

  async getVersion(id: string) {
    return this.requireVersion(id);
  }

  async listVersions(query: ListEvaluationCriteriaVersionsInput) {
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.EvaluationCriteriaVersion,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: {
        where: {
          kind: query.kind,
          ...(query.family ? { family: query.family } : {}),
          ...(query.includeDrafts ? {} : { publishedAt: { not: null } }),
        },
        orderBy: [{ family: "asc" }, { version: "desc" }],
      },
    });
  }

  /** Resolve a published version by its natural key; null when it does not exist. */
  async findPublishedVersion(kind: string, family: string, version: string) {
    return this.prisma.evaluationCriteriaVersion.findFirst({
      where: { kind, family, version, publishedAt: { not: null } },
    });
  }

  async addCriterion(versionId: string, input: CreateEvaluationCriterionInput) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockDraftVersion(tx, versionId, "add a criterion");
      return tx.evaluationCriterion.create({
        data: {
          criteriaVersionId: versionId,
          criterionKey: input.criterionKey,
          kind: input.kind as EvaluationCriterionKind,
          name: input.name,
          description: input.description,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
      });
    });
  }

  async updateCriterion(criterionId: string, input: Partial<CreateEvaluationCriterionInput>) {
    return this.prisma.$transaction(async (tx) => {
      const criterion = await tx.evaluationCriterion.findUnique({ where: { id: criterionId } });
      if (!criterion) throw new NotFoundException(`Evaluation criterion ${criterionId} not found`);
      await this.lockDraftVersion(tx, criterion.criteriaVersionId, "update a criterion");
      return tx.evaluationCriterion.update({
        where: { id: criterionId },
        data: {
          name: input.name,
          description: input.description,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
      });
    });
  }

  async removeCriterion(criterionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const criterion = await tx.evaluationCriterion.findUnique({ where: { id: criterionId } });
      if (!criterion) throw new NotFoundException(`Evaluation criterion ${criterionId} not found`);
      await this.lockDraftVersion(tx, criterion.criteriaVersionId, "remove a criterion");
      await tx.evaluationCriterion.delete({ where: { id: criterionId } });
    });
  }

  /** Criteria in the shape the judgment port consumes. */
  async listCriteria(versionId: string): Promise<EvaluationCriterionRef[]> {
    const rows = await this.prisma.evaluationCriterion.findMany({
      where: { criteriaVersionId: versionId },
      orderBy: { criterionKey: "asc" },
    });
    return rows.map((row) => ({
      criterionKey: row.criterionKey,
      kind: row.kind as CriterionKind,
      name: row.name,
      metadata: row.metadata as Record<string, unknown> | null,
    }));
  }

  private async requireVersion(id: string) {
    const version = await this.prisma.evaluationCriteriaVersion.findUnique({ where: { id } });
    if (!version) throw new NotFoundException(`Evaluation criteria version ${id} not found`);
    return version;
  }

  /**
   * Shared guard for the criterion write paths. The `FOR UPDATE` row lock is
   * what closes the publish race: a concurrent `publishVersion` blocks on the
   * lock until this transaction commits and then either sees a still-draft row
   * (the criterion change landed before publication — legal) or publishes first
   * and makes this transaction see the published row (rejected here).
   */
  private async lockDraftVersion(tx: Prisma.TransactionClient, id: string, action: string): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "module/evaluation"."EvaluationCriteriaVersion" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const version = await tx.evaluationCriteriaVersion.findUnique({ where: { id } });
    if (!version) throw new NotFoundException(`Evaluation criteria version ${id} not found`);
    if (!isCriteriaVersionMutable(version.publishedAt)) {
      throw new ConflictException(
        `Cannot ${action}: ${version.kind}/${version.family}/${version.version} is published and therefore immutable`,
      );
    }
  }

  /** Explain a conditional write that matched no row: not found, or published. */
  private async assertNotPublished(id: string, action: string): Promise<void> {
    const version = await this.prisma.evaluationCriteriaVersion.findUnique({ where: { id } });
    if (!version) throw new NotFoundException(`Evaluation criteria version ${id} not found`);
    throw new ConflictException(
      `Cannot ${action}: ${version.kind}/${version.family}/${version.version} is published and therefore immutable`,
    );
  }
}
