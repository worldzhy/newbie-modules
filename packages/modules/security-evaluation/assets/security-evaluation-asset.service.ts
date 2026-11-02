import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { EvaluationSubjectService, toSubjectRef } from "@modules/evaluation/evaluation-subject.service";
import type { EvaluationSubjectRef } from "@modules/evaluation/ports/evaluation.contracts";

import {
  SECURITY_EVALUATION_PLATFORM_SCOPE_ID,
  SECURITY_EVALUATION_PLATFORM_SCOPE_TYPE,
  SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT,
} from "../security-evaluation.constants";

export interface SecurityEvaluationAssetKnowledgeItemInput {
  type: string;
  key: string;
  value: Record<string, unknown> | null;
}

/** One subject submission, with the provenance of who supplied it (ADR-039). */
export interface IngestSecurityEvaluationSubjectInput {
  kind: string;
  subjectKey: string;
  displayName: string;
  metadata?: Record<string, unknown>;
  sourceType: string;
  sourceId: string;
}

export interface IngestSecurityEvaluationSubjectResult {
  subjectId: string;
  assetId: string;
}

/** Optional provenance filter; omission means the platform view. */
export interface SecurityEvaluationSourceFilter {
  scopeType?: string;
  scopeId?: string;
}

export interface ListSecurityEvaluationAssetsInput extends SecurityEvaluationSourceFilter {
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
 * SecurityEvaluationAssetService — the asset inventory (ADR-022) plus the
 * platform-level ingest contract (ADR-039).
 *
 * `Asset` is the feature's persistent view of an `EvaluationSubject`: the
 * subject coordinate belongs to the skeleton, while this row owns the
 * inventory lifecycle (`firstSeenAt`, `lastSeenAt`) and the current-state
 * knowledge items hanging off it.
 *
 * Subjects are platform-level: `subjectKey` alone identifies the asset across
 * the deployment, so several projects referencing the same repository share one
 * subject, one run history and one finding set. Who supplied it is recorded on
 * `SecurityEvaluationAssetSource` rows — provenance for display and routing,
 * never an authorization boundary.
 */
@Injectable()
export class SecurityEvaluationAssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subjects: EvaluationSubjectService,
  ) {}

  /**
   * Ingest subjects: upsert the platform-level subject, materialise its asset
   * row and record the submitting source. Idempotent per
   * `(subjectKey, sourceType, sourceId)`; a repeat submission only bumps
   * `lastSubmittedAt`.
   */
  async ingest(
    submissions: readonly IngestSecurityEvaluationSubjectInput[],
  ): Promise<IngestSecurityEvaluationSubjectResult[]> {
    const results: IngestSecurityEvaluationSubjectResult[] = [];
    for (const submission of submissions) {
      const subject = await this.subjects.getOrCreateSubject({
        kind: submission.kind,
        scopeType: SECURITY_EVALUATION_PLATFORM_SCOPE_TYPE,
        scopeId: SECURITY_EVALUATION_PLATFORM_SCOPE_ID,
        subjectKey: submission.subjectKey,
        displayName: submission.displayName,
        metadata: submission.metadata,
      });
      const asset = await this.getOrCreateAsset(toSubjectRef(subject));
      const now = new Date();
      await this.prisma.securityEvaluationAssetSource.upsert({
        where: {
          subjectId_sourceType_sourceId: {
            subjectId: subject.id,
            sourceType: submission.sourceType,
            sourceId: submission.sourceId,
          },
        },
        create: {
          subjectId: subject.id,
          sourceType: submission.sourceType,
          sourceId: submission.sourceId,
          firstSubmittedAt: now,
          lastSubmittedAt: now,
        },
        update: { lastSubmittedAt: now },
      });
      results.push({ subjectId: subject.id, assetId: asset.id });
    }
    return results;
  }

  /**
   * Resolve an optional provenance filter to the subjects it contributed.
   * `null` means "no filter" (the platform view); an empty array means the
   * filter matched nothing.
   */
  async listSubjectIdsBySource(filter: SecurityEvaluationSourceFilter): Promise<string[] | null> {
    if (!filter.scopeType && !filter.scopeId) return null;
    const sources = await this.prisma.securityEvaluationAssetSource.findMany({
      where: {
        ...(filter.scopeType ? { sourceType: filter.scopeType } : {}),
        ...(filter.scopeId ? { sourceId: filter.scopeId } : {}),
      },
      select: { subjectId: true },
      distinct: ["subjectId"],
    });
    return sources.map((source) => source.subjectId);
  }

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
   * The platform view, optionally narrowed by provenance. Assets carry no scope
   * columns of their own; the subject coordinate owns that, and foreign keys
   * never cross schemas.
   */
  async listAssets(query: ListSecurityEvaluationAssetsInput) {
    const subjectIds = await this.listSubjectIdsBySource(query);
    const allowedSubjectIds =
      query.kinds.length > 0 ? await this.subjectIdsOfKinds(query.kinds, subjectIds ?? undefined) : subjectIds;
    const page = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.SecurityEvaluationAsset,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: {
        where: allowedSubjectIds ? { subjectId: { in: allowedSubjectIds } } : {},
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
      },
    });

    const pageSubjectIds = page.records.map((asset) => asset.subjectId);
    const [subjects, sources] = await Promise.all([
      this.prisma.evaluationSubject.findMany({
        where: { id: { in: pageSubjectIds } },
        select: { id: true, kind: true },
      }),
      this.prisma.securityEvaluationAssetSource.findMany({
        where: { subjectId: { in: pageSubjectIds } },
        select: { subjectId: true, sourceType: true, sourceId: true, firstSubmittedAt: true, lastSubmittedAt: true },
        orderBy: [{ firstSubmittedAt: "asc" }, { sourceType: "asc" }, { sourceId: "asc" }],
      }),
    ]);
    const kindBySubject = new Map(subjects.map((subject) => [subject.id, subject.kind]));
    const sourcesBySubject = new Map<string, typeof sources>();
    for (const source of sources) {
      const existing = sourcesBySubject.get(source.subjectId) ?? [];
      existing.push(source);
      sourcesBySubject.set(source.subjectId, existing);
    }

    return {
      ...page,
      records: page.records.map((asset) => ({
        ...asset,
        kind: kindBySubject.get(asset.subjectId) ?? "",
        sources: sourcesBySubject.get(asset.subjectId) ?? [],
      })),
    };
  }

  /** Subjects of the given kinds, intersected with an optional provenance set. */
  private async subjectIdsOfKinds(kinds: readonly string[], subjectIds?: readonly string[]): Promise<string[]> {
    const rows = await this.prisma.evaluationSubject.findMany({
      where: {
        kind: { in: [...kinds] },
        ...(subjectIds ? { id: { in: [...subjectIds] } } : {}),
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
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
