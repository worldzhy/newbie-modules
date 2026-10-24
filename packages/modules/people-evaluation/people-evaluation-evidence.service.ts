import { Injectable, NotFoundException } from "@nestjs/common";
import { PeopleEvaluationPeriodType, PeopleEvaluationSession, Prisma } from "@generated/prisma/client";
import { CommonListResponseDto } from "@devbie/newbie/common.dto";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  ListPeopleEvaluationDeclaredDocumentsRequestDto,
  ListPeopleEvaluationSessionsRequestDto,
  ListPeopleEvaluationWorkspacesRequestDto,
  PeopleEvaluationDeclaredDocumentDto,
  PeopleEvaluationDeclaredDocumentResponseDto,
  PeopleEvaluationSessionDto,
  PeopleEvaluationSessionResponseDto,
  PeopleEvaluationWorkspaceDto,
} from "./people-evaluation.dto";

/**
 * PeopleEvaluationEvidenceService — the reported material flow (ADR-029).
 *
 * Evaluatee identity is not part of any ingest payload: the installation token
 * resolves to exactly one evaluatee and every write takes that id as an
 * explicit parameter. The service never adjudicates the company/personal
 * workspace split — it only stores what the member declared.
 */
@Injectable()
export class PeopleEvaluationEvidenceService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Reported workspaces ------------------------------------------------

  /**
   * Upsert a workspace report. Called by the evidence ingest path only — the
   * workspace split is self-declared by the member and never adjudicated here.
   */
  async reportWorkspace(evaluateeUserId: string, installationId: string, input: PeopleEvaluationWorkspaceDto) {
    return this.prisma.peopleEvaluationWorkspace.upsert({
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

  async listWorkspaces(query: ListPeopleEvaluationWorkspacesRequestDto) {
    return this.prisma.peopleEvaluationWorkspace.findMany({
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
  async reportSessions(evaluateeUserId: string, inputs: Omit<PeopleEvaluationSessionDto, "messages">[]) {
    if (inputs.length === 0) return [];
    const starts = inputs.map((input) => input.startedAt.getTime());
    const periods = await this.prisma.peopleEvaluationPeriod.findMany({
      where: {
        type: PeopleEvaluationPeriodType.COLLECTION,
        periodStart: { lte: new Date(Math.max(...starts)) },
        periodEnd: { gt: new Date(Math.min(...starts)) },
      },
      orderBy: { periodStart: "desc" },
    });

    const indexes: PeopleEvaluationSession[] = [];
    for (const input of inputs) {
      const startedAt = input.startedAt.getTime();
      const period =
        periods.find(
          (candidate) => candidate.periodStart.getTime() <= startedAt && candidate.periodEnd.getTime() > startedAt,
        ) ?? null;
      indexes.push(await this.upsertSessionIndex(evaluateeUserId, input, period?.id ?? null));
    }
    return indexes;
  }

  /** Upsert one session index row, keyed by (evaluateeUserId, externalSessionId). */
  private async upsertSessionIndex(
    evaluateeUserId: string,
    input: Omit<PeopleEvaluationSessionDto, "messages">,
    collectionPeriodId: string | null,
  ) {
    return this.prisma.peopleEvaluationSession.upsert({
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
    query: ListPeopleEvaluationSessionsRequestDto,
  ): Promise<CommonListResponseDto<PeopleEvaluationSessionResponseDto>> {
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.PeopleEvaluationSession,
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
  async reportDocument(evaluateeUserId: string, input: PeopleEvaluationDeclaredDocumentDto) {
    return this.prisma.peopleEvaluationDeclaredDocument.upsert({
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
    query: ListPeopleEvaluationDeclaredDocumentsRequestDto,
  ): Promise<CommonListResponseDto<PeopleEvaluationDeclaredDocumentResponseDto>> {
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.PeopleEvaluationDeclaredDocument,
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
    const document = await this.prisma.peopleEvaluationDeclaredDocument.findUnique({ where: { id } });
    if (!document) {
      throw new NotFoundException(`Declared document ${id} not found`);
    }
    return document;
  }
}
