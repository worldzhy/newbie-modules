import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { EvaluationCriteriaService } from "@modules/evaluation/evaluation-criteria.service";

import { WorkEvaluationPeriodService } from "./work-evaluation-period.service";
import { WorkEvaluationRunService } from "./work-evaluation-run.service";
import { WORK_EVALUATION_SUBJECT_KIND } from "./work-evaluation.constants";
import {
  CreateWorkEvaluationRuleSetVersionRequestDto,
  CreateWorkEvaluationCriterionRequestDto,
  CreateWorkEvaluationPeriodRequestDto,
  GetWorkEvaluationByIdRequestDto,
  GetWorkEvaluationHomeGroundRequestDto,
  ListWorkEvaluationRuleSetVersionsRequestDto,
  ListWorkEvaluationRuleSetVersionsResponseDto,
  ListWorkEvaluationPeriodsRequestDto,
  ListWorkEvaluationPeriodsResponseDto,
  ListWorkEvaluationResultsRequestDto,
  ListWorkEvaluationResultsResponseDto,
  ListWorkEvaluationRunsRequestDto,
  ListWorkEvaluationRunsResponseDto,
  ListWorkEvaluationSubjectsRequestDto,
  ListWorkEvaluationSubjectsResponseDto,
  StartWorkEvaluationRunRequestDto,
  UpdateWorkEvaluationHomeGroundRequestDto,
  UpdateWorkEvaluationPeriodStatusRequestDto,
  WorkEvaluationCriterionResponseDto,
  WorkEvaluationRuleSetVersionResponseDto,
  WorkEvaluationHomeGroundResponseDto,
  WorkEvaluationPeriodResponseDto,
  WorkEvaluationResultResponseDto,
  WorkEvaluationRunAcceptedResponseDto,
  WorkEvaluationRunResponseDto,
} from "./work-evaluation.dto";

/**
 * Work-evaluation administration surface.
 *
 * Criteria versions, periods, home-ground declarations, subject listing, run
 * triggering and result reads. Evidence ingest is handled by
 * WorkEvaluationEvidenceController.
 *
 * The skeleton owns the run lifecycle, result immutability and subject
 * registry — this controller only bridges the feature's DTO surface.
 */
@ApiTags("Work Evaluation")
@ApiBearerAuth()
@Controller("work-evaluation")
export class WorkEvaluationController {
  constructor(
    private readonly periods: WorkEvaluationPeriodService,
    private readonly runs: WorkEvaluationRunService,
    private readonly criteria: EvaluationCriteriaService,
  ) {}

  // --- Criteria versions -------------------------------------------------

