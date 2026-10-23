import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import {
  CreatePeopleEvaluationPeriodRequestDto,
  CreatePeopleEvaluationPeriodResponseDto,
  CreatePeopleEvaluationPipPlanRequestDto,
  CreatePeopleEvaluationRubricVersionRequestDto,
  CreatePeopleEvaluationRubricVersionResponseDto,
  DeclarePeopleEvaluationHomeGroundRequestDto,
  ListPeopleEvaluationPeriodsRequestDto,
  ListPeopleEvaluationPeriodsResponseDto,
  PeopleEvaluationAgentSessionResponseDto,
  PeopleEvaluationAssessmentResponseDto,
  PeopleEvaluationDeclaredDocumentResponseDto,
  PeopleEvaluationHomeGroundResponseDto,
  PeopleEvaluationMemberWorkspaceResponseDto,
  PeopleEvaluationPipPlanResponseDto,
  ReviewPeopleEvaluationAssessmentRequestDto,
  UpdatePeopleEvaluationPeriodStatusRequestDto,
} from "./people-evaluation.dto";
import { PeopleEvaluationService } from "./people-evaluation.service";

/**
 * People-evaluation administration surface.
 *
 * All routes are system-level (the evaluation is cross-project and keyed by
 * user, not by project): the identity provider grants them to the supervisor
 * role via `*:Manage`. Evidence and assessments are intentionally NOT writable
 * over HTTP — the deterministic packet builder and the assessment runner write
 * through the service directly, so no caller can forge evidence or judgments
 * for another evaluatee.
 */
@ApiTags("People Evaluation")
@ApiBearerAuth()
@Controller("people")
export class PeopleEvaluationController {
  constructor(private readonly peopleEvaluation: PeopleEvaluationService) {}

  // --- Rubric versions ---------------------------------------------------

