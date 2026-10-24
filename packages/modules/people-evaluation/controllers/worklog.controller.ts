import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { Request } from "express";
import { AllowAnyOrigin } from "@devbie/newbie/cors/allow-any-origin.decorator";
import { InstallationAuth } from "@modules/security/authentication/installation/installation.decorator";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import {
  MAX_SESSIONS_PER_BATCH,
  WorklogDocumentReportDto,
  WorklogSessionReportDto,
  WorklogWorkspaceReportDto,
} from "../people-evaluation-worklog.dto";
import { AgentSessionResponseDto, DeclaredDocumentResponseDto, WorkspaceResponseDto } from "../people-evaluation.dto";
import { PeopleEvaluationWorklogInstallationService } from "../people-evaluation-worklog-installation.service";
import { PeopleEvaluationSessionStore } from "../people-evaluation-session.store";
import { PeopleEvaluationService } from "../people-evaluation.service";
import { ResolvedWorklogToken } from "../people-evaluation-worklog-token.resolver";

/**
 * Worklog surface (ADR-029): the ingest endpoints the member-side worklog
 * agent posts to, plus the supervisor-side reads of what it reported.
 *
 * Ingest authentication is the installation token presented as
 * `Authorization: Bearer <token>` (ADR-016): the token resolves to exactly one
 * evaluatee, so every payload item is checked against that evaluatee before it
 * is written. The service never adjudicates the company/personal workspace
 * split — it only stores what the member declared.
 */
@ApiTags("People Evaluation / Worklog")
@ApiBearerAuth()
@Controller("people/worklog")
export class PeopleEvaluationWorklogController {
  constructor(
    private readonly evaluation: PeopleEvaluationService,
    private readonly sessions: PeopleEvaluationSessionStore,
    private readonly installations: PeopleEvaluationWorklogInstallationService,
  ) {}

  // --- Ingest (worklog token) --------------------------------------------

  @Post("workspaces")
  @InstallationAuth("people-evaluation")
  @AllowAnyOrigin()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Report the evaluatee's declared workspaces" })
  @ApiResponse({ status: 204, description: "Workspaces stored." })
  @ApiResponse({ status: 401, description: "Invalid or revoked worklog token." })
  @ApiResponse({ status: 403, description: "Payload targets an evaluatee other than the token owner." })
  async reportWorkspaces(
    @Req() req: Request & { installation: ResolvedWorklogToken },
    @Body() body: WorklogWorkspaceReportDto,
  ): Promise<void> {
    for (const workspace of body.workspaces) {
      this.assertOwnEvaluatee(req.installation.evaluateeUserId, workspace.evaluateeUserId);
      await this.evaluation.reportWorkspace(req.installation.installationId, workspace);
    }
    await this.installations.touchOnIngest(req.installation.installationId);
  }

  @Post("sessions")
  @InstallationAuth("people-evaluation")
  @AllowAnyOrigin()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Report collected agent sessions: index to PG, transcript chunks to ClickHouse" })
  @ApiResponse({ status: 204, description: "Batch stored." })
  @ApiResponse({ status: 401, description: "Invalid or revoked worklog token." })
  @ApiResponse({ status: 403, description: "Payload targets an evaluatee other than the token owner." })
  @ApiResponse({ status: 413, description: `More than ${MAX_SESSIONS_PER_BATCH} sessions in one batch.` })
  async reportSessions(
    @Req() req: Request & { installation: ResolvedWorklogToken },
    @Body() body: WorklogSessionReportDto,
  ): Promise<void> {
    const evaluateeUserId = req.installation.evaluateeUserId;

    for (const session of body.sessions) {
      this.assertOwnEvaluatee(evaluateeUserId, session.evaluateeUserId);

      const index = await this.evaluation.reportSession({
        evaluateeUserId: session.evaluateeUserId,
        workspaceKey: session.workspaceKey,
        externalSessionId: session.externalSessionId,
        source: session.source,
        model: session.model,
        turnCount: session.turnCount,
        messageCount: session.messageCount,
        toolCallCount: session.toolCallCount,
        toolNames: session.toolNames,
        touchedFiles: session.touchedFiles,
        durationMs: session.durationMs,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
      });

      await this.sessions.insertMessages(
        session.messages.map((message) => ({
          evaluatee_user_id: evaluateeUserId,
          session_id: index.id,
          workspace_key: session.workspaceKey,
          seq: message.seq,
          role: message.role,
          content: message.content,
          tool_name: message.toolName ?? "",
          tool_calls: message.toolCalls ?? "",
          token_count: message.tokenCount ?? 0,
          created_at: (message.createdAt ?? session.startedAt).toISOString(),
        })),
      );
    }

    await this.installations.touchOnIngest(req.installation.installationId);
  }

