import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";

import {
  CreateWorklogInstallationRequestDto,
  ListWorklogInstallationsRequestDto,
  WorklogInstallationResponseDto,
  WorklogProfileResponseDto,
} from "../people-evaluation-worklog.dto";
import { PeopleEvaluationWorklogInstallationService } from "../people-evaluation-worklog-installation.service";

/**
 * Supervisor-side enrollment API for member worklog agents. Protected by the
 * platform JWT guard; ingest endpoints are token-only. The plaintext token is
 * returned exactly once (create / regenerate).
 */
@ApiTags("People Evaluation / Worklog Installations")
@ApiBearerAuth()
@Controller("people/worklog/installations")
export class PeopleEvaluationWorklogInstallationController {
  constructor(private readonly installations: PeopleEvaluationWorklogInstallationService) {}

  @Post()
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.PeopleEvaluationWorklogInstallation)
  @ApiOperation({ summary: "Enroll a member's worklog agent (plaintext token returned once)" })
  @ApiCreatedResponse({ type: WorklogInstallationResponseDto })
  create(@Body() body: CreateWorklogInstallationRequestDto) {
    return this.installations.create(body);
  }

  @Get()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationWorklogInstallation)
  @ApiOperation({ summary: "List worklog installations" })
  @ApiOkResponse({ type: WorklogInstallationResponseDto, isArray: true })
  list(@Query() query: ListWorklogInstallationsRequestDto) {
    return this.installations.list(query);
  }

  @Get("mine")
  @ApiOperation({ summary: "List the authenticated member's own worklog installations" })
  @ApiOkResponse({ type: WorklogInstallationResponseDto, isArray: true })
  listMine(@Req() request: UserRequest) {
    return this.installations.list({ evaluateeUserId: request.user.userId });
  }

  @Post(":id/profile")
  @ApiOperation({
    summary:
      "Download the member's worklog profile (endpoint + token + evaluatee userId). Rotates the token: " +
      "the previously running worklog config stops working.",
  })
  @ApiOkResponse({ type: WorklogProfileResponseDto })
  async downloadProfile(@Param("id") id: string, @Req() request: UserRequest): Promise<WorklogProfileResponseDto> {
    const installation = await this.installations.getOrThrow(id);
    if (installation.evaluateeUserId !== request.user.userId) {
      throw new ForbiddenException("You can only download a profile for your own worklog installation.");
    }
    const { token } = await this.installations.regenerateToken(id);
    return {
      endpoint: `${request.protocol}://${request.get("host")}`,
      token,
      evaluateeUserId: installation.evaluateeUserId,
    };
  }

  @Get(":id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.PeopleEvaluationWorklogInstallation)
  @ApiOperation({ summary: "Get one worklog installation" })
  @ApiOkResponse({ type: WorklogInstallationResponseDto })
  get(@Param("id") id: string) {
    return this.installations.get(id);
  }

  @Post(":id/token/regenerate")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.PeopleEvaluationWorklogInstallation)
  @ApiOperation({ summary: "Rotate the worklog token (plaintext returned once)" })
  @ApiOkResponse()
  regenerate(@Param("id") id: string) {
    return this.installations.regenerateToken(id);
  }

  @Delete(":id")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.PeopleEvaluationWorklogInstallation)
  @ApiOperation({ summary: "Revoke a worklog agent; subsequent ingest gets 401" })
  @ApiOkResponse()
  revoke(@Param("id") id: string) {
    return this.installations.revoke(id);
  }
}
