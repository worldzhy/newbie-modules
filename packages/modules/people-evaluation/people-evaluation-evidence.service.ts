import { Injectable, NotFoundException } from "@nestjs/common";
import { PeopleEvaluationPeriod, PeopleEvaluationPeriodType, Prisma } from "@generated/prisma/client";
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
   * Upsert the PG index row for one collected agent session. Transcript
   * chunks land in ClickHouse; this row is what the evaluation agent lists
   * and drills into. The ingest DTO is the single payload contract; the index
   * simply does not use the transcript slice of it.
   */
  async reportSession(evaluateeUserId: string, input: Omit<PeopleEvaluationSessionDto, "messages">) {
    const period = await this.findCollectionPeriodAt(input.startedAt);
    return this.prisma.peopleEvaluationSession.upsert({
      where: {
        evaluateeUserId_externalSessionId: {
          evaluateeUserId,
          externalSessionId: input.externalSessionId,
        },
      },
      create: {
        evaluateeUserId,
        collectionPeriodId: period?.id,
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
        collectionPeriodId: period?.id,
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
          externalSessionId: true,
          workspaceKey: true,
          model: true,
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

  /** Locates the COLLECTION period containing an event timestamp, if any. */
  private async findCollectionPeriodAt(at: Date): Promise<PeopleEvaluationPeriod | null> {
    return this.prisma.peopleEvaluationPeriod.findFirst({
      where: {
        type: PeopleEvaluationPeriodType.COLLECTION,
        periodStart: { lte: at },
        periodEnd: { gt: at },
      },
      orderBy: { periodStart: "desc" },
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
          workspaceKey: true,
          title: true,
          refPath: true,
          description: true,
          capturedAt: true,
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