  @Post("documents")
  @InstallationAuth("people-evaluation")
  @AllowAnyOrigin()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Report declared work artifacts (declared layer) from company workspaces" })
  @ApiResponse({ status: 204, description: "Documents stored." })
  async reportDocuments(
    @Req() req: Request & { installation: ResolvedWorklogToken },
    @Body() body: WorklogDocumentReportDto,
  ): Promise<void> {
    for (const document of body.documents) {
      this.assertOwnEvaluatee(req.installation.evaluateeUserId, document.evaluateeUserId);
      await this.evaluation.reportDocument(document);
    }
    await this.installations.touchOnIngest(req.installation.installationId);
  }

  // --- Reads (platform JWT) ----------------------------------------------

  @Get("workspaces")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationMemberWorkspace)
  @ApiOperation({ summary: "List the workspaces a member's worklog agent has reported" })
  @ApiResponse({ type: WorkspaceResponseDto, isArray: true })
  @ApiQuery({ name: "evaluateeUserId", required: true, type: String })
  listWorkspaces(@Query("evaluateeUserId") evaluateeUserId: string) {
    return this.evaluation.listWorkspaces(evaluateeUserId);
  }

  @Get("sessions")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationAgentSession)
  @ApiOperation({ summary: "List collected agent-session index rows for a member" })
  @ApiResponse({ type: AgentSessionResponseDto, isArray: true })
  @ApiQuery({ name: "evaluateeUserId", required: true, type: String })
  @ApiQuery({ name: "collectionPeriodId", required: false, type: String })
  listSessions(
    @Query("evaluateeUserId") evaluateeUserId: string,
    @Query("collectionPeriodId") collectionPeriodId?: string,
  ) {
    return this.evaluation.listSessions(evaluateeUserId, collectionPeriodId);
  }

  @Get("documents")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationDeclaredDocument)
  @ApiOperation({ summary: "List declared work artifacts for a member" })
  @ApiResponse({ type: DeclaredDocumentResponseDto, isArray: true })
  @ApiQuery({ name: "evaluateeUserId", required: true, type: String })
  listDocuments(@Query("evaluateeUserId") evaluateeUserId: string) {
    return this.evaluation.listDocuments(evaluateeUserId);
  }

  @Get("documents/:id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.PeopleEvaluationDeclaredDocument)
  @ApiOperation({ summary: "Get one declared work artifact, including its content" })
  @ApiResponse({ status: 200, type: DeclaredDocumentResponseDto })
  getDocument(@Param("id") id: string) {
    return this.evaluation.getDocument(id);
  }

  /**
   * A worklog token is scoped to one evaluatee: any item naming a different
   * evaluatee aborts the whole batch. Nothing is written for other members.
   */
  private assertOwnEvaluatee(tokenEvaluateeUserId: string, reportedUserId: string): void {
    if (tokenEvaluateeUserId !== reportedUserId) {
      throw new ForbiddenException("Worklog token may only report for its own evaluatee.");
    }
  }
}
