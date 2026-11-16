import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { EvaluationSubjectService } from "@modules/evaluation/evaluation-subject.service";
import type { EvaluationSubjectDescriptor } from "@modules/evaluation/ports/evaluation.contracts";

import {
  SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT,
  SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
  SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN,
  SECURITY_EVALUATION_SUBJECT_TYPE,
  type SecurityEvaluationWebOriginVerificationMethod,
} from "../security-evaluation.constants";
import type { SecurityEvaluationSubjectMaterial } from "../security-evaluation-material.dto";
import { SecurityEvaluationWebOriginService } from "./security-evaluation-web-origin.service";
import type {
  SecurityEvaluationWebOriginChallenge,
  SecurityEvaluationWebOriginVerificationResult,
} from "./security-evaluation-web-origin.service";
import {
  normalizeAwsAccountId,
  normalizeAwsRegions,
  normalizeRepositoryCoordinate,
  repositorySubjectKey,
} from "./security-evaluation-subject-coordinate";

export interface SecurityEvaluationAssetKnowledgeItemInput {
  type: string;
  key: string;
  value: Record<string, unknown> | null;
}

/**
 * One subject submission (ADR-068 D8, ADR-070 D3). Identity is the platform-level
 * subject coordinate; there is no provenance row. Kinds that declare a natural
 * coordinate (`repository`, `aws-account`) also carry their material, and the
 * module derives the coordinate from it — a submission never supplies a host id.
 */
export interface IngestSecurityEvaluationSubjectInput {
  kind: string;
  /** Required for kinds without material; for material kinds it may only echo the derived key. */
  subjectKey?: string;
  displayName: string;
  metadata?: Record<string, unknown>;
  /**
   * Opaque pointer to the host credentials this subject is evaluated with
   * (e.g. `"aws-binding:<id>"` for an aws-account subject). Captured here —
   * the registration point — so evidence collection never has to rediscover
   * credentials. The module stores it verbatim and never resolves it.
   */
  credentialRef?: string | null;
  /** Repository material of a `repository` subject (ADR-070 D1, D2). */
  repository?: {
    provider: string;
    namespace: string;
    name: string;
    url?: string | null;
  };
  /** AWS account material of an `aws-account` subject (ADR-070 D1, D2). */
  awsAccount?: {
    accountId: string;
    defaultRegion?: string | null;
    regions?: readonly string[];
  };
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

export interface ListSecurityEvaluationSubjectsInput {
  kind?: string;
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
 * an inventory row of its own. Identity is `(subjectType, kind, subjectKey)`, so
 * several projects referencing the same repository share one subject, one run
 * history and one finding set, while a different feature evaluating the same
 * kind keeps its own row (ADR-069). Knowledge items hang off the subject id with a
 * plain scalar — foreign keys never cross schema boundaries.
 */
@Injectable()
export class SecurityEvaluationAssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subjects: EvaluationSubjectService,
    private readonly webOrigins: SecurityEvaluationWebOriginService,
  ) {}

  /**
   * Ingest subjects: upsert the platform-level subject and, for material kinds,
   * its material row in the same transaction (ADR-070 D3). Idempotent per
   * `(subjectType, kind, subjectKey)`.
   */
  async ingest(
    submissions: readonly IngestSecurityEvaluationSubjectInput[],
  ): Promise<IngestSecurityEvaluationSubjectResult[]> {
    const results: IngestSecurityEvaluationSubjectResult[] = [];
    for (const submission of submissions) {
      // A web origin's material is its verification record (token, target
      // paths, status); registering it through the module service keeps ingest
      // and the project-level registration path writing the same row shape.
      if (submission.kind === SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN) {
        results.push({ subjectId: await this.ingestWebOrigin(submission) });
        continue;
      }

      const prepared = prepareSubmission(submission);
      const subject = await this.prisma.$transaction(async (transaction) => {
        const created = await this.subjects.getOrCreateSubject(prepared.descriptor, transaction);
        if (prepared.repository) {
          await transaction.securityEvaluationRepository.upsert({
            where: {
              provider_namespace_name: {
                provider: prepared.repository.provider,
                namespace: prepared.repository.namespace,
                name: prepared.repository.name,
              },
            },
            create: {
              subjectId: created.id,
              ...prepared.repository,
            },
            update: {
              url: prepared.repository.url,
              isActive: true,
            },
          });
        }
        if (prepared.awsAccount) {
          const { accountId, defaultRegion, regions } = prepared.awsAccount;
          await transaction.securityEvaluationAwsAccount.upsert({
            where: { accountId },
            create: { subjectId: created.id, accountId, defaultRegion, regions },
            update: {
              isActive: true,
              ...(defaultRegion !== undefined ? { defaultRegion } : {}),
              ...(regions !== undefined ? { regions } : {}),
            },
          });
        }
        return created;
      });
      results.push({ subjectId: subject.id });
    }
    return results;
  }

