import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { EvaluationSubjectService } from "@modules/evaluation/evaluation-subject.service";
import { EvidenceCollection, EvidenceProvider } from "@modules/evaluation/ports/evidence.provider";
import {
  EvaluationCoverageBucket,
  EvaluationEvidenceItem,
  EvaluationSubjectRef,
} from "@modules/evaluation/ports/evaluation.contracts";

import { WorkEvaluationPeriodService } from "./work-evaluation-period.service";
import { WorkEvaluationSessionStore } from "./work-evaluation-session.store";

/** Subject metadata the host SubjectProvider attaches (README §subjectKey). */
interface WorkEvaluationSubjectMetadata {
  periodId: string;
  evaluateeUserId: string;
}

/**
 * WorkEvaluationEvidenceProvider — the EvidenceProvider for subject kind
 * "work" (ADR-024, spec §4.2). Declared layer only: workspaces, collected
 * sessions, declared documents and the home-ground declaration.
 *
 * The declared workspace set is an allowlist: sessions and documents whose
 * workspaceKey is not declared are not judged — they are reported in
 * `declaredUnlinked` instead of entering the manifest. Transcripts stay in
 * ClickHouse; the manifest carries index data only and the judgment port
 * drills in through its read-only tools (skeleton evidence-payload rule).
 */
@Injectable()
export class WorkEvaluationEvidenceProvider implements EvidenceProvider {
  private readonly logger = new Logger(WorkEvaluationEvidenceProvider.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subjects: EvaluationSubjectService,
    private readonly periods: WorkEvaluationPeriodService,
    private readonly sessionStore: WorkEvaluationSessionStore,
  ) {}

  async collect(subject: EvaluationSubjectRef): Promise<EvidenceCollection> {
    const metadata = await this.subjectMetadata(subject.id);
    const period = await this.periods.getPeriodById(metadata.periodId);
    const window = { since: period.periodStart, until: period.periodEnd };
    const evaluateeUserId = metadata.evaluateeUserId;

    const [workspaces, sessions, documents, homeGround] = await Promise.all([
      this.prisma.workEvaluationWorkspace.findMany({ where: { evaluateeUserId } }),
      this.prisma.workEvaluationSession.findMany({
        where: { evaluateeUserId, startedAt: { gte: window.since, lt: window.until } },
        orderBy: { startedAt: "asc" },
      }),
      this.prisma.workEvaluationDeclaredDocument.findMany({
        where: { evaluateeUserId, capturedAt: { gte: window.since, lt: window.until } },
        orderBy: { capturedAt: "asc" },
        // The manifest needs index fields only; content stays in Postgres and
        // is read back through the judgment drill tools.
        select: { id: true, workspaceKey: true, title: true, refPath: true, capturedAt: true },
      }),
      this.prisma.workEvaluationHomeGround.findUnique({
        where: { evaluateeUserId_collectionPeriodId: { evaluateeUserId, collectionPeriodId: period.id } },
      }),
    ]);

    const declaredWorkspaceKeys = new Set(workspaces.map((workspace) => workspace.workspaceKey));
    const linkedSessions = sessions.filter((session) => declaredWorkspaceKeys.has(session.workspaceKey));
    const unlinkedSessions = sessions.filter((session) => !declaredWorkspaceKeys.has(session.workspaceKey));
    const linkedDocuments = documents.filter((document) => declaredWorkspaceKeys.has(document.workspaceKey));
    const unlinkedDocuments = documents.filter((document) => !declaredWorkspaceKeys.has(document.workspaceKey));

    const items: EvaluationEvidenceItem[] = [];
    for (const workspace of workspaces) {
      items.push({
        id: `workspace:${workspace.id}`,
        layer: "declared",
        source: "workspace",
        summary: `Workspace "${workspace.workspaceKey}" declared (${workspace.rootPath})`,
        observedAt: workspace.reportedAt,
        refs: [workspace.rootPath],
        payload: { workspaceKey: workspace.workspaceKey, installationId: workspace.installationId },
      });
    }
    for (const session of linkedSessions) {
      items.push({
        id: `session:${session.id}`,
        layer: "declared",
        source: "session",
        summary: `${session.messageCount} messages, ${session.turnCount} turns, ${session.toolCallCount} tool calls (${session.model || "unknown model"}, ${session.source})`,
        observedAt: session.startedAt,
        payload: {
          sessionId: session.id,
          externalSessionId: session.externalSessionId,
          workspaceKey: session.workspaceKey,
          source: session.source,
          model: session.model,
          toolNames: session.toolNames ?? [],
          touchedFiles: session.touchedFiles ?? [],
          durationMs: session.durationMs,
        },
      });
    }
    for (const document of linkedDocuments) {
      items.push({
        id: `document:${document.id}`,
        layer: "declared",
        source: "declared-document",
        summary: document.title,
        observedAt: document.capturedAt,
        refs: [document.refPath],
        payload: { documentId: document.id, workspaceKey: document.workspaceKey, refPath: document.refPath },
      });
    }
    if (homeGround) {
      const homeCriteria = Array.isArray(homeGround.homeCriteria) ? (homeGround.homeCriteria as string[]) : [];
      items.push({
        id: `home-ground:${homeGround.id}`,
        layer: "declared",
        source: "home-ground",
        summary: `Specialty criteria: ${homeCriteria.join(", ") || "none"}`,
        observedAt: homeGround.declaredAt,
        payload: { homeCriteria },
      });
    }

    return {
      items,
      declaredUnlinked: unlinkedBucket(unlinkedSessions, unlinkedDocuments),
      skipped: await this.probeTranscripts(linkedSessions),
    };
  }

