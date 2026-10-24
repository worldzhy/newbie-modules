import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { AllowAnyOrigin } from "@devbie/newbie/cors/allow-any-origin.decorator";
import { InstallationAuth } from "@modules/security/authentication/installation/installation.decorator";
import {
  CollectorDocumentReportDto,
  CollectorSessionReportDto,
  CollectorWorkspaceReportDto,
  MAX_SESSIONS_PER_BATCH,
} from "../people-evaluation-collector.dto";
import { PeopleEvaluationInstallationService } from "../people-evaluation-installation.service";
import { PeopleEvaluationSessionStore } from "../people-evaluation-session.store";
import { PeopleEvaluationService } from "../people-evaluation.service";
import { ResolvedPeopleCollectorToken } from "../people-evaluation-token.resolver";

/**
 * Ingest surface for the member-side work collector (ADR-029).
 *
 * Authentication is the collector installation token presented as
 * `Authorization: Bearer <token>` (ADR-016): the token resolves to exactly one
 * member, so every payload item is checked against that member before it is
 * written. The service never adjudicates the company/personal workspace split —
 * it only stores what the member declared.
 */
@ApiTags("People Evaluation / Collector")
@ApiBearerAuth()
@Controller("people-evaluation/collector")
export class PeopleEvaluationCollectorController {
  constructor(
    private readonly evaluation: PeopleEvaluationService,
    private readonly sessions: PeopleEvaluationSessionStore,
    private readonly installations: PeopleEvaluationInstallationService,
  ) {}

  @Post("workspaces")
  @InstallationAuth("people-evaluation")
  @AllowAnyOrigin()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Report the member's declared workspaces and their repository mapping" })
  @ApiResponse({ status: 204, description: "Workspaces stored." })
  @ApiResponse({ status: 401, description: "Invalid or revoked collector token." })
  @ApiResponse({ status: 403, description: "Payload targets a member other than the token owner." })
  async reportWorkspaces(
    @Req() req: Request & { installation: ResolvedPeopleCollectorToken },
    @Body() body: CollectorWorkspaceReportDto,
  ): Promise<void> {
    for (const workspace of body.workspaces) {
      this.assertOwnMember(req.installation.memberUserId, workspace.evaluateeUserId);
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
  @ApiResponse({ status: 401, description: "Invalid or revoked collector token." })
  @ApiResponse({ status: 403, description: "Payload targets a member other than the token owner." })
  @ApiResponse({ status: 413, description: `More than ${MAX_SESSIONS_PER_BATCH} sessions in one batch.` })
  async reportSessions(
    @Req() req: Request & { installation: ResolvedPeopleCollectorToken },
    @Body() body: CollectorSessionReportDto,
  ): Promise<void> {
    const memberUserId = req.installation.memberUserId;

    for (const session of body.sessions) {
      this.assertOwnMember(memberUserId, session.evaluateeUserId);

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
          member_user_id: memberUserId,
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
    @Req() req: Request & { installation: ResolvedPeopleCollectorToken },
    @Body() body: CollectorDocumentReportDto,
  ): Promise<void> {
    for (const document of body.documents) {
      this.assertOwnMember(req.installation.memberUserId, document.evaluateeUserId);
      await this.evaluation.reportDocument(document);
    }
    await this.installations.touchOnIngest(req.installation.installationId);
  }

  /**
   * A collector token is scoped to one member: any item naming a different
   * member aborts the whole batch. Nothing is written for other members.
   */
  private assertOwnMember(tokenMemberUserId: string, reportedUserId: string): void {
    if (tokenMemberUserId !== reportedUserId) {
      throw new ForbiddenException("Collector token may only report for its own member.");
    }
  }
}