  /**
   * Web-origin material is the verification record: registration generates the
   * token an operator publishes and keeps re-registration idempotent without
   * resetting an existing verification (ADR-066 §1).
   */
  private async ingestWebOrigin(submission: IngestSecurityEvaluationSubjectInput): Promise<string> {
    const origin = submission.subjectKey?.trim();
    if (!origin) {
      throw new BadRequestException(`A ${submission.kind} subject requires its subjectKey.`);
    }
    const registration = await this.webOrigins.create({
      origin,
      label: submission.displayName,
    });
    return registration.subjectId;
  }

  /**
   * The material of one subject (ADR-071). Material hangs off the subject — the
   * kind only decides which branch is assembled, so a new kind adds a union
   * branch here instead of a new route.
   */
  async material(subjectId: string): Promise<SecurityEvaluationSubjectMaterial> {
    const subject = await this.getSubject(subjectId);
    switch (subject.kind) {
      case SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN:
        return this.webOrigins.detail(subjectId);
      case SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY: {
        const row = await this.prisma.securityEvaluationRepository.findUnique({ where: { subjectId } });
        if (!row) {
          throw new NotFoundException(`Repository material of subject ${subjectId} not found`);
        }
        return {
          kind: "repository",
          provider: row.provider,
          namespace: row.namespace,
          name: row.name,
          url: row.url,
          isActive: row.isActive,
        };
      }
      case SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT: {
        const row = await this.prisma.securityEvaluationAwsAccount.findUnique({ where: { subjectId } });
        if (!row) {
          throw new NotFoundException(`AWS account material of subject ${subjectId} not found`);
        }
        return {
          kind: "aws-account",
          accountId: row.accountId,
          defaultRegion: row.defaultRegion,
          regions: row.regions,
          isActive: row.isActive,
        };
      }
      default:
        throw new NotFoundException(`Subject ${subjectId} carries no material for kind "${subject.kind}"`);
    }
  }

  /**
   * Issue (or reuse) the verification token of a web-origin subject. Verification
   * is a web-origin state machine, so another kind is a bad request, not a
   * missing resource.
   */
  async requestMaterialVerification(
    subjectId: string,
    method: SecurityEvaluationWebOriginVerificationMethod,
  ): Promise<SecurityEvaluationWebOriginChallenge> {
    await this.assertWebOriginSubject(subjectId);
    return this.webOrigins.requestVerification(subjectId, method);
  }

  /** Persist the verification outcome of a web-origin subject (ADR-071). */
  async checkMaterialVerification(subjectId: string): Promise<SecurityEvaluationWebOriginVerificationResult> {
    await this.assertWebOriginSubject(subjectId);
    return this.webOrigins.verify(subjectId);
  }

  private async assertWebOriginSubject(subjectId: string): Promise<void> {
    const subject = await this.getSubject(subjectId);
    if (subject.kind !== SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN) {
      throw new BadRequestException(
        `Subject ${subjectId} is a "${subject.kind}" subject; verification applies to web-origin subjects only.`,
      );
    }
  }

