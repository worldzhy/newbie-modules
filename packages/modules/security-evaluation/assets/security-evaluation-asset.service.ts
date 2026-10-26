import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import type { EvaluationSubjectRef } from "@modules/evaluation/ports/evaluation.contracts";

export interface SecurityEvaluationAssetFactInput {
  factType: string;
  factKey: string;
  value: Record<string, unknown> | null;
}

export interface ListSecurityEvaluationAssetsInput {
  scopeType: string;
  scopeId: string;
  kinds: readonly string[];
  page?: number;
  pageSize?: number;
}

export interface ListSecurityEvaluationAssetFactsInput {
  assetId: string;
  factType?: string;
  page?: number;
  pageSize?: number;
}

/** Facts per transaction. A repository can hold a few thousand packages. */
const FACT_UPSERT_CHUNK_SIZE = 100;

/**
 * SecurityEvaluationAssetService — the asset inventory (ADR-022 D2).
 *
 * `Asset` is the feature's persistent view of an `EvaluationSubject`: the
 * subject coordinate belongs to the skeleton, while this row owns the
 * inventory lifecycle (`firstSeenAt`, `lastSeenAt`) and the current-state
 * facts hanging off it.
 */
@Injectable()
export class SecurityEvaluationAssetService {
  constructor(private readonly prisma: PrismaService) {}

  /** Idempotent: one asset row per subject, forever. */
  async ensureAsset(subject: EvaluationSubjectRef) {
    return this.prisma.securityEvaluationAsset.upsert({
      where: { subjectId: subject.id },
      create: {
        subjectId: subject.id,
        naturalKey: subject.subjectKey,
        displayName: subject.displayName,
      },
      update: {
        naturalKey: subject.subjectKey,
        displayName: subject.displayName,
      },
    });
  }

  async ensureAssets(subjects: readonly EvaluationSubjectRef[]) {
    return Promise.all(subjects.map((subject) => this.ensureAsset(subject)));
  }

  /** Record that a run actually observed this asset's inventory. */
  async touchObserved(assetId: string, observedAt: Date): Promise<void> {
    await this.prisma.securityEvaluationAsset.updateMany({ where: { id: assetId }, data: { lastSeenAt: observedAt } });
  }

  /**
   * Upsert current-state facts. A fact not observed by this run keeps its old
   * `observedAt`, which is how staleness becomes visible without deleting rows.
   */
  async upsertFacts(assetId: string, facts: readonly SecurityEvaluationAssetFactInput[], observedAt: Date) {
    for (let index = 0; index < facts.length; index += FACT_UPSERT_CHUNK_SIZE) {
      const chunk = facts.slice(index, index + FACT_UPSERT_CHUNK_SIZE);
      await this.prisma.$transaction(
        chunk.map((fact) =>
          this.prisma.securityEvaluationAssetFact.upsert({
            where: { assetId_factType_factKey: { assetId, factType: fact.factType, factKey: fact.factKey } },
            create: {
              assetId,
              factType: fact.factType,
              factKey: fact.factKey,
              value: (fact.value ?? undefined) as Prisma.InputJsonValue | undefined,
              observedAt,
            },
            update: {
              value: (fact.value ?? undefined) as Prisma.InputJsonValue | undefined,
              observedAt,
            },
          }),
        ),
      );
    }
  }

  async getAsset(id: string) {
    const asset = await this.prisma.securityEvaluationAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException(`Security evaluation asset ${id} not found`);
    return asset;
  }

  async findAssetBySubject(subjectId: string) {
    return this.prisma.securityEvaluationAsset.findUnique({ where: { subjectId } });
  }

  /**
   * Asset listing is scope-based because assets carry no scope columns of their
   * own: the subject coordinate owns that, and foreign keys never cross schemas.
   */
  async listAssets(query: ListSecurityEvaluationAssetsInput) {
    const subjects = await this.prisma.evaluationSubject.findMany({
      where: { kind: { in: [...query.kinds] }, scopeType: query.scopeType, scopeId: query.scopeId },
      select: { id: true },
    });
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.SecurityEvaluationAsset,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: {
        where: { subjectId: { in: subjects.map((subject) => subject.id) } },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
      },
    });
  }

  async listFacts(query: ListSecurityEvaluationAssetFactsInput) {
    await this.getAsset(query.assetId);
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.SecurityEvaluationAssetFact,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: {
        where: { assetId: query.assetId, ...(query.factType ? { factType: query.factType } : {}) },
        orderBy: [{ factType: "asc" }, { factKey: "asc" }],
      },
    });
  }
}
