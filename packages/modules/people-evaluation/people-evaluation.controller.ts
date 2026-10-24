import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import {
  CreatePeopleEvaluationPeriodRequestDto,
  CreatePeopleEvaluationPipPlanRequestDto,
  CreatePeopleEvaluationRubricVersionRequestDto,
  GetPeopleEvaluationHomeGroundRequestDto,
  ListPeopleEvaluationPeriodsRequestDto,
  ListPeopleEvaluationPeriodsResponseDto,
  ListPeopleEvaluationPipPlansRequestDto,
  ListPeopleEvaluationResultsRequestDto,
  PeopleEvaluationHomeGroundResponseDto,
  PeopleEvaluationPeriodResponseDto,
  PeopleEvaluationPipPlanResponseDto,
  PeopleEvaluationResultManifestResponseDto,
  PeopleEvaluationResultResponseDto,
  PeopleEvaluationRubricVersionResponseDto,
  UpdatePeopleEvaluationHomeGroundRequestDto,
  UpdatePeopleEvaluationPeriodStatusRequestDto,
  UpdatePeopleEvaluationPipPlanDecisionRequestDto,
  UpdatePeopleEvaluationResultReviewRequestDto,
} from "./people-evaluation.dto";
import { PeopleEvaluationResultService } from "./people-evaluation-result.service";
import { PeopleEvaluationRubricService } from "./people-evaluation-rubric.service";

/**
 * People-evaluation administration surface.
 *
 * All routes are system-level (the evaluation is cross-project and keyed by
 * user, not by project): the identity provider grants them to the supervisor
 * role via `*:Manage`. Evidence and evaluation results are intentionally NOT
 * writable over HTTP — the deterministic evidence builder and the evaluation
 * runner write through the services directly, so no caller can forge evidence or
 * judgments for another evaluatee. Human decisions (review, PIP decision) are
 * recorded under the authenticated actor, never under a body-supplied userId.
 *
 * The evidence ingest/read surface lives on `/people/evidence` (see
 * PeopleEvaluationEvidenceController).
 */
@ApiTags("People Evaluation")
@ApiBearerAuth()
@Controller("people")
export class PeopleEvaluationController {
  constructor(
    private readonly rubric: PeopleEvaluationRubricService,
    private readonly results: PeopleEvaluationResultService,
  ) {}

  // --- Rubric versions ---------------------------------------------------

