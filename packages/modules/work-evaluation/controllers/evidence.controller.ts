import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { Request } from "express";
import { AllowAnyOrigin } from "@devbie/newbie/cors/allow-any-origin.decorator";
import { InstallationAuth } from "@modules/security/authentication/installation/installation.decorator";
import { PERMISSION_AUTHORIZER, PermissionAuthorizer } from "@modules/security/ports/permission.authorizer";
import { UserRequest } from "@modules/security/security.interface";
import {
  CreateWorkEvaluationDeclaredDocumentBatchRequestDto,
  CreateWorkEvaluationSessionBatchRequestDto,
  CreateWorkEvaluationWorkspaceBatchRequestDto,
  GetWorkEvaluationByIdRequestDto,
  GetWorkEvaluationDeclaredDocumentRequestDto,
  ListWorkEvaluationDeclaredDocumentsRequestDto,
  ListWorkEvaluationDeclaredDocumentsResponseDto,
  ListWorkEvaluationSessionsRequestDto,
  ListWorkEvaluationSessionsResponseDto,
  ListWorkEvaluationWorkspacesRequestDto,
  MAX_SESSIONS_PER_BATCH,
  WorkEvaluationDeclaredDocumentResponseDto,
  WorkEvaluationWorkspaceResponseDto,
} from "../work-evaluation.dto";
import { WorkEvaluationEvidenceService } from "../work-evaluation-evidence.service";
import { WorkEvaluationInstallationService } from "../work-evaluation-installation.service";
import { WorkEvaluationSessionStore } from "../work-evaluation-session.store";
import { ResolvedWorkEvaluationInstallationToken } from "../work-evaluation-installation-token.resolver";

/**
 * Evidence surface (ADR-024): the ingest endpoints the member-side installation
 * agent posts to, plus the supervisor-side reads of what it reported.
 *
 * Ingest authentication is the installation token presented as
 * `Authorization: Bearer <token>` (ADR-016). The token resolves to exactly one
 * evaluatee, and that id is passed explicitly to the service — payloads carry no
 * evaluatee field, so there is no second identity source to reconcile. The
 * service never adjudicates the company/personal workspace split — it only
 * stores what the member declared.
 *
 * Reads are authorized by identity, not by the request alone: a caller may
 * always read their own evidence, and reading another member's evidence
 * requires the corresponding manager permission (`List`/`Get` on the model).
 * `getDocument` additionally resolves the document inside the evaluatee's
 * rows, so a guessed id cannot cross the evaluated member boundary.
 */
@ApiTags("Work Evaluation / Evidence")
@ApiBearerAuth()
@Controller("work-evaluation/evidence")
export class WorkEvaluationEvidenceController {
  constructor(
    private readonly evidence: WorkEvaluationEvidenceService,
    private readonly sessions: WorkEvaluationSessionStore,
    private readonly installations: WorkEvaluationInstallationService,
    @Optional()
    @Inject(PERMISSION_AUTHORIZER)
    private readonly authorizer?: PermissionAuthorizer,
  ) {}

  /**
   * Resolves the evaluatee a read may target. A missing or equal id means "own
   * evidence"; any other id is a cross-member read and requires the manager
   * permission for the resource being read. The check fails closed when the
   * identity provider did not bind an authorizer.
   */
  private async resolveReadableEvaluatee(
    request: UserRequest,
    requested: string | undefined,
    requirement: { resource: string; action: PermissionAction },
  ): Promise<string> {
    const callerUserId = request.user.userId;
    if (!requested || requested === callerUserId) return callerUserId;

    const permitted = this.authorizer ? await this.authorizer.authorize(callerUserId, requirement) : false;
    if (!permitted) {
      throw new ForbiddenException("Reading another member's work-evaluation evidence requires manager permission.");
    }
    return requested;
  }

  // --- Ingest (installation token) ---------------------------------------

  @Post("workspaces")
  @InstallationAuth("work-evaluation")
  @AllowAnyOrigin()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Report the evaluatee's declared workspaces" })
  @ApiResponse({ status: 204, description: "Workspaces stored." })
  @ApiResponse({ status: 401, description: "Invalid or revoked installation token." })
  async reportWorkspaces(
    @Req() req: Request & { installation: ResolvedWorkEvaluationInstallationToken },
    @Body() body: CreateWorkEvaluationWorkspaceBatchRequestDto,
  ): Promise<void> {
    const { evaluateeUserId, installationId } = req.installation;
    for (const workspace of body.workspaces) {
      await this.evidence.reportWorkspace(evaluateeUserId, installationId, workspace);
    }
    await this.installations.touchOnIngest(installationId);
  }

