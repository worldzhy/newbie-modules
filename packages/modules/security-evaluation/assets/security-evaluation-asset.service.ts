import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { EvaluationSubjectService } from "@modules/evaluation/evaluation-subject.service";

import { SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT } from "../security-evaluation.constants";

export interface SecurityEvaluationAssetKnowledgeItemInput {
  type: string;
  key: string;
  value: Record<string, unknown> | null;
}

/**
 * One subject submission (ADR-068 D8). Identity is the platform-level subject
 * coordinate; there is no provenance row and no asset row.
 */
export interface IngestSecurityEvaluationSubjectInput {
  kind: string;
  subjectKey: string;
  displayName: string;
  metadata?: Record<string, unknown>;
  /**
   * Opaque pointer to the host credentials this subject is evaluated with
   * (e.g. `"aws-binding:<id>"` for an aws-account subject). Captured here —
   * the registration point — so evidence collection never has to rediscover
   * credentials. The module stores it verbatim and never resolves it.
   */
  credentialRef?: string | null;
}

export interface IngestSecurityEvaluationSubjectResult {
  subjectId: string;
}

export interface ListSecurityEvaluationAssetKnowledgeItemsInput {
  subjectId: string;
  type?: string;
  page?: number;
  pageSize?: number;
}

/** Knowledge items per transaction. A repository can hold a few thousand packages. */
const KNOWLEDGE_ITEM_UPSERT_CHUNK_SIZE = 100;

/**
 * SecurityEvaluationAssetService — the platform-level subject ingest contract
 * and the current-state knowledge store (ADR-022, ADR-039, ADR-068 D7).
 *
 * The subject coordinate belongs to the skeleton; this service no longer keeps
 * an inventory row of its own. Identity is `(kind, subjectKey)` alone, so
 * several projects referencing the same repository share one subject, one run
 * history and one finding set. Knowledge items hang off the subject id with a
 * plain scalar — foreign keys never cross schema boundaries.
 */
@Injectable()
export class SecurityEvaluationAssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subjects: EvaluationSubjectService,
  ) {}

  /**
   * Ingest subjects: upsert the platform-level subject. Idempotent per
   * `(kind, subjectKey)`.
   */
  async ingest(
    submissions: readonly IngestSecurityEvaluationSubjectInput[],
  ): Promise<IngestSecurityEvaluationSubjectResult[]> {
    const results: IngestSecurityEvaluationSubjectResult[] = [];
    for (const submission of submissions) {
      const subject = await this.subjects.getOrCreateSubject({
        kind: submission.kind,
        subjectKey: submission.subjectKey,
        displayName: submission.displayName,
        metadata: submission.metadata,
        credentialRef: submission.credentialRef,
      });
      results.push({ subjectId: subject.id });
    }
    return results;
  }

  /**
   * Upsert current-state AWS configuration knowledge items. An item not
   * observed by this run keeps its old `observedAt`, which is how staleness
   * becomes visible without deleting rows.
   */
  async upsertAwsConfigKnowledgeItems(
    subjectId: string,
    items: readonly SecurityEvaluationAssetKnowledgeItemInput[],
    observedAt: Date,
  ) {
    for (let index = 0; index < items.length; index += KNOWLEDGE_ITEM_UPSERT_CHUNK_SIZE) {
      const chunk = items.slice(index, index + KNOWLEDGE_ITEM_UPSERT_CHUNK_SIZE);
      await this.prisma.$transaction(
        chunk.map((item) =>
          this.prisma.securityEvaluationAwsConfigKnowledgeItem.upsert({
            where: { subjectId_type_key: { subjectId, type: item.type, key: item.key } },
            create: {
              subjectId,
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
    subjectId: string,
    items: readonly SecurityEvaluationAssetKnowledgeItemInput[],
    observedAt: Date,
  ) {
    for (let index = 0; index < items.length; index += KNOWLEDGE_ITEM_UPSERT_CHUNK_SIZE) {
      const chunk = items.slice(index, index + KNOWLEDGE_ITEM_UPSERT_CHUNK_SIZE);
      await this.prisma.$transaction(
        chunk.map((item) =>
          this.prisma.securityEvaluationNpmPackageKnowledgeItem.upsert({
            where: { subjectId_type_key: { subjectId, type: item.type, key: item.key } },
            create: {
              subjectId,
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

  /**
   * Knowledge items are split into one table per subject kind; the subject
   * coordinate decides which delegate serves this subject.
   */
  async listKnowledgeItems(query: ListSecurityEvaluationAssetKnowledgeItemsInput) {
    const subject = await this.prisma.evaluationSubject.findUnique({
      where: { id: query.subjectId },
      select: { kind: true },
    });
    if (!subject) throw new NotFoundException(`Security evaluation subject ${query.subjectId} not found`);
    const where = { subjectId: query.subjectId, ...(query.type ? { type: query.type } : {}) };
    const orderBy = [{ type: "asc" as const }, { key: "asc" as const }];
    if (subject.kind === SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT) {
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