  @Get("rubrics/active")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationRubricVersion)
  @ApiOperation({ summary: "Find the currently active rubric version, or null" })
  @ApiResponse({ status: 200, type: PeopleEvaluationRubricVersionResponseDto, nullable: true })
  findActiveRubric() {
    return this.rubric.findActiveRubric();
  }

  @Post("rubrics")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.PeopleEvaluationRubricVersion)
  @ApiOperation({ summary: "Create and publish a new rubric version (ex ante anchor)" })
  @ApiResponse({ status: 201, type: PeopleEvaluationRubricVersionResponseDto })
  createRubricVersion(@Body() body: CreatePeopleEvaluationRubricVersionRequestDto) {
    return this.rubric.createRubricVersion(body);
  }

  // --- Evaluation periods ------------------------------------------------

  @Get("periods")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationPeriod)
  @ApiOperation({ summary: "List evaluation periods, optionally filtered by type" })
  @ApiResponse({ status: 200, type: ListPeopleEvaluationPeriodsResponseDto })
  listPeriods(@Query() query: ListPeopleEvaluationPeriodsRequestDto) {
    return this.rubric.listPeriods(query);
  }

  @Get("periods/:id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.PeopleEvaluationPeriod)
  @ApiOperation({ summary: "Get one evaluation period by id" })
  @ApiResponse({ status: 200, type: PeopleEvaluationPeriodResponseDto })
  getPeriodById(@Param("id") id: string) {
    return this.rubric.getPeriodById(id);
  }

  @Post("periods")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.PeopleEvaluationPeriod)
  @ApiOperation({ summary: "Create a new evaluation period pinned to an existing rubric version" })
  @ApiResponse({ status: 201, type: PeopleEvaluationPeriodResponseDto })
  createPeriod(@Body() body: CreatePeopleEvaluationPeriodRequestDto) {
    return this.rubric.createPeriod(body);
  }

  @Patch("periods/:id/status")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.PeopleEvaluationPeriod)
  @ApiOperation({ summary: "Advance a period through UPCOMING → ACTIVE → CLOSED" })
  @ApiResponse({ status: 200, type: PeopleEvaluationPeriodResponseDto })
  transitionPeriodStatus(@Param("id") id: string, @Body() body: UpdatePeopleEvaluationPeriodStatusRequestDto) {
    return this.rubric.transitionPeriodStatus(id, body.status);
  }

  // --- Home ground -------------------------------------------------------

  @Put("home-ground")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.PeopleEvaluationHomeGround)
  @ApiOperation({ summary: "Declare (or re-declare) a member's specialty circle for a collection period" })
  @ApiResponse({ status: 200, type: PeopleEvaluationHomeGroundResponseDto })
  declareHomeGround(@Body() body: UpdatePeopleEvaluationHomeGroundRequestDto) {
    return this.rubric.declareHomeGround(body);
  }

  @Get("home-ground")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.PeopleEvaluationHomeGround)
  @ApiOperation({ summary: "Get one member's home-ground declaration for a collection period" })
  @ApiResponse({ status: 200, type: PeopleEvaluationHomeGroundResponseDto })
  getHomeGround(@Query() query: GetPeopleEvaluationHomeGroundRequestDto) {
    return this.rubric.getHomeGround(query.evaluateeUserId, query.collectionPeriodId);
  }

  // --- Evaluation results ------------------------------------------------

  @Get("evaluation-results")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationResult)
  @ApiOperation({ summary: "List evaluation results for a member (newest first)" })
  @ApiResponse({ type: PeopleEvaluationResultResponseDto, isArray: true })
  listResults(@Query() query: ListPeopleEvaluationResultsRequestDto) {
    return this.results.listResults(query);
  }

  @Get("evaluation-results/:id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.PeopleEvaluationResult)
  @ApiOperation({ summary: "Get one evaluation result, including its coverage declaration" })
  @ApiResponse({ status: 200, type: PeopleEvaluationResultResponseDto })
  getResult(@Param("id") id: string) {
    return this.results.getResult(id);
  }

  @Get("evaluation-results/:id/manifest")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.PeopleEvaluationResult)
  @ApiOperation({ summary: "Get the archived material snapshot an evaluation result was judged from" })
  @ApiResponse({ status: 200, type: PeopleEvaluationResultManifestResponseDto })
  getResultManifest(@Param("id") id: string) {
    return this.results.getResultManifest(id);
  }

  @Patch("evaluation-results/:id/review")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.PeopleEvaluationResult)
  @ApiOperation({ summary: "Record the supervisor's final call on an evaluation result" })
  @ApiResponse({ status: 200, type: PeopleEvaluationResultResponseDto })
  updateResultReview(
    @Param("id") id: string,
    @Req() request: UserRequest,
    @Body() body: UpdatePeopleEvaluationResultReviewRequestDto,
  ) {
    return this.results.updateResultReview(id, request.user.userId, body);
  }

  // --- PIP plans ---------------------------------------------------------

  @Get("pip-plans")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationPipPlan)
  @ApiOperation({ summary: "List PIP plans for a member" })
  @ApiResponse({ type: PeopleEvaluationPipPlanResponseDto, isArray: true })
  listPipPlans(@Query() query: ListPeopleEvaluationPipPlansRequestDto) {
    return this.results.listPipPlans(query);
  }

  @Post("pip-plans")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.PeopleEvaluationPipPlan)
  @ApiOperation({ summary: "Open a PIP plan from one or more evaluation results" })
  @ApiResponse({ status: 201, type: PeopleEvaluationPipPlanResponseDto })
  createPipPlan(@Body() body: CreatePeopleEvaluationPipPlanRequestDto) {
    return this.results.createPipPlan(body);
  }

  @Post("pip-plans/:id/decisions")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.PeopleEvaluationPipPlan)
  @ApiOperation({ summary: "Record the supervisor's decision on a PIP plan" })
  @ApiResponse({ status: 201, type: PeopleEvaluationPipPlanResponseDto })
  decidePipPlan(
    @Param("id") id: string,
    @Req() request: UserRequest,
    @Body() body: UpdatePeopleEvaluationPipPlanDecisionRequestDto,
  ) {
    return this.results.decidePipPlan(id, request.user.userId, body);
  }
}