  private async getSubject(subjectId: string): Promise<{ kind: string }> {
    const subject = await this.prisma.evaluationSubject.findUnique({
      where: { id: subjectId },
      select: { kind: true },
    });
    if (!subject) throw new NotFoundException(`Security evaluation subject ${subjectId} not found`);
    return subject;
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
   * This feature's subject directory. There is no asset row any more (ADR-068
   * D7), so a directory read is a read of the skeleton's subject table; the
   * `subjectType` filter keeps subjects owned by other features (ADR-069) out.
   */
  async listSubjects(query: ListSecurityEvaluationSubjectsInput) {
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.EvaluationSubject,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: {
        where: {
          subjectType: SECURITY_EVALUATION_SUBJECT_TYPE,
          ...(query.kind ? { kind: query.kind } : {}),
        },
        orderBy: [{ kind: "asc" as const }, { subjectKey: "asc" as const }],
      },
    });
  }

  /**
   * Knowledge items are split into one table per subject kind; the subject
   * coordinate decides which delegate serves this subject.
   */
  async listKnowledgeItems(query: ListSecurityEvaluationAssetKnowledgeItemsInput) {
    const subject = await this.getSubject(query.subjectId);
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

interface PreparedSubjectSubmission {
  descriptor: EvaluationSubjectDescriptor;
  repository?: { provider: string; namespace: string; name: string; url: string | null };
  awsAccount?: { accountId: string; defaultRegion?: string | null; regions?: string[] };
}

/**
 * Turn one submission into the subject descriptor plus its material. The
 * coordinate is always re-derived from the material, so the module never trusts
 * a host-side key; a submitted key may only echo the result.
 */
function prepareSubmission(submission: IngestSecurityEvaluationSubjectInput): PreparedSubjectSubmission {
  const displayName = submission.displayName;
  const base = {
    subjectType: SECURITY_EVALUATION_SUBJECT_TYPE,
    kind: submission.kind,
    displayName,
    metadata: submission.metadata,
    credentialRef: submission.credentialRef,
  };

  if (submission.kind === SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY) {
    if (!submission.repository) {
      throw new BadRequestException(
        "A repository subject requires its repository coordinate (provider, namespace, name).",
      );
    }
    const coordinate = normalizeRepositoryCoordinate(submission.repository);
    const subjectKey = repositorySubjectKey(coordinate);
    assertSubjectKeyMatches(submission, subjectKey);
    return {
      descriptor: { ...base, subjectKey },
      repository: { ...coordinate, url: normalizeRepositoryUrl(submission.repository.url) },
    };
  }

  if (submission.kind === SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT) {
    if (!submission.awsAccount) {
      throw new BadRequestException("An aws-account subject requires its accountId.");
    }
    const accountId = normalizeAwsAccountId(submission.awsAccount.accountId);
    assertSubjectKeyMatches(submission, accountId);
    return {
      descriptor: { ...base, subjectKey: accountId },
      awsAccount: {
        accountId,
        defaultRegion: submission.awsAccount.defaultRegion?.trim() || null,
        regions: normalizeAwsRegions(submission.awsAccount.regions),
      },
    };
  }

  if (submission.repository || submission.awsAccount) {
    throw new BadRequestException(`Subject kind "${submission.kind}" carries no repository or aws-account material.`);
  }
  const subjectKey = submission.subjectKey?.trim();
  if (!subjectKey) {
    throw new BadRequestException(`A ${submission.kind} subject requires its subjectKey.`);
  }
  return { descriptor: { ...base, subjectKey } };
}

function assertSubjectKeyMatches(submission: IngestSecurityEvaluationSubjectInput, derived: string): void {
  const submitted = submission.subjectKey?.trim();
  if (submitted && submitted !== derived) {
    throw new BadRequestException(
      `subjectKey "${submitted}" does not match the natural key "${derived}" of this ${submission.kind} subject.`,
    );
  }
}

function normalizeRepositoryUrl(url: string | null | undefined): string | null {
  const normalized = url?.trim() ?? "";
  if (!normalized) return null;
  if (normalized.length > 255) {
    throw new BadRequestException("Repository url must be at most 255 characters.");
  }
  return normalized;
}
