import { Injectable, NotFoundException } from "@nestjs/common";
import { WorkEvaluationPeriodType, Prisma } from "@generated/prisma/client";
import { CommonListResponseDto } from "@devbie/newbie/common.dto";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  ListWorkEvaluationDeclaredDocumentsRequestDto,
  ListWorkEvaluationSessionsRequestDto,
  ListWorkEvaluationWorkspacesRequestDto,
  WorkEvaluationDeclaredDocumentDto,
  WorkEvaluationDeclaredDocumentResponseDto,
  WorkEvaluationSessionDto,
  WorkEvaluationSessionResponseDto,
  WorkEvaluationWorkspaceDto,
} from "./work-evaluation.dto";

/**
 * WorkEvaluationEvidenceService — the reported material flow (ADR-024).
 *
 * Evaluatee identity is not part of any ingest payload: the installation token
 * resolves to exactly one evaluatee and every write takes that id as an
 * explicit parameter. The service never adjudicates the company/personal
 * workspace split — it only stores what the member declared.
 */
@Injectable()
export class WorkEvaluationEvidenceService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Reported workspaces ------------------------------------------------

  /**
   * Upsert a workspace report. Called by the evidence ingest path only — the
   * workspace split is self-declared by the member and never adjudicated here.
   */
  async reportWorkspace(evaluateeUserId: string, installationId: string, input: WorkEvaluationWorkspaceDto) {
    return this.prisma.workEvaluationWorkspace.upsert({
      where: {
        evaluateeUserId_workspaceKey: {
          evaluateeUserId,
          workspaceKey: input.workspaceKey,
        },
      },
      create: {
        evaluateeUserId,
        workspaceKey: input.workspaceKey,
        rootPath: input.rootPath,
        installationId,
        reportedAt: new Date(),
      },
      update: {
        rootPath: input.rootPath,
        installationId,
        reportedAt: new Date(),
      },
    });
  }

  async listWorkspaces(query: ListWorkEvaluationWorkspacesRequestDto) {
    return this.prisma.workEvaluationWorkspace.findMany({
      where: { evaluateeUserId: query.evaluateeUserId },
      orderBy: { reportedAt: "desc" },
    });
  }

  // --- Collected sessions --------------------------------------------------

  /**
   * Upsert the PG index rows for one reported session batch. Collection
   * periods are looked up once per batch (not once per session), then each
   * session is attributed in memory. Transcript chunks land in ClickHouse;
   * these rows are what the evaluation agent lists and drills into.
   */
  async reportSessions(evaluateeUserId: string, inputs: Omit<WorkEvaluationSessionDto, "messages">[]) {
    if (inputs.length === 0) return [];
    const starts = inputs.map((input) => input.startedAt.getTime());
    const periods = await this.prisma.workEvaluationPeriod.findMany({
      where: {
        type: WorkEvaluationPeriodType.COLLECTION,
        periodStart: { lte: new Date(Math.max(...starts)) },
        periodEnd: { gt: new Date(Math.min(...starts)) },
      },
      orderBy: { periodStart: "desc" },
    });

    const upserts = inputs.map((input) => {
      const startedAt = input.startedAt.getTime();
      const period =
        periods.find(
          (candidate) => candidate.periodStart.getTime() <= startedAt && candidate.periodEnd.getTime() > startedAt,
        ) ?? null;
      return this.upsertSessionIndex(evaluateeUserId, input, period?.id ?? null);
    });
    return Promise.all(upserts);
  }

  /** Upsert one session index row, keyed by (evaluateeUserId, externalSessionId). */
  private async upsertSessionIndex(
    evaluateeUserId: string,
    input: Omit<WorkEvaluationSessionDto, "messages">,
    collectionPeriodId: string | null,
  ) {
    return this.prisma.workEvaluationSession.upsert({
      where: {
        evaluateeUserId_externalSessionId: {
          evaluateeUserId,
          externalSessionId: input.externalSessionId,
        },
      },
      create: {
        evaluateeUserId,
        collectionPeriodId,
        workspaceKey: input.workspaceKey,
        externalSessionId: input.externalSessionId,
        source: input.source ?? "claude",
        model: input.model ?? "",
        turnCount: input.turnCount,
        messageCount: input.messageCount,
        toolCallCount: input.toolCallCount,
        toolNames: input.toolNames,
        touchedFiles: input.touchedFiles,
        durationMs: input.durationMs,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
      },
      update: {
        collectionPeriodId,
        workspaceKey: input.workspaceKey,
        source: input.source ?? "claude",
        model: input.model ?? "",
        turnCount: input.turnCount,
        messageCount: input.messageCount,
        toolCallCount: input.toolCallCount,
        toolNames: input.toolNames,
        touchedFiles: input.touchedFiles,
        durationMs: input.durationMs,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
      },
    });
  }

  async listSessions(
    query: ListWorkEvaluationSessionsRequestDto,
  ): Promise<CommonListResponseDto<WorkEvaluationSessionResponseDto>> {
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.WorkEvaluationSession,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: {
        where: {
          evaluateeUserId: query.evaluateeUserId,
          ...(query.collectionPeriodId ? { collectionPeriodId: query.collectionPeriodId } : {}),
        },
        orderBy: [{ startedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          evaluateeUserId: true,
          collectionPeriodId: true,
          externalSessionId: true,
          workspaceKey: true,
          model: true,
          source: true,
          turnCount: true,
          messageCount: true,
          toolCallCount: true,
          toolNames: true,
          touchedFiles: true,
          durationMs: true,
          startedAt: true,
          endedAt: true,
        },
      },
    });
  }

  // --- Declared documents --------------------------------------------------
  /** Upsert a declared work artifact reported by the installation agent. */
  async reportDocument(evaluateeUserId: string, input: WorkEvaluationDeclaredDocumentDto) {
    return this.prisma.workEvaluationDeclaredDocument.upsert({
      where: {
        evaluateeUserId_workspaceKey_refPath: {
          evaluateeUserId,
          workspaceKey: input.workspaceKey,
          refPath: input.refPath,
        },
      },
      create: {
        evaluateeUserId,
        workspaceKey: input.workspaceKey,
        title: input.title,
        refPath: input.refPath,
        description: input.description,
        content: input.content,
        capturedAt: input.capturedAt,
      },
      update: {
        title: input.title,
        description: input.description,
        content: input.content,
        capturedAt: input.capturedAt,
      },
    });
  }

  async listDocuments(
    query: ListWorkEvaluationDeclaredDocumentsRequestDto,
  ): Promise<CommonListResponseDto<WorkEvaluationDeclaredDocumentResponseDto>> {
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.WorkEvaluationDeclaredDocument,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: {
        where: { evaluateeUserId: query.evaluateeUserId },
        orderBy: { capturedAt: "desc" },
        select: {
          id: true,
          evaluateeUserId: true,
          workspaceKey: true,
          title: true,
          refPath: true,
          description: true,
          capturedAt: true,
          createdAt: true,
        },
      },
    });
  }

  async getDocument(id: string) {
    const document = await this.prisma.workEvaluationDeclaredDocument.findUnique({ where: { id } });
    if (!document) {
      throw new NotFoundException(`Declared document ${id} not found`);
    }
    return document;
  }
}
