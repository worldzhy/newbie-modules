import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import type { EvaluationSubjectRef } from "@modules/evaluation/ports/evaluation.contracts";

import { SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT } from "../security-evaluation.constants";

export interface SecurityEvaluationAssetKnowledgeItemInput {
  type: string;
  key: string;
  value: Record<string, unknown> | null;
}

export interface ListSecurityEvaluationAssetsInput {
  scopeType: string;
  scopeId: string;
  kinds: readonly string[];
  page?: number;
  pageSize?: number;
}

export interface ListSecurityEvaluationAssetKnowledgeItemsInput {
  assetId: string;
  type?: string;
  page?: number;
  pageSize?: number;
}

/** Knowledge items per transaction. A repository can hold a few thousand packages. */
const KNOWLEDGE_ITEM_UPSERT_CHUNK_SIZE = 100;

/**
 * SecurityEvaluationAssetService — the asset inventory (ADR-022 D2).
 *
 * `Asset` is the feature's persistent view of an `EvaluationSubject`: the
 * subject coordinate belongs to the skeleton, while this row owns the
 * inventory lifecycle (`firstSeenAt`, `lastSeenAt`) and the current-state
 * knowledge items hanging off it.
 */
@Injectable()
export class SecurityEvaluationAssetService {
  constructor(private readonly prisma: PrismaService) {}

  /** Idempotent: one asset row per subject, forever. */
  async getOrCreateAsset(subject: EvaluationSubjectRef) {
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

  async getOrCreateAssets(subjects: readonly EvaluationSubjectRef[]) {
    return Promise.all(subjects.map((subject) => this.getOrCreateAsset(subject)));
  }

  /** Record that a run actually observed this asset's inventory. */
  async touchObserved(assetId: string, observedAt: Date): Promise<void> {
    await this.prisma.securityEvaluationAsset.updateMany({ where: { id: assetId }, data: { lastSeenAt: observedAt } });
  }

  /**
   * Upsert current-state AWS configuration knowledge items. An item not
   * observed by this run keeps its old `observedAt`, which is how staleness
   * becomes visible without deleting rows.
   */
  async upsertAwsConfigKnowledgeItems(
    assetId: string,
    items: readonly SecurityEvaluationAssetKnowledgeItemInput[],
    observedAt: Date,
  ) {
    for (let index = 0; index < items.length; index += KNOWLEDGE_ITEM_UPSERT_CHUNK_SIZE) {
      const chunk = items.slice(index, index + KNOWLEDGE_ITEM_UPSERT_CHUNK_SIZE);
      await this.prisma.$transaction(
        chunk.map((item) =>
          this.prisma.securityEvaluationAwsConfigKnowledgeItem.upsert({
            where: { assetId_type_key: { assetId, type: item.type, key: item.key } },
            create: {
              assetId,
              type: item.type,
              key: item.key,
              value: (item.value ?? undefined) as Prisma.InputJsonValue | undefined,
              observedAt,
            },
            update: {
              value: (item.value ?? undefined) as Prisma.InputJsonValue | undefined,
              observedAt,
            },
          }),
        ),
      );
    }
  }

  /** Same lifecycle as upsertAwsConfigKnowledgeItems, for npm package knowledge. */
  async upsertNpmPackageKnowledgeItems(
    assetId: string,
    items: readonly SecurityEvaluationAssetKnowledgeItemInput[],
    observedAt: Date,
  ) {
    for (let index = 0; index < items.length; index += KNOWLEDGE_ITEM_UPSERT_CHUNK_SIZE) {
      const chunk = items.slice(index, index + KNOWLEDGE_ITEM_UPSERT_CHUNK_SIZE);
      await this.prisma.$transaction(
        chunk.map((item) =>
          this.prisma.securityEvaluationNpmPackageKnowledgeItem.upsert({
            where: { assetId_type_key: { assetId, type: item.type, key: item.key } },
            create: {
              assetId,
              type: item.type,
              key: item.key,
              value: (item.value ?? undefined) as Prisma.InputJsonValue | undefined,
              observedAt,
            },
            update: {
              value: (item.value ?? undefined) as Prisma.InputJsonValue | undefined,
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
      select: { id: true, kind: true },
    });
    const kindBySubject = new Map(subjects.map((subject) => [subject.id, subject.kind]));
    const page = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.SecurityEvaluationAsset,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: {
        where: { subjectId: { in: subjects.map((subject) => subject.id) } },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
      },
    });
    return {
      ...page,
      records: page.records.map((asset) => ({ ...asset, kind: kindBySubject.get(asset.subjectId) ?? "" })),
    };
  }

  /**
   * Knowledge items are split into one table per asset kind; the subject
   * coordinate decides which delegate serves this asset.
   */
  async listKnowledgeItems(query: ListSecurityEvaluationAssetKnowledgeItemsInput) {
    const asset = await this.getAsset(query.assetId);
    const subject = await this.prisma.evaluationSubject.findUnique({
      where: { id: asset.subjectId },
      select: { kind: true },
    });
    const where = { assetId: query.assetId, ...(query.type ? { type: query.type } : {}) };
    const orderBy = [{ type: "asc" as const }, { key: "asc" as const }];
    if (subject?.kind === SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT) {
      return this.prisma.findManyInManyPages({
        model: Prisma.ModelName.SecurityEvaluationAwsConfigKnowledgeItem,
        pagination: { page: query.page, pageSize: query.pageSize },
        findManyArgs: { where, orderBy },
      });
    }
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.SecurityEvaluationNpmPackageKnowledgeItem,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: { where, orderBy },
    });
  }
}
