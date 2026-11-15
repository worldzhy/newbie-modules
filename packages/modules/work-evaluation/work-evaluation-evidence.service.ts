import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
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

  /**
   * Every read must name an evaluatee. An absent id would otherwise widen the
   * query to every member's evidence, so it is rejected rather than defaulted.
   */
  private evaluateeId(query: { developerId?: string }): string {
    const developerId = query.developerId;
    if (!developerId) {
      throw new BadRequestException("developerId is required for evidence reads.");
    }
    return developerId;
  }

  // --- Reported workspaces ------------------------------------------------

  /**
   * Upsert a workspace report. Called by the evidence ingest path only — the
   * workspace split is self-declared by the member and never adjudicated here.
   */
  async reportWorkspace(developerId: string, installationId: string, input: WorkEvaluationWorkspaceDto) {
    return this.prisma.workEvaluationWorkspace.upsert({
      where: {
        developerId_workspaceKey: {
          developerId,
          workspaceKey: input.workspaceKey,
        },
      },
      create: {
        developerId,
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
    const developerId = this.evaluateeId(query);
    return this.prisma.workEvaluationWorkspace.findMany({
      where: { developerId },
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
  async reportSessions(developerId: string, inputs: Omit<WorkEvaluationSessionDto, "messages">[]) {
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
      return this.upsertSessionIndex(developerId, input, period?.id ?? null);
    });
    return Promise.all(upserts);
  }

  /** Upsert one session index row, keyed by (developerId, externalSessionId). */
  private async upsertSessionIndex(
    developerId: string,
    input: Omit<WorkEvaluationSessionDto, "messages">,
    collectionPeriodId: string | null,
  ) {
    return this.prisma.workEvaluationSession.upsert({
      where: {
        developerId_externalSessionId: {
          developerId,
          externalSessionId: input.externalSessionId,
        },
      },
      create: {
        developerId,
        collectionPeriodId,
        workspaceKey: input.workspaceKey,
        externalSessionId: input.externalSessionId,
        transcriptSource: input.transcriptSource ?? "claude",
        modelId: input.modelId ?? "",
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
        transcriptSource: input.transcriptSource ?? "claude",
        modelId: input.modelId ?? "",
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
    const developerId = this.evaluateeId(query);
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.WorkEvaluationSession,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: {
        where: {
          developerId,
          ...(query.collectionPeriodId ? { collectionPeriodId: query.collectionPeriodId } : {}),
        },
        orderBy: [{ startedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          developerId: true,
          collectionPeriodId: true,
          externalSessionId: true,
          workspaceKey: true,
          modelId: true,
          transcriptSource: true,
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
  async reportDocument(developerId: string, input: WorkEvaluationDeclaredDocumentDto) {
    return this.prisma.workEvaluationDeclaredDocument.upsert({
      where: {
        developerId_workspaceKey_path: {
          developerId,
          workspaceKey: input.workspaceKey,
          path: input.path,
        },
      },
      create: {
        developerId,
        workspaceKey: input.workspaceKey,
        title: input.title,
        path: input.path,
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
    const developerId = this.evaluateeId(query);
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.WorkEvaluationDeclaredDocument,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: {
        where: { developerId },
        orderBy: { capturedAt: "desc" },
        select: {
          id: true,
          developerId: true,
          workspaceKey: true,
          title: true,
          path: true,
          description: true,
          capturedAt: true,
          createdAt: true,
        },
      },
    });
  }

  /**
   * Read one declared document. When `developerId` is provided the lookup
   * is bound to that evaluatee (`(developerId, id)`), so a document id
   * guessed from elsewhere resolves to nothing instead of another member's
   * content. Internal callers (the judgment tools) already pin the id to the
   * evaluation manifest and may omit it.
   */
  async getDocument(id: string, developerId?: string) {
    const document = await this.prisma.workEvaluationDeclaredDocument.findFirst({
      where: { id, ...(developerId ? { developerId } : {}) },
    });
    if (!document) {
      throw new NotFoundException(`Declared document ${id} not found`);
    }
    return document;
  }
}
