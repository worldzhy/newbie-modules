import { Body, Controller, Delete, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";

import {
  CreateWorkEvaluationInstallationRequestDto,
  GetWorkEvaluationByIdRequestDto,
  ListWorkEvaluationInstallationsRequestDto,
  WorkEvaluationInstallationCredentialResponseDto,
  WorkEvaluationInstallationResponseDto,
} from "../work-evaluation.dto";
import { WorkEvaluationInstallationService } from "../work-evaluation-installation.service";

/**
 * Supervisor-side enrollment API for member installation agents. Protected by
 * the platform JWT guard; ingest endpoints are token-only.
 *
 * Credentials are delivered exactly once: creation and token rotation return
 * `WorkEvaluationInstallationCredentialResponseDto` (installation fields plus
 * the plaintext token). GET / List never carry the token — at rest only its
 * SHA-256 hash exists.
 */
@ApiTags("Work Evaluation / Installations")
@ApiBearerAuth()
@Controller("work-evaluation/installations")
export class WorkEvaluationInstallationController {
  constructor(private readonly installations: WorkEvaluationInstallationService) {}

  @Post()
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.WorkEvaluationInstallation)
  @ApiOperation({ summary: "Enroll a member's installation agent (plaintext token returned once)" })
  @ApiCreatedResponse({ type: WorkEvaluationInstallationCredentialResponseDto })
  create(@Body() body: CreateWorkEvaluationInstallationRequestDto, @Req() request: UserRequest) {
    return this.installations.create(body, request.user.userId);
  }

  @Get()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.WorkEvaluationInstallation)
  @ApiOperation({ summary: "List installations" })
  @ApiOkResponse({ type: WorkEvaluationInstallationResponseDto, isArray: true })
  list(@Query() query: ListWorkEvaluationInstallationsRequestDto) {
    return this.installations.list(query);
  }

  @Get("mine")
  @ApiOperation({ summary: "List the authenticated member's own installations" })
  @ApiOkResponse({ type: WorkEvaluationInstallationResponseDto, isArray: true })
  listMine(@Req() request: UserRequest) {
    return this.installations.list({ evaluateeUserId: request.user.userId });
  }

  @Get(":id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.WorkEvaluationInstallation)
  @ApiOperation({ summary: "Get one installation (no token)" })
  @ApiOkResponse({ type: WorkEvaluationInstallationResponseDto })
  get(@Param() params: GetWorkEvaluationByIdRequestDto) {
    return this.installations.get(params.id);
  }

  @Post(":id/token/regenerate")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.WorkEvaluationInstallation)
  @ApiOperation({ summary: "Rotate the installation token (plaintext returned once)" })
  @ApiCreatedResponse({ type: WorkEvaluationInstallationCredentialResponseDto })
  regenerate(@Param() params: GetWorkEvaluationByIdRequestDto, @Req() request: UserRequest) {
    return this.installations.regenerateToken(params.id, request.user.userId);
  }

  @Delete(":id")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.WorkEvaluationInstallation)
  @ApiOperation({ summary: "Revoke an installation agent; subsequent ingest gets 401" })
  @ApiOkResponse()
  revoke(@Param() params: GetWorkEvaluationByIdRequestDto, @Req() request: UserRequest) {
    return this.installations.revoke(params.id, request.user.userId);
  }
}