  @Get("rule-set-versions")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EvaluationRuleSetVersion)
  @ApiOperation({ summary: 'List criteria versions for kind "work"' })
  @ApiResponse({ status: 200, type: ListWorkEvaluationRuleSetVersionsResponseDto })
  async listRuleSetVersions(@Query() query: ListWorkEvaluationRuleSetVersionsRequestDto) {
    return this.criteria.listVersions({ kind: WORK_EVALUATION_SUBJECT_KIND, ...query });
  }

  @Post("rule-set-versions")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.EvaluationRuleSetVersion)
  @ApiOperation({ summary: 'Create a new criteria version (draft) for kind "work"' })
  @ApiResponse({ status: 201, type: WorkEvaluationRuleSetVersionResponseDto })
  async createRuleSetVersion(@Body() body: CreateWorkEvaluationRuleSetVersionRequestDto) {
    return this.criteria.createVersion({
      kind: WORK_EVALUATION_SUBJECT_KIND,
      evaluationKey: body.evaluationKey,
      version: body.version,
      description: body.description,
      metadata: body.metadata as Record<string, unknown> | undefined,
    });
  }

  @Get("rule-set-versions/:id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.EvaluationRuleSetVersion)
  @ApiOperation({ summary: "Get one criteria version (kind guard enforced)" })
  @ApiResponse({ status: 200, type: WorkEvaluationRuleSetVersionResponseDto })
  async getRuleSetVersion(@Param() params: GetWorkEvaluationByIdRequestDto) {
    const version = await this.criteria.getVersion(params.id);
    if (version.kind !== WORK_EVALUATION_SUBJECT_KIND) {
      throw new NotFoundException(`Criteria version ${params.id} is not of kind "${WORK_EVALUATION_SUBJECT_KIND}"`);
    }
    return version;
  }

  @Post("rule-set-versions/:id/publish")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.EvaluationRuleSetVersion)
  @ApiOperation({ summary: "Publish a criteria version (one-way, requires at least one criterion)" })
  @ApiResponse({ status: 200, type: WorkEvaluationRuleSetVersionResponseDto })
  async publishRuleSetVersion(@Param() params: GetWorkEvaluationByIdRequestDto) {
    const version = await this.criteria.getVersion(params.id);
    if (version.kind !== WORK_EVALUATION_SUBJECT_KIND) {
      throw new NotFoundException(`Criteria version ${params.id} is not of kind "${WORK_EVALUATION_SUBJECT_KIND}"`);
    }
    return this.criteria.publishVersion(params.id);
  }

  @Get("rule-set-versions/:id/criteria")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EvaluationCriterion)
  @ApiOperation({ summary: "List criteria of one version" })
  @ApiResponse({ type: WorkEvaluationCriterionResponseDto, isArray: true })
  async listCriteria(@Param() params: GetWorkEvaluationByIdRequestDto) {
    const version = await this.criteria.getVersion(params.id);
    if (version.kind !== WORK_EVALUATION_SUBJECT_KIND) {
      throw new NotFoundException(`Criteria version ${params.id} is not of kind "${WORK_EVALUATION_SUBJECT_KIND}"`);
    }
    return this.criteria.listCriteria(params.id);
  }

  @Post("rule-set-versions/:id/criteria")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.EvaluationCriterion)
  @ApiOperation({ summary: "Add a criterion to a draft version" })
  @ApiResponse({ status: 201, type: WorkEvaluationCriterionResponseDto })
  async addCriterion(
    @Param() params: GetWorkEvaluationByIdRequestDto,
    @Body() body: CreateWorkEvaluationCriterionRequestDto,
  ) {
    const version = await this.criteria.getVersion(params.id);
    if (version.kind !== WORK_EVALUATION_SUBJECT_KIND) {
      throw new NotFoundException(`Criteria version ${params.id} is not of kind "${WORK_EVALUATION_SUBJECT_KIND}"`);
    }
    return this.criteria.addCriterion(params.id, {
      criterionKey: body.criterionKey,
      kind: body.kind,
      name: body.name,
      description: body.description,
      metadata: body.metadata as Record<string, unknown> | undefined,
    });
  }

  // --- Evaluation periods ------------------------------------------------

  @Get("periods")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.WorkEvaluationPeriod)
  @ApiOperation({ summary: "List evaluation periods, optionally filtered by type" })
  @ApiResponse({ status: 200, type: ListWorkEvaluationPeriodsResponseDto })
  listPeriods(@Query() query: ListWorkEvaluationPeriodsRequestDto) {
    return this.periods.listPeriods(query);
  }

  @Get("periods/:id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.WorkEvaluationPeriod)
  @ApiOperation({ summary: "Get one evaluation period by id" })
  @ApiResponse({ status: 200, type: WorkEvaluationPeriodResponseDto })
  getPeriodById(@Param() params: GetWorkEvaluationByIdRequestDto) {
    return this.periods.getPeriodById(params.id);
  }

  @Post("periods")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.WorkEvaluationPeriod)
  @ApiOperation({ summary: "Create a new evaluation period pinned to a published criteria version" })
  @ApiResponse({ status: 201, type: WorkEvaluationPeriodResponseDto })
  createPeriod(@Body() body: CreateWorkEvaluationPeriodRequestDto) {
    return this.periods.createPeriod(body);
  }

  @Patch("periods/:id/status")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.WorkEvaluationPeriod)
  @ApiOperation({ summary: "Advance a period through UPCOMING → ACTIVE → CLOSED" })
  @ApiResponse({ status: 200, type: WorkEvaluationPeriodResponseDto })
  transitionPeriodStatus(
    @Param() params: GetWorkEvaluationByIdRequestDto,
    @Body() body: UpdateWorkEvaluationPeriodStatusRequestDto,
  ) {
    return this.periods.transitionPeriodStatus(params.id, body.status);
  }

  // --- Home ground -------------------------------------------------------

  @Put("home-ground")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.WorkEvaluationHomeGround)
  @ApiOperation({ summary: "Declare (or re-declare) a member's specialty circle for a collection period" })
  @ApiResponse({ status: 200, type: WorkEvaluationHomeGroundResponseDto })
  declareHomeGround(@Body() body: UpdateWorkEvaluationHomeGroundRequestDto) {
    return this.periods.declareHomeGround(body);
  }

  @Get("home-ground")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.WorkEvaluationHomeGround)
  @ApiOperation({ summary: "Get one member's home-ground declaration for a collection period" })
  @ApiResponse({ status: 200, type: WorkEvaluationHomeGroundResponseDto })
  getHomeGround(@Query() query: GetWorkEvaluationHomeGroundRequestDto) {
    return this.periods.getHomeGround(query.evaluateeUserId, query.collectionPeriodId);
  }

  // --- Subjects ----------------------------------------------------------

  @Get("subjects")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EvaluationSubject)
  @ApiOperation({ summary: 'List evaluation subjects of kind "work" under a scope' })
  @ApiResponse({ status: 200, type: ListWorkEvaluationSubjectsResponseDto })
  listSubjects(@Query() query: ListWorkEvaluationSubjectsRequestDto) {
    return this.runs.listSubjects(query);
  }

  // --- Evaluation runs ---------------------------------------------------

  @Post("runs")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.EvaluationRun)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: "Dispatch a run (fire-and-forget). The caller polls `GET /work-evaluation/runs` for its row.",
  })
  @ApiResponse({ status: 202, type: WorkEvaluationRunAcceptedResponseDto })
  async startRun(
    @Body() body: StartWorkEvaluationRunRequestDto,
    @Req() request: UserRequest,
  ): Promise<WorkEvaluationRunAcceptedResponseDto> {
    const runId = await this.runs.startRun({
      ...body,
      requestedByRef: request.user.userId,
    });
    return { accepted: true, runId };
  }

  @Get("runs")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EvaluationRun)
  @ApiOperation({ summary: "List runs for a subject (newest first)" })
  @ApiResponse({ status: 200, type: ListWorkEvaluationRunsResponseDto })
  listRuns(@Query() query: ListWorkEvaluationRunsRequestDto) {
    return this.runs.listRuns(query);
  }

  @Get("runs/:id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.EvaluationRun)
  @ApiOperation({ summary: "Get one run by id" })
  @ApiResponse({ status: 200, type: WorkEvaluationRunResponseDto })
  getRun(@Param() params: GetWorkEvaluationByIdRequestDto) {
    return this.runs.getRun(params.id);
  }

  @Get("runs/:id/result")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.EvaluationResult)
  @ApiOperation({ summary: "Get the result for a specific run" })
  @ApiResponse({ status: 200, type: WorkEvaluationResultResponseDto })
  getResultForRun(@Param() params: GetWorkEvaluationByIdRequestDto) {
    return this.runs.getResultForRun(params.id);
  }

  // --- Evaluation results ------------------------------------------------

  @Get("results")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EvaluationResult)
  @ApiOperation({ summary: "List archived results for a subject (newest first)" })
  @ApiResponse({ status: 200, type: ListWorkEvaluationResultsResponseDto })
  listResults(@Query() query: ListWorkEvaluationResultsRequestDto) {
    return this.runs.listResults(query);
  }

  @Get("results/:id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.EvaluationResult)
  @ApiOperation({ summary: "Get one archived result by id" })
  @ApiResponse({ status: 200, type: WorkEvaluationResultResponseDto })
  getResult(@Param() params: GetWorkEvaluationByIdRequestDto) {
    return this.runs.getResult(params.id);
  }
}
