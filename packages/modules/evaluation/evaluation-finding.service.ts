import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  EvaluationFinding,
  EvaluationFindingSeverity,
  EvaluationFindingStatus,
  EvaluationRun,
  Prisma,
} from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { EvaluationCriteriaService } from "./evaluation-criteria.service";
import { EvaluationFindingCandidate } from "./ports/evaluation.contracts";
import { validateJudgment } from "./evaluation-invariants";

export interface ListEvaluationFindingsInput {
  subjectId: string;
  status?: EvaluationFindingStatus;
  severity?: EvaluationFindingSeverity;
  page?: number;
  pageSize?: number;
}

/**
 * EvaluationFindingService — the assertion lifecycle (ADR-020 D2).
 *
 * A finding outlives the run that produced it: `fingerprint` is its identity
 * inside a subject, `firstSeenAt` is never rewritten, and it is resolved when a
 * later run of the same subject no longer observes it. A suppressed finding
 * keeps its suppression across runs — reappearance must not resurrect it.
 */
@Injectable()
export class EvaluationFindingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly criteria: EvaluationCriteriaService,
  ) {}

  /**
   * Record the findings of one run. Candidates are validated against the run's
   * criteria first: an assertion must reference an ASSERTION criterion, and a
   * SCORED criterion must not smuggle a finding in.
   */
  async recordFindings(run: EvaluationRun, candidates: readonly EvaluationFindingCandidate[]) {
    if (candidates.length === 0) return [];

    const criteria = await this.criteria.listCriteria(run.criteriaVersionId);
    const problems = validateJudgment({ criteria, verdicts: [], findings: candidates });
    if (problems.length > 0) throw new BadRequestException(problems);

    const observedAt = run.startedAt ?? run.createdAt;
    const recorded: EvaluationFinding[] = [];
    for (const candidate of candidates) {
      recorded.push(await this.observe(run, candidate, observedAt));
    }
    return recorded;
  }

  /**
   * Close findings the run did not observe. The cutoff is the run's start time:
   * anything last seen before it was absent from this pass, and runs for one
   * subject and version are serialized by the database.
   */
  async resolveAbsentFindings(run: EvaluationRun): Promise<number> {
    const cutoff = run.startedAt ?? run.createdAt;
    const resolved = await this.prisma.evaluationFinding.updateMany({
      where: {
        subjectId: run.subjectId,
        status: EvaluationFindingStatus.OPEN,
        lastSeenAt: { lt: cutoff },
        NOT: { lastSeenRunId: run.id },
      },
      data: { status: EvaluationFindingStatus.RESOLVED, resolvedAt: new Date() },
    });
    return resolved.count;
  }

  /** Silence a finding until a human reopens it. The reason is mandatory. */
  async suppressFinding(id: string, note: string) {
    if (!note.trim()) throw new BadRequestException("A suppression note is required");
    const updated = await this.prisma.evaluationFinding.updateMany({
      where: { id },
      data: { status: EvaluationFindingStatus.SUPPRESSED, suppressionNote: note, resolvedAt: null },
    });
    if (updated.count === 0) throw new NotFoundException(`Evaluation finding ${id} not found`);
    return this.requireFinding(id);
  }

  /** Return a finding to the open set; the first-seen timestamp is preserved. */
  async reopenFinding(id: string) {
    const updated = await this.prisma.evaluationFinding.updateMany({
      where: { id },
      data: { status: EvaluationFindingStatus.OPEN, resolvedAt: null, suppressionNote: null },
    });
    if (updated.count === 0) throw new NotFoundException(`Evaluation finding ${id} not found`);
    return this.requireFinding(id);
  }

  async getFinding(id: string) {
    return this.requireFinding(id);
  }

  async listFindings(query: ListEvaluationFindingsInput) {
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.EvaluationFinding,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: {
        where: {
          subjectId: query.subjectId,
          ...(query.status ? { status: query.status } : {}),
          ...(query.severity ? { severity: query.severity } : {}),
        },
        orderBy: [{ status: "asc" }, { severity: "desc" }, { lastSeenAt: "desc" }],
      },
    });
  }

  private async observe(
    run: EvaluationRun,
    candidate: EvaluationFindingCandidate,
    observedAt: Date,
  ): Promise<EvaluationFinding> {
    const existing = await this.findByFingerprint(run.subjectId, candidate.fingerprint);
    if (!existing) return this.createFinding(run, candidate, observedAt);
    return this.updateFinding(run, existing, candidate, observedAt);
  }

  private async createFinding(
    run: EvaluationRun,
    candidate: EvaluationFindingCandidate,
    observedAt: Date,
  ): Promise<EvaluationFinding> {
    try {
      return await this.prisma.evaluationFinding.create({
        data: {
          subjectId: run.subjectId,
          fingerprint: candidate.fingerprint,
          criterionKey: candidate.criterionKey,
          severity: candidate.severity,
          status: EvaluationFindingStatus.OPEN,
          title: candidate.title,
          detail: candidate.detail,
          metadata: candidate.metadata as Prisma.InputJsonValue | undefined,
          firstSeenRunId: run.id,
          lastSeenRunId: run.id,
          firstSeenAt: observedAt,
          lastSeenAt: observedAt,
        },
      });
    } catch (error) {
      // A concurrent writer created the same fingerprint first; fall through to
      // the update path rather than failing the whole run.
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.findByFingerprint(run.subjectId, candidate.fingerprint);
      if (!existing) throw error;
      return this.updateFinding(run, existing, candidate, observedAt);
    }
  }

  private async updateFinding(
    run: EvaluationRun,
    existing: EvaluationFinding,
    candidate: EvaluationFindingCandidate,
    observedAt: Date,
  ): Promise<EvaluationFinding> {
    // A suppressed finding stays suppressed: the suppression is a human
    // decision about a known problem, not a cache to be invalidated.
    const reopened = existing.status === EvaluationFindingStatus.RESOLVED;
    return this.prisma.evaluationFinding.update({
      where: { id: existing.id },
      data: {
        criterionKey: candidate.criterionKey,
        severity: candidate.severity,
        title: candidate.title,
        detail: candidate.detail,
        metadata: candidate.metadata as Prisma.InputJsonValue | undefined,
        lastSeenRunId: run.id,
        lastSeenAt: observedAt,
        ...(reopened ? { status: EvaluationFindingStatus.OPEN, resolvedAt: null, suppressionNote: null } : {}),
      },
    });
  }

  private async findByFingerprint(subjectId: string, fingerprint: string) {
    return this.prisma.evaluationFinding.findUnique({
      where: { subjectId_fingerprint: { subjectId, fingerprint } },
    });
  }

  private async requireFinding(id: string) {
    const finding = await this.prisma.evaluationFinding.findUnique({ where: { id } });
    if (!finding) throw new NotFoundException(`Evaluation finding ${id} not found`);
    return finding;
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "P2002") return true;
  return typeof message === "string" && message.includes("EvaluationFinding_subjectId_fingerprint_key");
}
