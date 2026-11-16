import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, Req, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiExtraModels, ApiOperation, ApiResponse, ApiTags, getSchemaPath } from "@nestjs/swagger";
import type { Response } from "express";
import { EvaluationFindingStatus, PermissionAction, Prisma } from "@generated/prisma/client";
import { EvaluationCriteriaService } from "@modules/evaluation/evaluation-criteria.service";
import { EvaluationFindingService } from "@modules/evaluation/evaluation-finding.service";
import { EvaluationResultService } from "@modules/evaluation/evaluation-result.service";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";

import { SecurityEvaluationAssetService } from "./assets/security-evaluation-asset.service";
import { SecurityEvaluationCodeScanExcerptService } from "./evidence/security-evaluation-code-scan-excerpt.service";
import { SecurityEvaluationReportService } from "./reporting/security-evaluation-report.service";
import { SecurityEvaluationRunService } from "./security-evaluation-run.service";
import {
  RequestWebOriginVerificationDto,
  WebOriginChallengeDto,
  WebOriginVerificationResultDto,
} from "./security-evaluation-web-origin.dto";
import {
  SecurityEvaluationAwsAccountMaterialDto,
  SecurityEvaluationRepositoryMaterialDto,
  SecurityEvaluationWebOriginMaterialDto,
  type SecurityEvaluationSubjectMaterial,
} from "./security-evaluation-material.dto";
import { SECURITY_EVALUATION_FINDING_STALE_AFTER_DAYS } from "./security-evaluation.constants";
import {
  GetSecurityEvaluationFindingRequestDto,
  GetSecurityEvaluationReportRequestDto,
  GetSecurityEvaluationSubjectRequestDto,
  IngestSecurityEvaluationSubjectRequestDto,
  IngestSecurityEvaluationSubjectResponseDto,
  ListSecurityEvaluationAssetKnowledgeItemsRequestDto,
  ListSecurityEvaluationAssetKnowledgeItemsResponseDto,
  ListSecurityEvaluationFindingsRequestDto,
  ListSecurityEvaluationFindingsResponseDto,
  ListSecurityEvaluationResultsRequestDto,
  ListSecurityEvaluationResultsResponseDto,
  ListSecurityEvaluationRunsRequestDto,
  ListSecurityEvaluationRunsResponseDto,
  ListSecurityEvaluationSubjectsRequestDto,
  ListSecurityEvaluationSubjectsResponseDto,
  SecurityEvaluationFindingDetailResponseDto,
  SecurityEvaluationFindingResponseDto,
  SecurityEvaluationReportResponseDto,
  SecurityEvaluationRunAcceptedResponseDto,
  SecurityEvaluationSubjectConflictResponseDto,
  StartSecurityEvaluationRunRequestDto,
  UpdateSecurityEvaluationSubjectMaterialRequestDto,
  UpdateSecurityEvaluationSubjectRequestDto,
} from "./security-evaluation.dto";

/** The `SecurityEvaluationSubjectMaterial` union as a Swagger schema (ADR-071, ADR-072). */
const MATERIAL_SCHEMA = {
  oneOf: [
    { $ref: getSchemaPath(SecurityEvaluationWebOriginMaterialDto) },
    { $ref: getSchemaPath(SecurityEvaluationRepositoryMaterialDto) },
    { $ref: getSchemaPath(SecurityEvaluationAwsAccountMaterialDto) },
  ],
};

/**
 * Security-evaluation HTTP surface (ADR-022, ADR-039, ADR-068).
 *
 * Platform-level subject ingest, run triggering, archived result reads, the
 * finding list and the single-axis report. The run lifecycle and finding
 * lifecycle belong to the evaluation skeleton; this controller only bridges the
 * feature's DTO surface.
 *
 * Every read is a platform view; there is no provenance filter and no scope
 * coordinate (ADR-068 D8). Access is decided by the system-level permission
 * grant alone (ADR-039 D3).
 *
 * There is deliberately no finding-suppression endpoint here: human decisions
 * on findings are skeleton-level operations, not this feature's vocabulary.
 */
