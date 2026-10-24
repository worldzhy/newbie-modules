import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";

import {
  CollectorInstallationResponseDto,
  CollectorProfileResponseDto,
  CreateCollectorInstallationDto,
  ListCollectorInstallationsQueryDto,
} from "../people-evaluation-collector.dto";
import { PeopleEvaluationInstallationService } from "../people-evaluation-installation.service";

/**
 * Supervisor-side enrollment API for member work collectors. Protected by the
 * platform JWT guard; ingest endpoints are token-only. The plaintext token is
 * returned exactly once (create / regenerate).
 */
@ApiTags("People Evaluation / Collector Installations")
@ApiBearerAuth()
@Controller("people-evaluation/collector/installations")
export class PeopleEvaluationInstallationController {
  constructor(private readonly installations: PeopleEvaluationInstallationService) {}

  @Post()
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.PeopleEvaluationCollectorInstallation)
  @ApiOperation({ summary: "Enroll a member's work collector (plaintext token returned once)" })
  @ApiCreatedResponse({ type: CollectorInstallationResponseDto })
  create(@Body() body: CreateCollectorInstallationDto) {
    return this.installations.create(body);
  }

  @Get()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationCollectorInstallation)
  @ApiOperation({ summary: "List collector installations" })
  @ApiOkResponse({ type: CollectorInstallationResponseDto, isArray: true })
  list(@Query() query: ListCollectorInstallationsQueryDto) {
    return this.installations.list(query);
  }

  @Get("mine")
  @ApiOperation({ summary: "List the authenticated member's own collector installations" })
  @ApiOkResponse({ type: CollectorInstallationResponseDto, isArray: true })
  listMine(@Req() request: UserRequest) {
    return this.installations.list({ memberUserId: request.user.userId });
  }

  @Post(":id/profile")
  @ApiOperation({
    summary:
      "Download the member's collector profile (endpoint + token + userId). Rotates the token: " +
      "the previously running collector config stops working.",
  })
  @ApiOkResponse({ type: CollectorProfileResponseDto })
  async downloadProfile(@Param("id") id: string, @Req() request: UserRequest): Promise<CollectorProfileResponseDto> {
    const installation = await this.installations.getOrThrow(id);
    if (installation.memberUserId !== request.user.userId) {
      throw new ForbiddenException("You can only download a profile for your own collector installation.");
    }
    const { token } = await this.installations.regenerateToken(id);
    return {
      endpoint: `${request.protocol}://${request.get("host")}`,
      token,
      memberUserId: installation.memberUserId,
    };
  }

  @Get(":id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.PeopleEvaluationCollectorInstallation)
  @ApiOperation({ summary: "Get one collector installation" })
  @ApiOkResponse({ type: CollectorInstallationResponseDto })
  get(@Param("id") id: string) {
    return this.installations.get(id);
  }

  @Post(":id/token/regenerate")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.PeopleEvaluationCollectorInstallation)
  @ApiOperation({ summary: "Rotate the collector token (plaintext returned once)" })
  @ApiOkResponse()
  regenerate(@Param("id") id: string) {
    return this.installations.regenerateToken(id);
  }

  @Delete(":id")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.PeopleEvaluationCollectorInstallation)
  @ApiOperation({ summary: "Revoke a collector; subsequent ingest gets 401" })
  @ApiOkResponse()
  revoke(@Param("id") id: string) {
    return this.installations.revoke(id);
  }
}
