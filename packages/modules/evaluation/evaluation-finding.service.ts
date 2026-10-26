import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  EvaluationFinding,
  EvaluationFindingSeverity,
  EvaluationFindingStatus,
  EvaluationRun,
  Prisma,
} from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { EvaluationCriteriaService } from "./evaluation-criteria.service";
import { EvaluationProviderRegistry } from "./evaluation-provider.registry";
import { EvaluationFindingCandidate } from "./ports/evaluation.contracts";
import { EvaluationFindingChangedEvent } from "./ports/observer.port";
import { validateJudgment } from "./evaluation-invariants";

export interface ListEvaluationFindingsInput {
  subjectId: string;
  evaluationKey?: string;
  status?: EvaluationFindingStatus;
  severity?: EvaluationFindingSeverity;
  page?: number;
  pageSize?: number;
}

/**
 * EvaluationFindingService — the assertion lifecycle (ADR-020 D2).
 *
 * A finding outlives the run that produced it: `(subjectId, evaluationKey,
 * fingerprint)` is its identity, `firstSeenAt` is never rewritten, and it is
 * resolved when a later run of the same evaluationKey no longer observes it. The
 * evaluationKey comes from the run's criteria version, so a rerun under a new version
 * of the same evaluationKey keeps the identity, and one evaluationKey's run never resolves
 * another evaluationKey's findings. A suppressed finding keeps its suppression across
 * runs — reappearance must not resurrect it.
 */
@Injectable()
export class EvaluationFindingService {
  private readonly logger = new Logger(EvaluationFindingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly criteria: EvaluationCriteriaService,
    private readonly providers: EvaluationProviderRegistry,
  ) {}

  /**
   * Record the findings of one run. Candidates are validated against the run's
   * criteria first: an assertion must reference an ASSERTION criterion, a
   * SCORED criterion must not smuggle a finding in, and every evidence ref
   * must name a manifest item of the run.
   */
  async recordFindings(
    run: EvaluationRun,
    candidates: readonly EvaluationFindingCandidate[],
    evidenceIds?: readonly string[],
  ) {
    if (candidates.length === 0) return [];

    const criteria = await this.criteria.listCriteria(run.criteriaVersionId);
    const problems = validateJudgment({
      criteria,
      verdicts: [],
      findings: candidates,
      evidenceIds: evidenceIds ? new Set(evidenceIds) : undefined,
    });
    if (problems.length > 0) throw new BadRequestException(problems);

    const { evaluationKey } = await this.criteria.getVersion(run.criteriaVersionId);
    const observedAt = run.startedAt ?? run.createdAt;
    const recorded: EvaluationFinding[] = [];
    for (const candidate of candidates) {
      recorded.push(await this.observe(run, evaluationKey, candidate, observedAt));
    }
    return recorded;
  }

  /**
   * Close findings the run did not observe, scoped to the run's evaluationKey: a run
   * of one evaluationKey must never resolve another evaluationKey's findings. The cutoff is
   * the run's start time: anything last seen before it was absent from this
   * pass. Runs of one subject and version are serialized by the database, but
   * two versions of the same evaluationKey may legitimately run concurrently — so the
   * close is a compare-and-set on the listed `lastSeenAt`, and a finding that
   * was re-observed or suppressed after the listing is left untouched.
   */
  async resolveAbsentFindings(run: EvaluationRun): Promise<number> {
    const cutoff = run.startedAt ?? run.createdAt;
    const { evaluationKey } = await this.criteria.getVersion(run.criteriaVersionId);
    const absent = await this.prisma.evaluationFinding.findMany({
      where: {
        subjectId: run.subjectId,
        evaluationKey,
        status: EvaluationFindingStatus.OPEN,
        lastSeenAt: { lt: cutoff },
        NOT: { lastSeenRunId: run.id },
      },
      select: { id: true, fingerprint: true, severity: true, lastSeenAt: true },
    });

    let resolvedCount = 0;
    for (const finding of absent) {
      // Compare-and-set per row: resolve only if nothing touched the row since
      // the listing. A human suppression wins (status changed); a concurrent
      // run of another version in the same evaluationKey that re-observed the finding
      // also wins (lastSeenAt moved) — both leave the row untouched here.
      const resolved = await this.prisma.evaluationFinding.updateMany({
        where: { id: finding.id, status: EvaluationFindingStatus.OPEN, lastSeenAt: finding.lastSeenAt },
        data: { status: EvaluationFindingStatus.RESOLVED, resolvedAt: new Date() },
      });
      if (resolved.count === 0) continue;
      resolvedCount += 1;
      await this.notifyFindingChanged({
        findingId: finding.id,
        subjectId: run.subjectId,
        evaluationKey,
        fingerprint: finding.fingerprint,
        severity: finding.severity,
        change: "resolved",
      });
    }
    return resolvedCount;
  }

  /**
   * Silence a finding until a human reopens it. The reason and the acting
   * actor are both mandatory — a suppression without an attributable actor is
   * an audit gap.
   */
  async suppressFinding(id: string, note: string, suppressedByRef: string) {
    if (!note.trim()) throw new BadRequestException("A suppression note is required");
    if (!suppressedByRef.trim()) throw new BadRequestException("suppressedByRef is required");
    const updated = await this.prisma.evaluationFinding.updateMany({
      where: { id },
      data: {
        status: EvaluationFindingStatus.SUPPRESSED,
        suppressionNote: note,
        suppressedByRef,
        resolvedAt: null,
      },
    });
    if (updated.count === 0) throw new NotFoundException(`Evaluation finding ${id} not found`);
    const finding = await this.requireFinding(id);
    await this.notifyFindingChanged({
      findingId: finding.id,
      subjectId: finding.subjectId,
      evaluationKey: finding.evaluationKey,
      fingerprint: finding.fingerprint,
      severity: finding.severity,
      change: "suppressed",
    });
    return finding;
  }

