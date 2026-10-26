import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { EvaluationFindingService } from "./evaluation-finding.service";
import { EvaluationRemediationService } from "./evaluation-remediation.service";
import { EvaluationResultService } from "./evaluation-result.service";
import {
  CreateEvaluationRemediationPlanRequestDto,
  DecideEvaluationRemediationPlanRequestDto,
  EvaluationFindingResponseDto,
  EvaluationRemediationPlanResponseDto,
  EvaluationResultResponseDto,
  GetEvaluationFindingByIdRequestDto,
  GetEvaluationRemediationPlanByIdRequestDto,
  GetEvaluationResultByIdRequestDto,
  ListEvaluationRemediationPlansRequestDto,
  ListEvaluationRemediationPlansResponseDto,
  ReviewEvaluationResultRequestDto,
  SuppressEvaluationFindingRequestDto,
  UpdateEvaluationRemediationCheckpointRequestDto,
} from "./evaluation-decision.dto";

/**
 * Human decision surface over skeleton-owned evaluation aggregates.
 *
 * Findings, results and remediation plans are skeleton domain objects shared
 * by every feature evaluationKey, so their lifecycle operations (suppression,
 * reopening, result review, remediation planning and checkpoint tracking) live
 * here rather than in any feature vocabulary (ADR-029, ADR-031). Attribution
 * follows the service contracts: the acting user is recorded automatically,
 * while the accountable decision maker is always an explicit request field.
 */
@ApiTags("Evaluation")
@ApiBearerAuth()
@Controller("evaluation")
export class EvaluationDecisionController {
  constructor(
    private readonly findings: EvaluationFindingService,
    private readonly results: EvaluationResultService,
    private readonly remediation: EvaluationRemediationService,
  ) {}

  @Post("findings/:id/suppress")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.EvaluationFinding)
  @ApiOperation({ summary: "Silence a finding with a mandatory human note (CAS on status)" })
  @ApiOkResponse({ type: EvaluationFindingResponseDto })
  async suppressFinding(
    @Param() params: GetEvaluationFindingByIdRequestDto,
    @Body() body: SuppressEvaluationFindingRequestDto,
    @Req() request: UserRequest,
  ) {
    return this.findings.suppressFinding(params.id, body.note, request.user.userId);
  }

  @Post("findings/:id/reopen")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.EvaluationFinding)
  @ApiOperation({ summary: "Reopen a suppressed finding and clear its suppression note" })
  @ApiOkResponse({ type: EvaluationFindingResponseDto })
  async reopenFinding(@Param() params: GetEvaluationFindingByIdRequestDto) {
    return this.findings.reopenFinding(params.id);
  }

  @Post("results/:id/review")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.EvaluationResult)
  @ApiOperation({
    summary: "Record the supervisor verdict on a result (APPROVED endorses, REJECTED overrules); re-review overwrites",
  })
  @ApiOkResponse({ type: EvaluationResultResponseDto })
  async reviewResult(
    @Param() params: GetEvaluationResultByIdRequestDto,
    @Body() body: ReviewEvaluationResultRequestDto,
    @Req() request: UserRequest,
  ) {
    return this.results.reviewResult({
      id: params.id,
      reviewStatus: body.reviewStatus,
      reviewedByRef: request.user.userId,
      note: body.note,
    });
  }

  @Post("remediation-plans")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.EvaluationRemediationPlan)
  @ApiOperation({ summary: "Create an OPEN remediation plan for a subject" })
  @ApiCreatedResponse({ type: EvaluationRemediationPlanResponseDto })
  async createPlan(@Body() body: CreateEvaluationRemediationPlanRequestDto) {
    return this.remediation.createPlan({
      subjectId: body.subjectId,
      triggerRefs: body.triggerRefs,
      deciderRef: body.deciderRef,
      startDate: body.startDate,
      dueDate: body.dueDate,
      checkpoints: body.checkpoints,
    });
  }

  @Get("remediation-plans")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EvaluationRemediationPlan)
  @ApiOperation({ summary: "List remediation plans of one subject (newest first)" })
  @ApiOkResponse({ type: ListEvaluationRemediationPlansResponseDto })
  async listPlans(@Query() query: ListEvaluationRemediationPlansRequestDto) {
    return this.remediation.listPlans({
      subjectId: query.subjectId,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get("remediation-plans/:id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.EvaluationRemediationPlan)
  @ApiOperation({ summary: "Fetch one remediation plan with its checkpoints" })
  @ApiOkResponse({ type: EvaluationRemediationPlanResponseDto })
  async getPlan(@Param() params: GetEvaluationRemediationPlanByIdRequestDto) {
    return this.remediation.getPlan(params.id);
  }

  @Post("remediation-plans/:id/decision")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.EvaluationRemediationPlan)
  @ApiOperation({ summary: "Complete or cancel an OPEN plan; records the deciding actor" })
  @ApiOkResponse({ type: EvaluationRemediationPlanResponseDto })
  async decidePlan(
    @Param() params: GetEvaluationRemediationPlanByIdRequestDto,
    @Body() body: DecideEvaluationRemediationPlanRequestDto,
    @Req() request: UserRequest,
  ) {
    return this.remediation.decidePlan(params.id, {
      status: body.status,
      decisionNote: body.decisionNote,
      decidedByRef: request.user.userId,
    });
  }

  @Patch("remediation-plans/:id/checkpoints/:index")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.EvaluationRemediationPlan)
  @ApiOperation({ summary: "Update one checkpoint of an OPEN plan" })
  @ApiOkResponse({ type: EvaluationRemediationPlanResponseDto })
  async updateCheckpoint(
    @Param() params: GetEvaluationRemediationPlanByIdRequestDto,
    @Param("index", ParseIntPipe) index: number,
    @Body() body: UpdateEvaluationRemediationCheckpointRequestDto,
  ) {
    return this.remediation.updateCheckpoint(params.id, index, { status: body.status });
  }
}
