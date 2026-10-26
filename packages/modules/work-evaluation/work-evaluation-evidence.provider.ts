import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { EvidenceCollection, EvidenceProvider } from "@modules/evaluation/ports/evidence.provider";
import {
  EvaluationCoverageBucket,
  EvaluationCriteriaVersionRef,
  EvaluationEvidenceItem,
  EvaluationSubjectRef,
} from "@modules/evaluation/ports/evaluation.contracts";

import { WorkEvaluationPeriodService } from "./work-evaluation-period.service";
import { requirePeriodId } from "./work-evaluation-run-config";
import { WorkEvaluationSessionStore } from "./work-evaluation-session.store";

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
 *
 * The manifest is part of what the model sees under a blind subject id, so
 * member-supplied paths (workspace rootPath, document refPath) never enter
 * summaries, refs or payloads — ids and workspace keys only.
 */
@Injectable()
export class WorkEvaluationEvidenceProvider implements EvidenceProvider {
  private readonly logger = new Logger(WorkEvaluationEvidenceProvider.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly periods: WorkEvaluationPeriodService,
    private readonly sessionStore: WorkEvaluationSessionStore,
  ) {}

  async collect(
    subject: EvaluationSubjectRef,
    _criteriaVersion: EvaluationCriteriaVersionRef,
    runConfig?: Record<string, unknown> | null,
  ): Promise<EvidenceCollection> {
    // The period is a run-level parameter (ADR-026): runConfig.periodId picks
    // the window, and the subject's key is the evaluatee.
    const period = await this.periods.getPeriodById(requirePeriodId(runConfig));
    const window = { since: period.periodStart, until: period.periodEnd };
    const evaluateeUserId = subject.subjectKey;

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
        // is read back through the judgment drill tools by document id.
        select: { id: true, workspaceKey: true, capturedAt: true },
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
        summary: `Workspace "${workspace.workspaceKey}" declared`,
        observedAt: workspace.reportedAt,
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
        summary: `Document declared in workspace "${document.workspaceKey}"`,
        observedAt: document.capturedAt,
        payload: { documentId: document.id, workspaceKey: document.workspaceKey },
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
   * Transcript availability probe: one aggregated ClickHouse query counts the
   * messages of all manifest sessions. A session whose transcript is missing
   * or empty keeps its manifest entry (the index data is still valid) but is
   * listed in `skipped`, so nothing is dropped silently (ADR-020 D5.2). If the
   * query itself fails, every session is reported skipped with the error.
   */
  private async probeTranscripts(sessions: { id: string }[]): Promise<EvaluationCoverageBucket> {
    if (sessions.length === 0) return { total: 0 };
    let counts: Map<string, number>;
    try {
      counts = await this.sessionStore.countMessagesBySession(sessions.map((session) => session.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Transcript availability check failed in ClickHouse: ${message}`);
      const items = sessions.map((session) => `session:${session.id}`).sort();
      return {
        total: items.length,
        bySource: { session: items.length },
        note: `Transcript availability check failed in ClickHouse for ${items.length} session(s): ${message}`,
        items,
      };
    }
    const missing = sessions
      .filter((session) => !counts.get(session.id))
      .map((session) => `session:${session.id}`)
      .sort();
    if (missing.length === 0) return { total: 0 };
    return {
      total: missing.length,
      bySource: { session: missing.length },
      note: `Transcript unavailable in ClickHouse for ${missing.length} session(s) (missing or empty)`,
      items: missing,
    };
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