  @Post("sessions")
  @InstallationAuth("work-evaluation")
  @AllowAnyOrigin()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Report collected agent sessions: index to PG, transcript chunks to ClickHouse" })
  @ApiResponse({ status: 204, description: "Batch stored." })
  @ApiResponse({ status: 400, description: `More than ${MAX_SESSIONS_PER_BATCH} sessions in one batch.` })
  @ApiResponse({ status: 401, description: "Invalid or revoked installation token." })
  async reportSessions(
    @Req() req: Request & { installation: ResolvedWorkEvaluationInstallationToken },
    @Body() body: CreateWorkEvaluationSessionBatchRequestDto,
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

    await Promise.all(
      body.sessions.map((session, position) =>
        this.sessions.insertMessages(
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
        ),
      ),
    );

    await this.installations.touchOnIngest(installationId);
  }

  @Post("documents")
  @InstallationAuth("work-evaluation")
  @AllowAnyOrigin()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Report declared work artifacts (declared layer) from company workspaces" })
  @ApiResponse({ status: 204, description: "Documents stored." })
  async reportDocuments(
    @Req() req: Request & { installation: ResolvedWorkEvaluationInstallationToken },
    @Body() body: CreateWorkEvaluationDeclaredDocumentBatchRequestDto,
  ): Promise<void> {
    const { evaluateeUserId, installationId } = req.installation;
    for (const document of body.documents) {
      await this.evidence.reportDocument(evaluateeUserId, document);
    }
    await this.installations.touchOnIngest(installationId);
  }

  // --- Reads (platform JWT, self or manager) -----------------------------

  @Get("workspaces")
  @ApiOperation({ summary: "List the workspaces a member's installation agent has reported (own by default)" })
  @ApiResponse({ type: WorkEvaluationWorkspaceResponseDto, isArray: true })
  @ApiResponse({ status: 403, description: "Reading another member's evidence without manager permission." })
  async listWorkspaces(@Req() request: UserRequest, @Query() query: ListWorkEvaluationWorkspacesRequestDto) {
    const evaluateeUserId = await this.resolveReadableEvaluatee(request, query.evaluateeUserId, {
      resource: Prisma.ModelName.WorkEvaluationWorkspace,
      action: PermissionAction.List,
    });
    return this.evidence.listWorkspaces({ ...query, evaluateeUserId });
  }

  @Get("sessions")
  @ApiOperation({ summary: "List collected session index rows for a member (own by default)" })
  @ApiResponse({ type: ListWorkEvaluationSessionsResponseDto })
  @ApiResponse({ status: 403, description: "Reading another member's evidence without manager permission." })
  async listSessions(@Req() request: UserRequest, @Query() query: ListWorkEvaluationSessionsRequestDto) {
    const evaluateeUserId = await this.resolveReadableEvaluatee(request, query.evaluateeUserId, {
      resource: Prisma.ModelName.WorkEvaluationSession,
      action: PermissionAction.List,
    });
    return this.evidence.listSessions({ ...query, evaluateeUserId });
  }

  @Get("documents")
  @ApiOperation({ summary: "List declared work artifacts for a member (own by default)" })
  @ApiResponse({ type: ListWorkEvaluationDeclaredDocumentsResponseDto })
  @ApiResponse({ status: 403, description: "Reading another member's evidence without manager permission." })
  async listDocuments(@Req() request: UserRequest, @Query() query: ListWorkEvaluationDeclaredDocumentsRequestDto) {
    const evaluateeUserId = await this.resolveReadableEvaluatee(request, query.evaluateeUserId, {
      resource: Prisma.ModelName.WorkEvaluationDeclaredDocument,
      action: PermissionAction.List,
    });
    return this.evidence.listDocuments({ ...query, evaluateeUserId });
  }

  @Get("documents/:id")
  @ApiOperation({ summary: "Get one declared work artifact, including its content (own by default)" })
  @ApiResponse({ status: 200, type: WorkEvaluationDeclaredDocumentResponseDto })
  @ApiResponse({ status: 403, description: "Reading another member's evidence without manager permission." })
  async getDocument(
    @Param() params: GetWorkEvaluationByIdRequestDto,
    @Query() query: GetWorkEvaluationDeclaredDocumentRequestDto,
    @Req() request: UserRequest,
  ) {
    const evaluateeUserId = await this.resolveReadableEvaluatee(request, query.evaluateeUserId, {
      resource: Prisma.ModelName.WorkEvaluationDeclaredDocument,
      action: PermissionAction.Get,
    });
    return this.evidence.getDocument(params.id, evaluateeUserId);
  }
}