@ApiTags("Security Evaluation")
@ApiBearerAuth()
@ApiExtraModels(
  SecurityEvaluationWebOriginMaterialDto,
  SecurityEvaluationRepositoryMaterialDto,
  SecurityEvaluationAwsAccountMaterialDto,
)
@Controller("security-evaluation")
export class SecurityEvaluationController {
  constructor(
    private readonly assets: SecurityEvaluationAssetService,
    private readonly runs: SecurityEvaluationRunService,
    private readonly findings: EvaluationFindingService,
    private readonly results: EvaluationResultService,
    private readonly criteria: EvaluationCriteriaService,
    private readonly reports: SecurityEvaluationReportService,
    private readonly excerpts: SecurityEvaluationCodeScanExcerptService,
  ) {}

  // --- Subject ingest ----------------------------------------------------

  @Post("subjects")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.EvaluationSubject)
  @ApiOperation({
    summary: "Create one subject with its material (ADR-072); 409 when the subject already exists",
  })
  @ApiResponse({ status: 201, type: IngestSecurityEvaluationSubjectResponseDto })
  @ApiResponse({
    status: 409,
    description: "The `(kind, subjectKey)` is already taken; the body carries the existing subjectId.",
    type: SecurityEvaluationSubjectConflictResponseDto,
  })
  async createSubject(
    @Body() body: IngestSecurityEvaluationSubjectRequestDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<IngestSecurityEvaluationSubjectResponseDto> {
    const result = await this.assets.create({ ...body });
    response.setHeader("Location", `/security-evaluation/subjects/${result.subjectId}`);
    return result;
  }

  @Post("subjects/sync")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.EvaluationSubject)
  @ApiOperation({
    summary: "Ingest one subject (host alignment, idempotent); ordinary callers use POST /subjects",
  })
  @ApiResponse({ status: 200, type: IngestSecurityEvaluationSubjectResponseDto })
  async ingestSubject(@Body() body: IngestSecurityEvaluationSubjectRequestDto) {
    const [result] = await this.assets.ingest([{ ...body }]);
    return result;
  }

  @Patch("subjects/:subjectId")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.EvaluationSubject)
  @ApiOperation({ summary: "Update the mutable identity field of one subject (displayName)" })
  @ApiResponse({ status: 200, description: "The updated subject row." })
  updateSubject(
    @Param() params: GetSecurityEvaluationSubjectRequestDto,
    @Body() body: UpdateSecurityEvaluationSubjectRequestDto,
  ) {
    return this.assets.updateSubject(params.subjectId, { displayName: body.displayName });
  }

  // --- Knowledge items ---------------------------------------------------

  @Get("subjects")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EvaluationSubject)
  @ApiOperation({ summary: "List stored subjects (platform view), optionally filtered by kind" })
  @ApiResponse({ status: 200, type: ListSecurityEvaluationSubjectsResponseDto })
  listSubjects(@Query() query: ListSecurityEvaluationSubjectsRequestDto) {
    return this.assets.listSubjects({ kind: query.kind, page: query.page, pageSize: query.pageSize });
  }

  @Get("subjects/:subjectId/knowledge-items")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EvaluationSubject)
  @ApiOperation({ summary: "List the current-state knowledge items of one subject" })
  @ApiResponse({ status: 200, type: ListSecurityEvaluationAssetKnowledgeItemsResponseDto })
  listSubjectKnowledgeItems(
    @Param() params: GetSecurityEvaluationSubjectRequestDto,
    @Query() query: ListSecurityEvaluationAssetKnowledgeItemsRequestDto,
  ) {
    return this.assets.listKnowledgeItems({
      subjectId: params.subjectId,
      type: query.type,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  // --- Subject material --------------------------------------------------

  @Get("subjects/:subjectId/material")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EvaluationSubject)
  @ApiOperation({ summary: "Read the material of one subject — a union discriminated by kind (ADR-071)" })
  @ApiResponse({
    status: 200,
    description: "Material of the subject; the token of a web-origin is never returned by a read.",
    schema: MATERIAL_SCHEMA,
  })
  getSubjectMaterial(
    @Param() params: GetSecurityEvaluationSubjectRequestDto,
  ): Promise<SecurityEvaluationSubjectMaterial> {
    return this.assets.material(params.subjectId);
  }

  @Put("subjects/:subjectId/material")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.EvaluationSubject)
  @ApiOperation({
    summary: "Replace the mutable material fields of one subject (ADR-072); omitted fields fall back to defaults",
  })
  @ApiResponse({
    status: 200,
    description: "The replaced material, shaped like the GET response.",
    schema: MATERIAL_SCHEMA,
  })
  replaceSubjectMaterial(
    @Param() params: GetSecurityEvaluationSubjectRequestDto,
    @Body() body: UpdateSecurityEvaluationSubjectMaterialRequestDto,
  ): Promise<SecurityEvaluationSubjectMaterial> {
    return this.assets.replaceMaterial(params.subjectId, body);
  }

  @Patch("subjects/:subjectId/material")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.EvaluationSubject)
  @ApiOperation({
    summary: "Patch the mutable material fields of one subject (ADR-072); web-origin paths merge by role",
  })
  @ApiResponse({
    status: 200,
    description: "The patched material, shaped like the GET response.",
    schema: MATERIAL_SCHEMA,
  })
  patchSubjectMaterial(
    @Param() params: GetSecurityEvaluationSubjectRequestDto,
    @Body() body: UpdateSecurityEvaluationSubjectMaterialRequestDto,
  ): Promise<SecurityEvaluationSubjectMaterial> {
    return this.assets.patchMaterial(params.subjectId, body);
  }

  @Post("subjects/:subjectId/material/verification")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.EvaluationSubject)
  @ApiOperation({ summary: "Pick a verification method and return the token/record the operator must publish" })
  @ApiResponse({ status: 200, type: WebOriginChallengeDto })
  requestMaterialVerification(
    @Param() params: GetSecurityEvaluationSubjectRequestDto,
    @Body() body: RequestWebOriginVerificationDto,
  ): Promise<WebOriginChallengeDto> {
    return this.assets.requestMaterialVerification(params.subjectId, body.method);
  }

  @Post("subjects/:subjectId/material/verification/check")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.EvaluationSubject)
  @ApiOperation({ summary: "Read the published token and persist the verification outcome" })
  @ApiResponse({ status: 200, type: WebOriginVerificationResultDto })
  checkMaterialVerification(
    @Param() params: GetSecurityEvaluationSubjectRequestDto,
  ): Promise<WebOriginVerificationResultDto> {
    return this.assets.checkMaterialVerification(params.subjectId);
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
      requestedBy: request.user.userId,
    });
    return { accepted: true };
  }

  @Get("runs")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EvaluationRun)
  @ApiOperation({
    summary: "List runs (platform view, optionally filtered by subject), newest first",
  })
  @ApiResponse({ status: 200, type: ListSecurityEvaluationRunsResponseDto })
  async listRuns(@Query() query: ListSecurityEvaluationRunsRequestDto) {
    return this.runs.listRuns({
      subjectId: query.subjectId,
      ruleSetVersionId: query.ruleSetVersionId,
      status: query.status,
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
      "List findings (platform view), optionally filtered by subject, run, standardKey, status, severity, urgency, staleness",
  })
  @ApiResponse({ status: 200, type: ListSecurityEvaluationFindingsResponseDto })
  async listFindings(@Query() query: ListSecurityEvaluationFindingsRequestDto) {
    // Stale = OPEN but not re-observed within the window: the run that used to
    // reproduce the finding stopped covering it without resolving it. An
    // explicit status filter always wins over the implied OPEN.
    const staleBefore = query.staleOnly
      ? new Date(Date.now() - SECURITY_EVALUATION_FINDING_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000)
      : undefined;
    return this.findings.listFindings({
      subjectId: query.subjectId,
      runId: query.runId,
      standardKey: query.standardKey,
      status: query.status ?? (staleBefore ? EvaluationFindingStatus.OPEN : undefined),
      severity: query.severity,
      urgency: query.urgency,
      lastSeenBefore: staleBefore,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get("findings/:findingId")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EvaluationFinding)
  @ApiOperation({
    summary: "One finding with its matched evidence items from the last-seen run's archived result",
  })
  @ApiResponse({ status: 200, type: SecurityEvaluationFindingDetailResponseDto })
  async getFindingDetail(
    @Param() params: GetSecurityEvaluationFindingRequestDto,
  ): Promise<SecurityEvaluationFindingDetailResponseDto> {
    const finding = await this.findings.getFinding(params.findingId);

    // No last-seen run (should not happen for an OPEN finding, but guard anyway).
    if (!finding.lastSeenRunId) {
      return {
        finding: finding as unknown as SecurityEvaluationFindingResponseDto,
        evidenceItems: [],
      };
    }

    // Result may be missing (run status FAILED before judgment) — tolerate gracefully.
    let manifest: unknown[] = [];
    let ruleSetVersion: string | null = null;
    let standardKey: string | null = null;
    let subjectId: string | null = null;
    try {
      const runResult = await this.results.getResultForRun(finding.lastSeenRunId);
      subjectId = runResult.subjectId;
      const manifestResult = await this.results.getResultManifest(runResult.id);
      manifest = manifestResult.evidenceManifest as unknown[];
      const version = await this.criteria.getVersion(runResult.ruleSetVersionId);
      ruleSetVersion = version.version ?? null;
      standardKey = version.standardKey ?? null;
    } catch {
      // No result / run — return finding alone.
    }

    const evidenceItems = await this.attachRetainedExcerpts(
      subjectId,
      this.matchEvidence(manifest, finding.metadata as Record<string, unknown> | null),
    );

    return {
      finding: finding as unknown as SecurityEvaluationFindingResponseDto,
      ruleSetVersion,
      standardKey,
      evidenceItems,
    };
  }

  /**
   * Match a finding's metadata against the manifest. Two strategies, both
   * scoped to this feature's evidence shapes:
   *   - metadata.path → manifest item.summary (CODE_SCAN: summary is the file path)
   *   - metadata.evidenceRefs (legacy, skeleton does not persist this) → item.id
   */
  private matchEvidence(
    manifest: unknown[],
    metadata: Record<string, unknown> | null,
  ): SecurityEvaluationFindingDetailResponseDto["evidenceItems"] {
    if (!metadata || manifest.length === 0) return [];

    const byId = new Map<string, SecurityEvaluationFindingDetailResponseDto["evidenceItems"][number]>();
    const pathMatch = metadata.path;
    const pathStr = typeof pathMatch === "string" ? pathMatch : null;

    const refs = metadata.evidenceRefs;
    const refList = Array.isArray(refs) ? refs.filter((r): r is string => typeof r === "string") : [];

    for (const raw of manifest) {
      const item = raw as Record<string, unknown>;
      const id = typeof item.id === "string" ? item.id : null;
      const summary = typeof item.summary === "string" ? item.summary : null;
      if (!id) continue;

      const matchedByPath = pathStr && summary === pathStr;
      const matchedByRef = refList.includes(id);
      if (!matchedByPath && !matchedByRef) continue;

      byId.set(id, {
        id,
        layer: typeof item.layer === "string" ? item.layer : "source",
        source: typeof item.source === "string" ? item.source : "",
        summary: summary ?? id,
        observedAt: item.observedAt instanceof Date ? item.observedAt : new Date(),
        refs: Array.isArray(item.refs) ? (item.refs as string[]) : null,
        payload: item.payload as object | undefined,
      });
    }
    return [...byId.values()];
  }

  /**
   * Re-attach the retained excerpt to a matched evidence item.
   *
   * The archived manifest never stores source code (ADR-054 D7): it carries the
   * content hash and the truncated flag, and the excerpt is read from the
   * retention-bounded store. Once that row is physically deleted the item is
   * returned as-is, so an expired finding degrades to hash + truncated instead
   * of pretending the code is still available.
   */
  private async attachRetainedExcerpts(
    subjectId: string | null,
    items: SecurityEvaluationFindingDetailResponseDto["evidenceItems"],
  ): Promise<SecurityEvaluationFindingDetailResponseDto["evidenceItems"]> {
    if (!subjectId || items.length === 0) return items;
    const contentHashes = items
      .map((item) => (item.payload as { contentHash?: unknown } | undefined)?.contentHash)
      .filter((hash): hash is string => typeof hash === "string");
    if (contentHashes.length === 0) return items;

    const excerpts = await this.excerpts.load(subjectId, contentHashes);
    if (excerpts.size === 0) return items;

    return items.map((item) => {
      const payload = item.payload as { contentHash?: unknown } | undefined;
      const contentHash = payload?.contentHash;
      const excerpt = typeof contentHash === "string" ? excerpts.get(contentHash) : undefined;
      if (excerpt === undefined) return item;
      return { ...item, payload: { ...payload, excerpt } };
    });
  }

  // --- Report ------------------------------------------------------------

  @Get("report")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EvaluationFinding)
  @ApiOperation({ summary: "Single-axis security report (platform view)" })
  @ApiResponse({ status: 200, type: SecurityEvaluationReportResponseDto })
  async getReport(@Query() query: GetSecurityEvaluationReportRequestDto) {
    return this.reports.getReport(null, query.days);
  }
}
