import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { EvaluationResultReviewStatus, EvaluationRunStatus, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { EvaluationCriteriaService } from "./evaluation-criteria.service";
import { EvaluationCoverageStats, EvaluationEvidenceItem, EvaluationVerdict } from "./ports/evaluation.contracts";
import { hashManifest, validateCoverageStats, validateJudgment } from "./evaluation-invariants";

/**
 * Fields returned by every result read. The archived `manifest` snapshot is
 * excluded on purpose — it is a large JSON blob served only by the dedicated
 * manifest read. The supervisor review columns (ADR-031) ride along so every
 * read face shows the current review state.
 */
const RESULT_SELECT = {
  id: true,
  runId: true,
  subjectId: true,
  criteriaVersionId: true,
  contentHash: true,
  coverageStats: true,
  verdicts: true,
  summary: true,
  metadata: true,
  reviewStatus: true,
  reviewedByRef: true,
  reviewedAt: true,
  reviewNote: true,
  createdAt: true,
} satisfies Prisma.EvaluationResultSelect;

const ACTIVE_STATUSES: EvaluationRunStatus[] = [EvaluationRunStatus.QUEUED, EvaluationRunStatus.RUNNING];

export interface CreateEvaluationResultInput {
  runId: string;
  manifest: readonly EvaluationEvidenceItem[];
  coverageStats: EvaluationCoverageStats;
  verdicts: readonly EvaluationVerdict[];
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface ListEvaluationResultsInput {
  subjectId: string;
  criteriaVersionId?: string;
  /** When present, only results whose subject matches this kind are returned. */
  kind?: string;
  page?: number;
  pageSize?: number;
}

/**
 * EvaluationResultService — the immutable conclusion snapshot (ADR-020 D5.1).
 *
 * A rerun writes a new row through a new run; the archived manifest, its
 * content hash and the verdicts have deliberately no update path, so the
 * material a verdict was judged from cannot be rewritten. The hash is computed
 * from the manifest rather than accepted from the caller — a caller-supplied
 * hash could disagree with the snapshot it describes.
 *
 * The one lifecycle layer above the snapshot is the supervisor review
 * (ADR-031): `reviewResult` writes only the review columns and records who
 * decided. A re-review overwrites the previous review — the final say is the
 * latest say, and the row always reflects exactly one review.
 */
@Injectable()
export class EvaluationResultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly criteria: EvaluationCriteriaService,
  ) {}

  async createResult(input: CreateEvaluationResultInput) {
    const run = await this.prisma.evaluationRun.findUnique({ where: { id: input.runId } });
    if (!run) throw new NotFoundException(`Evaluation run ${input.runId} not found`);
    if (!ACTIVE_STATUSES.includes(run.status)) {
      throw new ConflictException(`Evaluation run ${input.runId} already finished as ${run.status}`);
    }

    const manifestIds = new Set(input.manifest.map((item) => item.id));
    const coverageProblems = validateCoverageStats(input.coverageStats, manifestIds);
    if (coverageProblems.length > 0) throw new BadRequestException(coverageProblems);

    const criteria = await this.criteria.listCriteria(run.criteriaVersionId);
    const judgmentProblems = validateJudgment({
      criteria,
      verdicts: input.verdicts,
      findings: [],
      evidenceIds: manifestIds,
    });
    if (judgmentProblems.length > 0) throw new BadRequestException(judgmentProblems);

    try {
      return await this.prisma.evaluationResult.create({
        data: {
          runId: input.runId,
          subjectId: run.subjectId,
          criteriaVersionId: run.criteriaVersionId,
          manifest: input.manifest as unknown as Prisma.InputJsonValue,
          contentHash: hashManifest(input.manifest),
          coverageStats: input.coverageStats as unknown as Prisma.InputJsonValue,
          verdicts: input.verdicts as unknown as Prisma.InputJsonValue,
          summary: input.summary,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
        select: RESULT_SELECT,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`Evaluation run ${input.runId} already has a result`);
      }
      throw error;
    }
  }

  async getResult(id: string, kind?: string) {
    const result = await this.prisma.evaluationResult.findUnique({
      where: { id },
      select: { ...RESULT_SELECT, subject: { select: { kind: true } } },
    });
    if (!result) throw new NotFoundException(`Evaluation result ${id} not found`);
    if (kind && result.subject.kind !== kind) {
      throw new NotFoundException(`Evaluation result ${id} not found for kind "${kind}"`);
    }
    return result;
  }

  /** Archived material snapshot: the only manifest read path. */
  async getResultManifest(id: string) {
    const result = await this.prisma.evaluationResult.findUnique({
      where: { id },
      select: { contentHash: true, coverageStats: true, manifest: true },
    });
    if (!result) throw new NotFoundException(`Evaluation result ${id} not found`);
    return result;
  }

  async getResultForRun(runId: string, kind?: string) {
    const result = await this.prisma.evaluationResult.findUnique({
      where: { runId },
      select: { ...RESULT_SELECT, subject: { select: { kind: true } } },
    });
    if (!result) throw new NotFoundException(`Evaluation run ${runId} has no result`);
    if (kind && result.subject.kind !== kind) {
      throw new NotFoundException(`Evaluation run ${runId} has no result for kind "${kind}"`);
    }
    return result;
  }

  async listResults(query: ListEvaluationResultsInput) {
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.EvaluationResult,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: {
        where: {
          subjectId: query.subjectId,
          ...(query.criteriaVersionId ? { criteriaVersionId: query.criteriaVersionId } : {}),
          ...(query.kind ? { subject: { kind: query.kind } } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        select: RESULT_SELECT,
      },
    });
  }

  /**
   * Supervisor verdict on an archived conclusion (ADR-031): APPROVED endorses
   * it, REJECTED overrules it. The archived snapshot is untouched — only the
   * review columns move. A re-review overwrites the previous review, and an
   * omitted note clears the previous one: the row always reflects exactly the
   * latest say, never a blend of two.
   */
  async reviewResult(input: ReviewEvaluationResultInput) {
    const result = await this.prisma.evaluationResult.findUnique({
      where: { id: input.id },
      select: { id: true },
    });
    if (!result) throw new NotFoundException(`Evaluation result ${input.id} not found`);

    return this.prisma.evaluationResult.update({
      where: { id: input.id },
      data: {
        reviewStatus: input.reviewStatus,
        reviewedByRef: input.reviewedByRef,
        reviewedAt: new Date(),
        reviewNote: input.note ?? null,
      },
      select: RESULT_SELECT,
    });
  }
}

export interface ReviewEvaluationResultInput {
  id: string;
  reviewStatus: EvaluationResultReviewStatus;
  reviewedByRef: string;
  note?: string;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "P2002") return true;
  return typeof message === "string" && message.includes("EvaluationResult_runId_key");
}
