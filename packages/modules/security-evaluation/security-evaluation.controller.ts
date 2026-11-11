import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
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
  SECURITY_EVALUATION_FINDING_STALE_AFTER_DAYS,
  SECURITY_EVALUATION_SUBJECT_KINDS,
} from "./security-evaluation.constants";
import {
  GetSecurityEvaluationAssetRequestDto,
  GetSecurityEvaluationFindingRequestDto,
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
  SecurityEvaluationFindingDetailResponseDto,
  SecurityEvaluationFindingResponseDto,
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
    private readonly results: EvaluationResultService,
    private readonly criteria: EvaluationCriteriaService,
    private readonly reports: SecurityEvaluationReportService,
    private readonly excerpts: SecurityEvaluationCodeScanExcerptService,
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
      "List findings (platform view), optionally filtered by provenance source, subject, run, evaluationKey, status, severity, urgency, staleness",
  })
  @ApiResponse({ status: 200, type: ListSecurityEvaluationFindingsResponseDto })
  async listFindings(@Query() query: ListSecurityEvaluationFindingsRequestDto) {
    const subjectIds = query.subjectId ? null : await this.assets.listSubjectIdsBySource(query);
    // Stale = OPEN but not re-observed within the window: the run that used to
    // reproduce the finding stopped covering it without resolving it. An
    // explicit status filter always wins over the implied OPEN.
    const staleBefore = query.staleOnly
      ? new Date(Date.now() - SECURITY_EVALUATION_FINDING_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000)
      : undefined;
    return this.findings.listFindings({
      subjectIds: subjectIds ?? undefined,
      subjectId: query.subjectId,
      runId: query.runId,
      evaluationKey: query.evaluationKey,
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
    let evaluationKey: string | null = null;
    let subjectId: string | null = null;
    try {
      const runResult = await this.results.getResultForRun(finding.lastSeenRunId);
      subjectId = runResult.subjectId;
      const manifestResult = await this.results.getResultManifest(runResult.id);
      manifest = manifestResult.manifest as unknown[];
      const version = await this.criteria.getVersion(runResult.ruleSetVersionId);
      ruleSetVersion = version.version ?? null;
      evaluationKey = version.evaluationKey ?? null;
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
      evaluationKey,
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
  @ApiOperation({ summary: "Single-axis security report (platform view, optionally filtered by provenance source)" })
  @ApiResponse({ status: 200, type: SecurityEvaluationReportResponseDto })
  async getReport(@Query() query: GetSecurityEvaluationReportRequestDto) {
    const subjectIds = await this.assets.listSubjectIdsBySource(query);
    return this.reports.getReport(subjectIds, query.days);
  }
}
