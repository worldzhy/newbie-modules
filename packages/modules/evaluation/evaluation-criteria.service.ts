import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
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

  /** Draft-only. A published version is immutable, not merely guarded. */
  async updateVersion(id: string, input: UpdateEvaluationCriteriaVersionInput) {
    await this.assertDraftVersion(id, "update criteria version");
    return this.prisma.evaluationCriteriaVersion.update({
      where: { id },
      data: {
        description: input.description,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  /**
   * Publish exactly once. The conditional update is what makes two concurrent
   * publications safe: only the request that flips `publishedAt` from null
   * wins, the other sees the row already published.
   */
  async publishVersion(id: string) {
    const published = await this.prisma.evaluationCriteriaVersion.updateMany({
      where: { id, publishedAt: null },
      data: { publishedAt: new Date() },
    });
    if (published.count === 0) {
      const version = await this.prisma.evaluationCriteriaVersion.findUnique({ where: { id } });
      if (!version) throw new NotFoundException(`Evaluation criteria version ${id} not found`);
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
    return this.prisma.evaluationCriteriaVersion.findMany({
      where: {
        kind: query.kind,
        ...(query.family ? { family: query.family } : {}),
        ...(query.includeDrafts ? {} : { publishedAt: { not: null } }),
      },
      orderBy: [{ family: "asc" }, { version: "desc" }],
    });
  }

  /** Resolve a published version by its natural key; null when it does not exist. */
  async findPublishedVersion(kind: string, family: string, version: string) {
    return this.prisma.evaluationCriteriaVersion.findFirst({
      where: { kind, family, version, publishedAt: { not: null } },
    });
  }

  async addCriterion(versionId: string, input: CreateEvaluationCriterionInput) {
    await this.assertDraftVersion(versionId, "add a criterion");
    return this.prisma.evaluationCriterion.create({
      data: {
        criteriaVersionId: versionId,
        criterionKey: input.criterionKey,
        kind: input.kind as EvaluationCriterionKind,
        name: input.name,
        description: input.description,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async updateCriterion(criterionId: string, input: Partial<CreateEvaluationCriterionInput>) {
    const criterion = await this.prisma.evaluationCriterion.findUnique({ where: { id: criterionId } });
    if (!criterion) throw new NotFoundException(`Evaluation criterion ${criterionId} not found`);
    await this.assertDraftVersion(criterion.criteriaVersionId, "update a criterion");
    return this.prisma.evaluationCriterion.update({
      where: { id: criterionId },
      data: {
        name: input.name,
        description: input.description,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async removeCriterion(criterionId: string) {
    const criterion = await this.prisma.evaluationCriterion.findUnique({ where: { id: criterionId } });
    if (!criterion) throw new NotFoundException(`Evaluation criterion ${criterionId} not found`);
    await this.assertDraftVersion(criterion.criteriaVersionId, "remove a criterion");
    await this.prisma.evaluationCriterion.delete({ where: { id: criterionId } });
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

  /** A published version is frozen: the only way forward is a new version. */
  private async assertDraftVersion(id: string, action: string): Promise<void> {
    const version = await this.requireVersion(id);
    if (!isCriteriaVersionMutable(version.publishedAt)) {
      throw new ConflictException(
        `Cannot ${action}: ${version.kind}/${version.family}/${version.version} is published and therefore immutable`,
      );
    }
  }
}