  @Get("rubrics/active")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationRubricVersion)
  @ApiOperation({ summary: "Find the currently active rubric version, or null" })
  @ApiResponse({ status: 200, type: CreatePeopleEvaluationRubricVersionResponseDto, nullable: true })
  findActiveRubric() {
    return this.peopleEvaluation.findActiveRubric();
  }

  @Post("rubrics")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.PeopleEvaluationRubricVersion)
  @ApiOperation({ summary: "Create and publish a new rubric version (ex ante anchor)" })
  @ApiResponse({ status: 201, type: CreatePeopleEvaluationRubricVersionResponseDto })
  createRubricVersion(@Body() body: CreatePeopleEvaluationRubricVersionRequestDto) {
    return this.peopleEvaluation.createRubricVersion(body);
  }

  // --- Evaluation periods ------------------------------------------------

  @Get("periods")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationPeriod)
  @ApiOperation({ summary: "List evaluation periods, optionally filtered by type" })
  @ApiResponse({ status: 200, type: ListPeopleEvaluationPeriodsResponseDto })
  listPeriods(@Query() query: ListPeopleEvaluationPeriodsRequestDto) {
    return this.peopleEvaluation.listPeriods(query);
  }

  @Get("periods/:id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.PeopleEvaluationPeriod)
  @ApiOperation({ summary: "Get one evaluation period by id" })
  @ApiResponse({ status: 200, type: CreatePeopleEvaluationPeriodResponseDto })
  getPeriodById(@Param("id") id: string) {
    return this.peopleEvaluation.getPeriodById(id);
  }

  @Post("periods")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.PeopleEvaluationPeriod)
  @ApiOperation({ summary: "Create a new evaluation period pinned to an existing rubric version" })
  @ApiResponse({ status: 201, type: CreatePeopleEvaluationPeriodResponseDto })
  createPeriod(@Body() body: CreatePeopleEvaluationPeriodRequestDto) {
    return this.peopleEvaluation.createPeriod(body);
  }

  @Patch("periods/:id/status")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.PeopleEvaluationPeriod)
  @ApiOperation({ summary: "Advance a period through UPCOMING → ACTIVE → CLOSED" })
  @ApiResponse({ status: 200, type: CreatePeopleEvaluationPeriodResponseDto })
  transitionPeriodStatus(@Param("id") id: string, @Body() body: UpdatePeopleEvaluationPeriodStatusRequestDto) {
    return this.peopleEvaluation.transitionPeriodStatus(id, body.status);
  }

  // --- Home ground -------------------------------------------------------

  @Post("home-ground")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.PeopleEvaluationHomeGround)
  @ApiOperation({ summary: "Declare (or re-declare) a member's specialty circle for a collection period" })
  @ApiResponse({ status: 201, type: PeopleEvaluationHomeGroundResponseDto })
  declareHomeGround(@Body() body: DeclarePeopleEvaluationHomeGroundRequestDto) {
    return this.peopleEvaluation.declareHomeGround(body);
  }

  // --- Collector-reported context ---------------------------------------

  @Get("workspaces")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationMemberWorkspace)
  @ApiOperation({ summary: "List the workspaces a member's collector has reported" })
  @ApiResponse({ type: PeopleEvaluationMemberWorkspaceResponseDto, isArray: true })
  @ApiQuery({ name: "evaluateeUserId", required: true, type: String })
  listWorkspaces(@Query("evaluateeUserId") evaluateeUserId: string) {
    return this.peopleEvaluation.listWorkspaces(evaluateeUserId);
  }

  @Get("sessions")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationAgentSession)
  @ApiOperation({ summary: "List collected agent-session index rows for a member" })
  @ApiResponse({ type: PeopleEvaluationAgentSessionResponseDto, isArray: true })
  @ApiQuery({ name: "evaluateeUserId", required: true, type: String })
  @ApiQuery({ name: "collectionPeriodId", required: false, type: String })
  listSessions(
    @Query("evaluateeUserId") evaluateeUserId: string,
    @Query("collectionPeriodId") collectionPeriodId?: string,
  ) {
    return this.peopleEvaluation.listSessions(evaluateeUserId, collectionPeriodId);
  }

  // --- Declared documents ------------------------------------------------

  @Get("documents")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationDeclaredDocument)
  @ApiOperation({ summary: "List declared work artifacts for a member" })
  @ApiResponse({ type: PeopleEvaluationDeclaredDocumentResponseDto, isArray: true })
  @ApiQuery({ name: "evaluateeUserId", required: true, type: String })
  listDocuments(@Query("evaluateeUserId") evaluateeUserId: string) {
    return this.peopleEvaluation.listDocuments(evaluateeUserId);
  }

  @Get("documents/:id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.PeopleEvaluationDeclaredDocument)
  @ApiOperation({ summary: "Get one declared work artifact, including its content" })
  @ApiResponse({ status: 200, type: PeopleEvaluationDeclaredDocumentResponseDto })
  getDocument(@Param("id") id: string) {
    return this.peopleEvaluation.getDocument(id);
  }

  // --- Assessments -------------------------------------------------------

  @Get("assessments")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationAssessment)
  @ApiOperation({ summary: "List assessments for a member (newest first)" })
  @ApiResponse({ type: PeopleEvaluationAssessmentResponseDto, isArray: true })
  @ApiQuery({ name: "evaluateeUserId", required: true, type: String })
  @ApiQuery({ name: "collectionPeriodId", required: false, type: String })
  listAssessments(
    @Query("evaluateeUserId") evaluateeUserId: string,
    @Query("collectionPeriodId") collectionPeriodId?: string,
  ) {
    return this.peopleEvaluation.listAssessments(evaluateeUserId, collectionPeriodId);
  }

  @Get("assessments/:id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.PeopleEvaluationAssessment)
  @ApiOperation({ summary: "Get one assessment, including its coverage declaration" })
  @ApiResponse({ status: 200, type: PeopleEvaluationAssessmentResponseDto })
  getAssessment(@Param("id") id: string) {
    return this.peopleEvaluation.getAssessment(id);
  }

  @Patch("assessments/:id/review")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.PeopleEvaluationAssessment)
  @ApiOperation({ summary: "Record the supervisor's final call on an assessment" })
  @ApiResponse({ status: 200, type: PeopleEvaluationAssessmentResponseDto })
  reviewAssessment(@Param("id") id: string, @Body() body: ReviewPeopleEvaluationAssessmentRequestDto) {
    return this.peopleEvaluation.reviewAssessment(id, body);
  }

  // --- PIP plans ---------------------------------------------------------

  @Get("pip-plans")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationPipPlan)
  @ApiOperation({ summary: "List PIP plans for a member" })
  @ApiResponse({ type: PeopleEvaluationPipPlanResponseDto, isArray: true })
  @ApiQuery({ name: "evaluateeUserId", required: true, type: String })
  listPipPlans(@Query("evaluateeUserId") evaluateeUserId: string) {
    return this.peopleEvaluation.listPipPlans(evaluateeUserId);
  }

  @Post("pip-plans")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.PeopleEvaluationPipPlan)
  @ApiOperation({ summary: "Open a PIP plan from one or more assessments" })
  @ApiResponse({ status: 201, type: PeopleEvaluationPipPlanResponseDto })
  createPipPlan(@Body() body: CreatePeopleEvaluationPipPlanRequestDto) {
    return this.peopleEvaluation.createPipPlan(body);
  }
}
