import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { Request } from "express";
import { AllowAnyOrigin } from "@devbie/newbie/cors/allow-any-origin.decorator";
import { InstallationAuth } from "@modules/security/authentication/installation/installation.decorator";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import {
  CreatePeopleEvaluationDeclaredDocumentBatchRequestDto,
  CreatePeopleEvaluationSessionBatchRequestDto,
  CreatePeopleEvaluationWorkspaceBatchRequestDto,
  GetPeopleEvaluationByIdRequestDto,
  ListPeopleEvaluationDeclaredDocumentsRequestDto,
  ListPeopleEvaluationDeclaredDocumentsResponseDto,
  ListPeopleEvaluationSessionsRequestDto,
  ListPeopleEvaluationSessionsResponseDto,
  ListPeopleEvaluationWorkspacesRequestDto,
  MAX_SESSIONS_PER_BATCH,
  PeopleEvaluationDeclaredDocumentResponseDto,
  PeopleEvaluationWorkspaceResponseDto,
} from "../people-evaluation.dto";
import { PeopleEvaluationEvidenceService } from "../people-evaluation-evidence.service";
import { PeopleEvaluationInstallationService } from "../people-evaluation-installation.service";
import { PeopleEvaluationSessionStore } from "../people-evaluation-session.store";
import { ResolvedPeopleEvaluationInstallationToken } from "../people-evaluation-installation-token.resolver";

/**
 * Evidence surface (ADR-029): the ingest endpoints the member-side installation
 * agent posts to, plus the supervisor-side reads of what it reported.
 *
 * Ingest authentication is the installation token presented as
 * `Authorization: Bearer <token>` (ADR-016). The token resolves to exactly one
 * evaluatee, and that id is passed explicitly to the service — payloads carry no
 * evaluatee field, so there is no second identity source to reconcile. The
 * service never adjudicates the company/personal workspace split — it only
 * stores what the member declared.
 */
@ApiTags("People Evaluation / Evidence")
@ApiBearerAuth()
@Controller("people/evidence")
export class PeopleEvaluationEvidenceController {
  constructor(
    private readonly evidence: PeopleEvaluationEvidenceService,
    private readonly sessions: PeopleEvaluationSessionStore,
    private readonly installations: PeopleEvaluationInstallationService,
  ) {}

  // --- Ingest (installation token) ---------------------------------------

  @Post("workspaces")
  @InstallationAuth("people-evaluation")
  @AllowAnyOrigin()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Report the evaluatee's declared workspaces" })
  @ApiResponse({ status: 204, description: "Workspaces stored." })
  @ApiResponse({ status: 401, description: "Invalid or revoked installation token." })
  async reportWorkspaces(
    @Req() req: Request & { installation: ResolvedPeopleEvaluationInstallationToken },
    @Body() body: CreatePeopleEvaluationWorkspaceBatchRequestDto,
  ): Promise<void> {
    const { evaluateeUserId, installationId } = req.installation;
    for (const workspace of body.workspaces) {
      await this.evidence.reportWorkspace(evaluateeUserId, installationId, workspace);
    }
    await this.installations.touchOnIngest(installationId);
  }

  @Post("sessions")
  @InstallationAuth("people-evaluation")
  @AllowAnyOrigin()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Report collected agent sessions: index to PG, transcript chunks to ClickHouse" })
  @ApiResponse({ status: 204, description: "Batch stored." })
  @ApiResponse({ status: 400, description: `More than ${MAX_SESSIONS_PER_BATCH} sessions in one batch.` })
  @ApiResponse({ status: 401, description: "Invalid or revoked installation token." })
  async reportSessions(
    @Req() req: Request & { installation: ResolvedPeopleEvaluationInstallationToken },
    @Body() body: CreatePeopleEvaluationSessionBatchRequestDto,
  ): Promise<void> {
    const { evaluateeUserId, installationId } = req.installation;

    // Idempotent re-ingest: the PG index is an upsert keyed by
    // (evaluateeUserId, externalSessionId), and transcript chunks dedupe on
    // (session_id, seq) in ClickHouse. If a CH insert fails after its PG
    // upsert succeeded, the agent simply re-posts the batch — the retried
    // upsert is a no-op and the retried chunks collapse on read.
    const indexes = await this.evidence.reportSessions(
      evaluateeUserId,
      body.sessions.map(({ messages: _messages, ...index }) => index),
    );

    for (const [position, session] of body.sessions.entries()) {
      await this.sessions.insertMessages(
        session.messages.map((message) => ({
          evaluatee_user_id: evaluateeUserId,
          session_id: indexes[position].id,
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

    await this.installations.touchOnIngest(installationId);
  }

  @Post("documents")
  @InstallationAuth("people-evaluation")
  @AllowAnyOrigin()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Report declared work artifacts (declared layer) from company workspaces" })
  @ApiResponse({ status: 204, description: "Documents stored." })
  async reportDocuments(
    @Req() req: Request & { installation: ResolvedPeopleEvaluationInstallationToken },
    @Body() body: CreatePeopleEvaluationDeclaredDocumentBatchRequestDto,
  ): Promise<void> {
    const { evaluateeUserId, installationId } = req.installation;
    for (const document of body.documents) {
      await this.evidence.reportDocument(evaluateeUserId, document);
    }
    await this.installations.touchOnIngest(installationId);
  }

  // --- Reads (platform JWT) ----------------------------------------------

  @Get("workspaces")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationWorkspace)
  @ApiOperation({ summary: "List the workspaces a member's installation agent has reported" })
  @ApiResponse({ type: PeopleEvaluationWorkspaceResponseDto, isArray: true })
  listWorkspaces(@Query() query: ListPeopleEvaluationWorkspacesRequestDto) {
    return this.evidence.listWorkspaces(query);
  }

  @Get("sessions")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationSession)
  @ApiOperation({ summary: "List collected session index rows for a member" })
  @ApiResponse({ type: ListPeopleEvaluationSessionsResponseDto })
  listSessions(@Query() query: ListPeopleEvaluationSessionsRequestDto) {
    return this.evidence.listSessions(query);
  }

  @Get("documents")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationDeclaredDocument)
  @ApiOperation({ summary: "List declared work artifacts for a member" })
  @ApiResponse({ type: ListPeopleEvaluationDeclaredDocumentsResponseDto })
  listDocuments(@Query() query: ListPeopleEvaluationDeclaredDocumentsRequestDto) {
    return this.evidence.listDocuments(query);
  }

  @Get("documents/:id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.PeopleEvaluationDeclaredDocument)
  @ApiOperation({ summary: "Get one declared work artifact, including its content" })
  @ApiResponse({ status: 200, type: PeopleEvaluationDeclaredDocumentResponseDto })
  getDocument(@Param() params: GetPeopleEvaluationByIdRequestDto) {
    return this.evidence.getDocument(params.id);
  }
}