  /**
   * Cheapest availability check the session store offers: one message count
   * per manifest session. A session whose transcript cannot be confirmed keeps
   * its manifest entry (the index data is still valid) but is listed in
   * `skipped`, so nothing is dropped silently (ADR-020 D5.2).
   */
  private async probeTranscripts(sessions: { id: string }[]): Promise<EvaluationCoverageBucket> {
    if (sessions.length === 0) return { total: 0 };
    const skippedIds: string[] = [];
    let firstError: string | undefined;
    await Promise.all(
      sessions.map(async (session) => {
        try {
          await this.sessionStore.countMessages(session.id);
        } catch (error) {
          firstError ??= error instanceof Error ? error.message : String(error);
          skippedIds.push(`session:${session.id}`);
          this.logger.warn(`Transcript probe failed for session ${session.id}: ${firstError}`);
        }
      }),
    );
    if (skippedIds.length === 0) return { total: 0 };
    skippedIds.sort();
    return {
      total: skippedIds.length,
      bySource: { session: skippedIds.length },
      note: `Transcript availability check failed in ClickHouse for ${skippedIds.length} session(s): ${firstError ?? "unknown error"}`,
      items: skippedIds,
    };
  }

  private async subjectMetadata(subjectId: string): Promise<WorkEvaluationSubjectMetadata> {
    const subject = await this.subjects.getSubject(subjectId);
    const metadata = (subject.metadata ?? {}) as Partial<WorkEvaluationSubjectMetadata>;
    if (typeof metadata.periodId !== "string" || typeof metadata.evaluateeUserId !== "string") {
      throw new BadRequestException(
        `Evaluation subject ${subjectId} is missing periodId/evaluateeUserId metadata (see work-evaluation README).`,
      );
    }
    return metadata as WorkEvaluationSubjectMetadata;
  }
}

/**
 * Sessions and documents under an undeclared workspaceKey. Deliberately not
 * in the manifest: undeclared material is not judged, only accounted for.
 */
function unlinkedBucket(
  sessions: readonly { id: string }[],
  documents: readonly { id: string }[],
): EvaluationCoverageBucket {
  const items = [...sessions.map((session) => `session:${session.id}`), ...documents.map((d) => `document:${d.id}`)];
  if (items.length === 0) return { total: 0 };
  const bySource: Record<string, number> = {};
  if (sessions.length > 0) bySource.session = sessions.length;
  if (documents.length > 0) bySource["declared-document"] = documents.length;
  return {
    total: items.length,
    bySource,
    note: `${items.length} item(s) ran in workspaces without a declaration and are excluded from the judged manifest.`,
    items,
  };
}