  /** Return a finding to the open set; the first-seen timestamp is preserved. */
  async reopenFinding(id: string) {
    const updated = await this.prisma.evaluationFinding.updateMany({
      where: { id },
      data: {
        status: EvaluationFindingStatus.OPEN,
        resolvedAt: null,
        suppressionNote: null,
        suppressedByRef: null,
      },
    });
    if (updated.count === 0) throw new NotFoundException(`Evaluation finding ${id} not found`);
    const finding = await this.requireFinding(id);
    await this.notifyFindingChanged({
      findingId: finding.id,
      subjectId: finding.subjectId,
      evaluationKey: finding.evaluationKey,
      fingerprint: finding.fingerprint,
      severity: finding.severity,
      change: "reopened",
    });
    return finding;
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
          ...(query.evaluationKey ? { evaluationKey: query.evaluationKey } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.severity ? { severity: query.severity } : {}),
        },
        orderBy: [{ status: "asc" }, { severity: "desc" }, { lastSeenAt: "desc" }],
      },
    });
  }

  private async observe(
    run: EvaluationRun,
    evaluationKey: string,
    candidate: EvaluationFindingCandidate,
    observedAt: Date,
  ): Promise<EvaluationFinding> {
    const existing = await this.findByFingerprint(run.subjectId, evaluationKey, candidate.fingerprint);
    if (!existing) return this.createFinding(run, evaluationKey, candidate, observedAt);
    return this.updateFinding(run, existing, candidate, observedAt);
  }

  private async createFinding(
    run: EvaluationRun,
    evaluationKey: string,
    candidate: EvaluationFindingCandidate,
    observedAt: Date,
  ): Promise<EvaluationFinding> {
    try {
      const created = await this.prisma.evaluationFinding.create({
        data: {
          subjectId: run.subjectId,
          evaluationKey,
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
      await this.notifyFindingChanged({
        findingId: created.id,
        subjectId: created.subjectId,
        evaluationKey: created.evaluationKey,
        fingerprint: created.fingerprint,
        severity: created.severity,
        change: "created",
      });
      return created;
    } catch (error) {
      // A concurrent writer created the same fingerprint first; fall through to
      // the update path rather than failing the whole run.
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.findByFingerprint(run.subjectId, evaluationKey, candidate.fingerprint);
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
    // decision about a known problem, not a cache to be invalidated. The write
    // is a compare-and-set on the status we read, so a suppression (or a
    // concurrent run of the same evaluationKey) landing between the read and the
    // write is never stomped.
    const reopened = existing.status === EvaluationFindingStatus.RESOLVED;
    const observation = {
      criterionKey: candidate.criterionKey,
      severity: candidate.severity,
      title: candidate.title,
      detail: candidate.detail,
      metadata: candidate.metadata as Prisma.InputJsonValue | undefined,
      lastSeenRunId: run.id,
      lastSeenAt: observedAt,
    };
    const written = await this.prisma.evaluationFinding.updateMany({
      where: { id: existing.id, status: existing.status },
      data: reopened
        ? {
            ...observation,
            status: EvaluationFindingStatus.OPEN,
            resolvedAt: null,
            suppressionNote: null,
            suppressedByRef: null,
          }
        : observation,
    });
    if (written.count === 0) {
      // The status changed between our read and this write. Refresh the
      // observation fields only; the lifecycle decision that beat us stands.
      await this.prisma.evaluationFinding.updateMany({ where: { id: existing.id }, data: observation });
      return this.requireFinding(existing.id);
    }
    const updated = await this.requireFinding(existing.id);
    if (reopened) {
      await this.notifyFindingChanged({
        findingId: updated.id,
        subjectId: updated.subjectId,
        evaluationKey: updated.evaluationKey,
        fingerprint: updated.fingerprint,
        severity: updated.severity,
        change: "reopened",
      });
    }
    return updated;
  }

  private async findByFingerprint(subjectId: string, evaluationKey: string, fingerprint: string) {
    return this.prisma.evaluationFinding.findUnique({
      where: { subjectId_family_fingerprint: { subjectId, evaluationKey, fingerprint } },
    });
  }

  private async requireFinding(id: string) {
    const finding = await this.prisma.evaluationFinding.findUnique({ where: { id } });
    if (!finding) throw new NotFoundException(`Evaluation finding ${id} not found`);
    return finding;
  }

  /** The observer is optional auxiliary wiring; its failure never fails a run. */
  private async notifyFindingChanged(event: EvaluationFindingChangedEvent): Promise<void> {
    const observer = this.providers.getObserver();
    if (!observer?.onFindingChanged) return;
    try {
      await observer.onFindingChanged(event);
    } catch (error) {
      this.logger.warn(
        `EvaluationObserver.onFindingChanged failed for finding ${event.findingId}: ${describeError(error)}`,
      );
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "P2002") return true;
  return typeof message === "string" && message.includes("EvaluationFinding_subjectId_family_fingerprint_key");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
