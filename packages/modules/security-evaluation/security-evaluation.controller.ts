import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { EvaluationFindingService } from "@modules/evaluation/evaluation-finding.service";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";

import { SecurityEvaluationAssetService } from "./assets/security-evaluation-asset.service";
import { SecurityEvaluationReportService } from "./reporting/security-evaluation-report.service";
import { SecurityEvaluationRunService } from "./security-evaluation-run.service";
import { SECURITY_EVALUATION_SUBJECT_KINDS } from "./security-evaluation.constants";
import {
  GetSecurityEvaluationAssetRequestDto,
  GetSecurityEvaluationReportRequestDto,
  IngestSecurityEvaluationSubjectRequestDto,
  IngestSecurityEvaluationSubjectResponseDto,
  ListSecurityEvaluationAssetKnowledgeItemsRequestDto,
  ListSecurityEvaluationAssetKnowledgeItemsResponseDto,
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
} from "./security-evaluation.dto";

/**
 * Security-evaluation HTTP surface (ADR-022, ADR-039).
 *
 * Asset inventory reads, platform-level subject ingest, run triggering,
 * archived result reads, the finding list and the single-axis report. The run
 * lifecycle and finding lifecycle belong to the evaluation skeleton; this
 * controller only bridges the feature's DTO surface.
 *
 * Every read is a platform view: the optional `scopeType` / `scopeId` pair is a
 * provenance filter, not an authorization boundary. Access is decided by the
 * system-level permission grant alone (ADR-039 D3).
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
    private readonly runs: SecurityEvaluationRunService,
    private readonly findings: EvaluationFindingService,
    private readonly reports: SecurityEvaluationReportService,
  ) {}

  // --- Subject ingest ----------------------------------------------------

  @Post("subjects/sync")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.EvaluationSubject)
  @ApiOperation({
    summary: "Ingest one subject and its asset row (platform-level, idempotent) with the submitting source",
  })
  @ApiResponse({ status: 200, type: IngestSecurityEvaluationSubjectResponseDto })
  async ingestSubject(@Body() body: IngestSecurityEvaluationSubjectRequestDto) {
    const [result] = await this.assets.ingest([{ ...body }]);
    return result;
  }

  // --- Assets ------------------------------------------------------------

  @Get("assets")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.SecurityEvaluationAsset)
  @ApiOperation({ summary: "List asset inventory rows (platform view, optionally filtered by provenance source)" })
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

  @Get("assets/:assetId/knowledge-items")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.SecurityEvaluationAsset)
  @ApiOperation({ summary: "List the current-state knowledge items of one asset" })
  @ApiResponse({ status: 200, type: ListSecurityEvaluationAssetKnowledgeItemsResponseDto })
  listAssetKnowledgeItems(
    @Param() params: GetSecurityEvaluationAssetRequestDto,
    @Query() query: ListSecurityEvaluationAssetKnowledgeItemsRequestDto,
  ) {
    return this.assets.listKnowledgeItems({
      assetId: params.assetId,
      type: query.type,
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
  @ApiOperation({
    summary: "List runs (platform view, optionally filtered by provenance source or subject), newest first",
  })
  @ApiResponse({ status: 200, type: ListSecurityEvaluationRunsResponseDto })
  async listRuns(@Query() query: ListSecurityEvaluationRunsRequestDto) {
    const subjectIds = query.subjectId ? null : await this.assets.listSubjectIdsBySource(query);
    return this.runs.listRuns({
      subjectIds: subjectIds ?? undefined,
      subjectId: query.subjectId,
      ruleSetVersionId: query.ruleSetVersionId,
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
      ruleSetVersionId: query.ruleSetVersionId,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  // --- Findings ----------------------------------------------------------

  @Get("findings")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EvaluationFinding)
  @ApiOperation({
    summary:
      "List findings (platform view), optionally filtered by provenance source, subject, run, evaluationKey, status, severity",
  })
  @ApiResponse({ status: 200, type: ListSecurityEvaluationFindingsResponseDto })
  async listFindings(@Query() query: ListSecurityEvaluationFindingsRequestDto) {
    const subjectIds = query.subjectId ? null : await this.assets.listSubjectIdsBySource(query);
    return this.findings.listFindings({
      subjectIds: subjectIds ?? undefined,
      subjectId: query.subjectId,
      runId: query.runId,
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
  @ApiOperation({ summary: "Single-axis security report (platform view, optionally filtered by provenance source)" })
  @ApiResponse({ status: 200, type: SecurityEvaluationReportResponseDto })
  async getReport(@Query() query: GetSecurityEvaluationReportRequestDto) {
    const subjectIds = await this.assets.listSubjectIdsBySource(query);
    return this.reports.getReport(subjectIds);
  }
}
