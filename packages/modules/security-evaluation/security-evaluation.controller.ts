import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { EvaluationFindingService } from "@modules/evaluation/evaluation-finding.service";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";

import { SecurityEvaluationAssetService } from "./assets/security-evaluation-asset.service";
import { SecurityEvaluationAssetSyncService } from "./assets/security-evaluation-asset-sync.service";
import { SecurityEvaluationReportService } from "./reporting/security-evaluation-report.service";
import { SecurityEvaluationRunService } from "./security-evaluation-run.service";
import { SECURITY_EVALUATION_SUBJECT_KINDS } from "./security-evaluation.constants";
import {
  GetSecurityEvaluationAssetRequestDto,
  GetSecurityEvaluationReportRequestDto,
  ListSecurityEvaluationAssetFactsRequestDto,
  ListSecurityEvaluationAssetFactsResponseDto,
  ListSecurityEvaluationAssetsRequestDto,
  ListSecurityEvaluationAssetsResponseDto,
  ListSecurityEvaluationFindingsRequestDto,
  ListSecurityEvaluationFindingsResponseDto,
  ListSecurityEvaluationResultsRequestDto,
  ListSecurityEvaluationResultsResponseDto,
  ListSecurityEvaluationRunsRequestDto,
  ListSecurityEvaluationRunsResponseDto,
  SecurityEvaluationReportResponseDto,
  SecurityEvaluationRunAcceptedResponseDto,
  StartSecurityEvaluationRunRequestDto,
  SyncSecurityEvaluationSubjectsRequestDto,
  SyncSecurityEvaluationSubjectsResponseDto,
} from "./security-evaluation.dto";

/**
 * Security-evaluation HTTP surface (ADR-022).
 *
 * Asset inventory reads, host-driven subject sync, run triggering, archived
 * result reads, the finding list and the single-axis report. The run lifecycle
 * and finding lifecycle belong to the evaluation skeleton; this controller only
 * bridges the feature's DTO surface.
 *
 * There is deliberately no finding-suppression endpoint here: human decisions
 * on findings are skeleton-level operations, not this feature's vocabulary.
 */
@ApiTags("Security Evaluation")
@ApiBearerAuth()
@Controller("security-evaluation")
export class SecurityEvaluationController {
  constructor(
    private readonly assets: SecurityEvaluationAssetService,
    private readonly assetSync: SecurityEvaluationAssetSyncService,
    private readonly runs: SecurityEvaluationRunService,
    private readonly findings: EvaluationFindingService,
    private readonly reports: SecurityEvaluationReportService,
  ) {}

  // --- Subject sync ------------------------------------------------------

  @Post("subjects/sync")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.EvaluationSubject)
  @ApiOperation({ summary: "Synchronise evaluation subjects and their asset rows from the host provider (idempotent)" })
  @ApiResponse({ status: 200, type: SyncSecurityEvaluationSubjectsResponseDto })
  syncSubjects(@Body() body: SyncSecurityEvaluationSubjectsRequestDto) {
    return this.assetSync.sync({ scopeType: body.scopeType, scopeId: body.scopeId });
  }

  // --- Assets ------------------------------------------------------------

  @Get("assets")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.SecurityEvaluationAsset)
  @ApiOperation({ summary: "List asset inventory rows under a host scope" })
  @ApiResponse({ status: 200, type: ListSecurityEvaluationAssetsResponseDto })
  listAssets(@Query() query: ListSecurityEvaluationAssetsRequestDto) {
    return this.assets.listAssets({
      scopeType: query.scopeType,
      scopeId: query.scopeId,
      kinds: [...SECURITY_EVALUATION_SUBJECT_KINDS],
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get("assets/:assetId/facts")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.SecurityEvaluationAssetFact)
  @ApiOperation({ summary: "List the current-state facts of one asset" })
  @ApiResponse({ status: 200, type: ListSecurityEvaluationAssetFactsResponseDto })
  listAssetFacts(
    @Param() params: GetSecurityEvaluationAssetRequestDto,
    @Query() query: ListSecurityEvaluationAssetFactsRequestDto,
  ) {
    return this.assets.listFacts({
      assetId: params.assetId,
      factType: query.factType,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  // --- Runs --------------------------------------------------------------

  @Post("runs")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.EvaluationRun)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: "Dispatch a run (fire-and-forget). The caller polls `GET /security-evaluation/runs` for its row.",
  })
  @ApiResponse({ status: 202, type: SecurityEvaluationRunAcceptedResponseDto })
  async startRun(
    @Body() body: StartSecurityEvaluationRunRequestDto,
    @Req() request: UserRequest,
  ): Promise<SecurityEvaluationRunAcceptedResponseDto> {
    await this.runs.startRun({
      ...body,
      requestedByRef: request.user.userId,
    });
    return { accepted: true };
  }

  @Get("runs")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EvaluationRun)
  @ApiOperation({ summary: "List runs for a subject (newest first)" })
  @ApiResponse({ status: 200, type: ListSecurityEvaluationRunsResponseDto })
  listRuns(@Query() query: ListSecurityEvaluationRunsRequestDto) {
    return this.runs.listRuns({
      subjectId: query.subjectId,
      criteriaVersionId: query.criteriaVersionId,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  // --- Results -----------------------------------------------------------

  @Get("results")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EvaluationResult)
  @ApiOperation({ summary: "List archived results for a subject (newest first)" })
  @ApiResponse({ status: 200, type: ListSecurityEvaluationResultsResponseDto })
  listResults(@Query() query: ListSecurityEvaluationResultsRequestDto) {
    return this.runs.listResults({
      subjectId: query.subjectId,
      criteriaVersionId: query.criteriaVersionId,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  // --- Findings ----------------------------------------------------------

  @Get("findings")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EvaluationFinding)
  @ApiOperation({ summary: "List findings for a subject, optionally filtered by evaluationKey, status and severity" })
  @ApiResponse({ status: 200, type: ListSecurityEvaluationFindingsResponseDto })
  listFindings(@Query() query: ListSecurityEvaluationFindingsRequestDto) {
    return this.findings.listFindings({
      subjectId: query.subjectId,
      evaluationKey: query.evaluationKey,
      status: query.status,
      severity: query.severity,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  // --- Report ------------------------------------------------------------

  @Get("report")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EvaluationFinding)
  @ApiOperation({ summary: "Single-axis security report for a host scope (no composite score)" })
  @ApiResponse({ status: 200, type: SecurityEvaluationReportResponseDto })
  getReport(@Query() query: GetSecurityEvaluationReportRequestDto) {
    return this.reports.getReport({ scopeType: query.scopeType, scopeId: query.scopeId });
  }
}
