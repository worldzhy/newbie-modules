import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";

import { PenetrationTestingAuthorizationService } from "./authorization/penetration-testing-authorization.service";
import { PenetrationTestingTestObjectService } from "./authorization/penetration-testing-test-object.service";
import { PenetrationTestingTargetService } from "./assets/penetration-testing-target.service";
import {
  CreatePenetrationTestingTargetRequestDto,
  CreatePenetrationTestingTestObjectRequestDto,
  ListPenetrationTestingAuthorizationsRequestDto,
  ListPenetrationTestingFindingsRequestDto,
  ListPenetrationTestingFindingsResponseDto,
  ListPenetrationTestingResultsRequestDto,
  ListPenetrationTestingResultsResponseDto,
  ListPenetrationTestingRunsRequestDto,
  ListPenetrationTestingRunsResponseDto,
  ListPenetrationTestingTargetsRequestDto,
  ListPenetrationTestingTestObjectsRequestDto,
  PenetrationTestingAuthorizationListResponseDto,
  PenetrationTestingAuthorizationParamsDto,
  PenetrationTestingAuthorizationResponseDto,
  PenetrationTestingPlaybookListResponseDto,
  PenetrationTestingRunAcceptedResponseDto,
  PenetrationTestingRunParamsDto,
  PenetrationTestingRunResponseDto,
  PenetrationTestingTargetListResponseDto,
  PenetrationTestingTargetMaterialResponseDto,
  PenetrationTestingTargetParamsDto,
  PenetrationTestingTargetRegistrationResponseDto,
  PenetrationTestingTestObjectListResponseDto,
  PenetrationTestingTestObjectParamsDto,
  PenetrationTestingTestObjectResponseDto,
  PenetrationTestingVerificationChallengeResponseDto,
  PenetrationTestingVerificationCheckResponseDto,
  RequestPenetrationTestingAuthorizationRequestDto,
  RevokePenetrationTestingAuthorizationRequestDto,
  StartPenetrationTestingRunRequestDto,
  UpdatePenetrationTestingTargetRequestDto,
} from "./penetration-testing.dto";
import { PENETRATION_TESTING_PLAYBOOKS } from "./penetration-testing.constants";
import { PenetrationTestingRunService } from "./runs/penetration-testing-run.service";

/**
 * Penetration-testing HTTP surface (ADR-075 §8, ADR-049 D8).
 *
 * The whole surface lives in the module, not the host: admission, approval and
 * the run gate must have exactly one implementation, and a host controller
 * would be a second place to bypass it. Operator identity always comes from the
 * authenticated session — `requestedBy` / `approvedBy` are never read from the
 * body.
 */
@ApiTags("Penetration Testing")
@ApiBearerAuth()
@Controller("penetration-testing")
export class PenetrationTestingController {
  constructor(
    private readonly targets: PenetrationTestingTargetService,
    private readonly authorizations: PenetrationTestingAuthorizationService,
    private readonly testObjects: PenetrationTestingTestObjectService,
    private readonly runs: PenetrationTestingRunService,
  ) {}

  // --- Targets -----------------------------------------------------------

  @Post("targets")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.PenetrationTestingTarget)
  @ApiOperation({ summary: "Register (or refresh) a web target and return its ownership token" })
  @ApiResponse({ status: 201, type: PenetrationTestingTargetRegistrationResponseDto })
  async createTarget(
    @Body() body: CreatePenetrationTestingTargetRequestDto,
  ): Promise<PenetrationTestingTargetRegistrationResponseDto> {
    return this.targets.create(body);
  }

  @Patch("targets/:subjectId")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.PenetrationTestingTarget)
  @ApiOperation({
    summary: "Patch declared target material; a changed environment, port set or path map resets verification",
  })
  @ApiOkResponse({ type: PenetrationTestingTargetMaterialResponseDto })
  async updateTarget(
    @Param() params: PenetrationTestingTargetParamsDto,
    @Body() body: UpdatePenetrationTestingTargetRequestDto,
  ): Promise<PenetrationTestingTargetMaterialResponseDto> {
    return this.targets.update(params.subjectId, body);
  }

  @Get("targets")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PenetrationTestingTarget)
  @ApiOperation({ summary: "List registered targets with verification state; the token is never returned" })
  @ApiOkResponse({ type: PenetrationTestingTargetListResponseDto })
  async listTargets(
    @Query() query: ListPenetrationTestingTargetsRequestDto,
  ): Promise<PenetrationTestingTargetListResponseDto> {
    return { targets: await this.targets.list(query) };
  }

  @Get("targets/:subjectId")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.PenetrationTestingTarget)
  @ApiOperation({ summary: "Read one target's declared material and verification state" })
  @ApiOkResponse({ type: PenetrationTestingTargetMaterialResponseDto })
  async getTarget(
    @Param() params: PenetrationTestingTargetParamsDto,
  ): Promise<PenetrationTestingTargetMaterialResponseDto> {
    return this.targets.material(params.subjectId);
  }

  @Post("targets/:subjectId/verification")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.PenetrationTestingTarget)
  @ApiOperation({ summary: "Return the ownership token and both publish placements" })
  @ApiOkResponse({ type: PenetrationTestingVerificationChallengeResponseDto })
  async getVerificationChallenge(
    @Param() params: PenetrationTestingTargetParamsDto,
  ): Promise<PenetrationTestingVerificationChallengeResponseDto> {
    return this.targets.verificationChallenge(params.subjectId);
  }

  @Post("targets/:subjectId/verification/check")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.PenetrationTestingTarget)
  @ApiOperation({ summary: "Probe the published token (DNS TXT first, then well-known) and persist the outcome" })
  @ApiOkResponse({ type: PenetrationTestingVerificationCheckResponseDto })
  async checkVerification(
    @Param() params: PenetrationTestingTargetParamsDto,
  ): Promise<PenetrationTestingVerificationCheckResponseDto> {
    return this.targets.checkVerification(params.subjectId);
  }

  // --- Authorizations ----------------------------------------------------

  @Post("authorizations")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.PenetrationTestingAuthorization)
  @ApiOperation({ summary: "Request a written authorization; the requester is the authenticated user" })
  @ApiResponse({ status: 201, type: PenetrationTestingAuthorizationResponseDto })
  async requestAuthorization(
    @Body() body: RequestPenetrationTestingAuthorizationRequestDto,
    @Req() request: UserRequest,
  ): Promise<PenetrationTestingAuthorizationResponseDto> {
    return this.authorizations.request({
      ...body,
      requestedBy: { id: request.user.userId, via: "session" },
    });
  }

  @Post("authorizations/:id/approve")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.PenetrationTestingAuthorization)
  @ApiOperation({ summary: "Approve a pending authorization; the approver must differ from the requester" })
  @ApiOkResponse({ type: PenetrationTestingAuthorizationResponseDto })
  async approveAuthorization(
    @Param() params: PenetrationTestingAuthorizationParamsDto,
    @Req() request: UserRequest,
  ): Promise<PenetrationTestingAuthorizationResponseDto> {
    return this.authorizations.approve(params.id, { id: request.user.userId, via: "session" });
  }

  @Post("authorizations/:id/revoke")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.PenetrationTestingAuthorization)
  @ApiOperation({ summary: "Revoke an authorization; later runs are refused at the gate" })
  @ApiOkResponse({ type: PenetrationTestingAuthorizationResponseDto })
  async revokeAuthorization(
    @Param() params: PenetrationTestingAuthorizationParamsDto,
    @Body() body: RevokePenetrationTestingAuthorizationRequestDto,
    @Req() request: UserRequest,
  ): Promise<PenetrationTestingAuthorizationResponseDto> {
    return this.authorizations.revoke(params.id, { id: request.user.userId, via: "session" }, body.reason);
  }

  @Get("authorizations")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PenetrationTestingAuthorization)
  @ApiOperation({ summary: "List authorizations, newest first (the approval queue)" })
  @ApiOkResponse({ type: PenetrationTestingAuthorizationListResponseDto })
  async listAuthorizations(
    @Query() query: ListPenetrationTestingAuthorizationsRequestDto,
  ): Promise<PenetrationTestingAuthorizationListResponseDto> {
    return { authorizations: await this.authorizations.list(query) };
  }

  // --- L4 test objects ---------------------------------------------------

  @Post("test-objects")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.PenetrationTestingTestObject)
  @ApiOperation({ summary: "Register a disposable object an L4 playbook may destroy" })
  @ApiResponse({ status: 201, type: PenetrationTestingTestObjectResponseDto })
  async createTestObject(
    @Body() body: CreatePenetrationTestingTestObjectRequestDto,
    @Req() request: UserRequest,
  ): Promise<PenetrationTestingTestObjectResponseDto> {
    return this.testObjects.create({ ...body, createdBy: request.user.userId });
  }

  @Post("test-objects/:id/approve")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.PenetrationTestingTestObject)
  @ApiOperation({ summary: "Approve a disposable test object; the approver must differ from the registrant" })
  @ApiOkResponse({ type: PenetrationTestingTestObjectResponseDto })
  async approveTestObject(
    @Param() params: PenetrationTestingTestObjectParamsDto,
    @Req() request: UserRequest,
  ): Promise<PenetrationTestingTestObjectResponseDto> {
    return this.testObjects.approve(params.id, request.user.userId);
  }

  @Get("test-objects")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PenetrationTestingTestObject)
  @ApiOperation({ summary: "List a subject's L4 test objects, newest first" })
  @ApiOkResponse({ type: PenetrationTestingTestObjectListResponseDto })
  async listTestObjects(
    @Query() query: ListPenetrationTestingTestObjectsRequestDto,
  ): Promise<PenetrationTestingTestObjectListResponseDto> {
    return { testObjects: await this.testObjects.list(query.subjectId) };
  }

  // --- Playbooks ---------------------------------------------------------

  @Get("playbooks")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PenetrationTestingTarget)
  @ApiOperation({ summary: "The fixed L4 playbook catalogue (a projection of code constants)" })
  @ApiOkResponse({ type: PenetrationTestingPlaybookListResponseDto })
  listPlaybooks(): PenetrationTestingPlaybookListResponseDto {
    return { playbooks: PENETRATION_TESTING_PLAYBOOKS.map((playbook) => ({ ...playbook })) };
  }

  // --- Runs --------------------------------------------------------------

  @Post("runs")
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.EvaluationRun)
  @ApiOperation({
    summary: "Dispatch one L1–L4 run (fire-and-forget); the gate reloads authorization and test object",
  })
  @ApiResponse({ status: 202, type: PenetrationTestingRunAcceptedResponseDto })
  async startRun(
    @Body() body: StartPenetrationTestingRunRequestDto,
    @Req() request: UserRequest,
  ): Promise<PenetrationTestingRunAcceptedResponseDto> {
    return this.runs.startRun({
      subjectId: body.subjectId,
      judgmentConfig: body.judgmentConfig,
      requestedBy: request.user.userId,
    });
  }

  @Get("runs")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EvaluationRun)
  @ApiOperation({ summary: "List this feature's runs, newest first" })
  @ApiOkResponse({ type: ListPenetrationTestingRunsResponseDto })
  async listRuns(@Query() query: ListPenetrationTestingRunsRequestDto) {
    return this.runs.listRuns({
      subjectId: query.subjectId,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get("runs/:runId")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.EvaluationRun)
  @ApiOperation({ summary: "Read one run of this feature" })
  @ApiOkResponse({ type: PenetrationTestingRunResponseDto })
  getRun(@Param() params: PenetrationTestingRunParamsDto) {
    return this.runs.getRun(params.runId);
  }

  // --- Findings / results ------------------------------------------------

  @Get("findings")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EvaluationFinding)
  @ApiOperation({ summary: "List findings for one subject (anchored, so other features never mix in)" })
  @ApiOkResponse({ type: ListPenetrationTestingFindingsResponseDto })
  async listFindings(@Query() query: ListPenetrationTestingFindingsRequestDto) {
    return this.runs.listFindings({
      subjectId: query.subjectId,
      standardKey: query.standardKey,
      status: query.status,
      severity: query.severity,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get("results")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EvaluationResult)
  @ApiOperation({ summary: "List archived results for one subject, newest first" })
  @ApiOkResponse({ type: ListPenetrationTestingResultsResponseDto })
  async listResults(@Query() query: ListPenetrationTestingResultsRequestDto) {
    return this.runs.listResults({
      subjectId: query.subjectId,
      ruleSetVersionId: query.ruleSetVersionId,
      page: query.page,
      pageSize: query.pageSize,
    });
  }
}
