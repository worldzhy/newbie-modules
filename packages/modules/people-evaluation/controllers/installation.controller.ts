import { Body, Controller, Delete, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";

import {
  CreatePeopleEvaluationInstallationRequestDto,
  ListPeopleEvaluationInstallationsRequestDto,
  PeopleEvaluationInstallationCredentialResponseDto,
  PeopleEvaluationInstallationResponseDto,
} from "../people-evaluation.dto";
import { PeopleEvaluationInstallationService } from "../people-evaluation-installation.service";

/**
 * Supervisor-side enrollment API for member installation agents. Protected by
 * the platform JWT guard; ingest endpoints are token-only.
 *
 * Credentials are delivered exactly once: creation and token rotation return
 * `PeopleEvaluationInstallationCredentialResponseDto` (installation fields plus
 * the plaintext token). GET / List never carry the token — at rest only its
 * SHA-256 hash exists.
 */
@ApiTags("People Evaluation / Installations")
@ApiBearerAuth()
@Controller("people/installations")
export class PeopleEvaluationInstallationController {
  constructor(private readonly installations: PeopleEvaluationInstallationService) {}

  @Post()
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.PeopleEvaluationInstallation)
  @ApiOperation({ summary: "Enroll a member's installation agent (plaintext token returned once)" })
  @ApiCreatedResponse({ type: PeopleEvaluationInstallationCredentialResponseDto })
  create(@Body() body: CreatePeopleEvaluationInstallationRequestDto) {
    return this.installations.create(body);
  }

  @Get()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.PeopleEvaluationInstallation)
  @ApiOperation({ summary: "List installations" })
  @ApiOkResponse({ type: PeopleEvaluationInstallationResponseDto, isArray: true })
  list(@Query() query: ListPeopleEvaluationInstallationsRequestDto) {
    return this.installations.list(query);
  }

  @Get("mine")
  @ApiOperation({ summary: "List the authenticated member's own installations" })
  @ApiOkResponse({ type: PeopleEvaluationInstallationResponseDto, isArray: true })
  listMine(@Req() request: UserRequest) {
    return this.installations.list({ evaluateeUserId: request.user.userId });
  }

  @Get(":id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.PeopleEvaluationInstallation)
  @ApiOperation({ summary: "Get one installation (no token)" })
  @ApiOkResponse({ type: PeopleEvaluationInstallationResponseDto })
  get(@Param("id") id: string) {
    return this.installations.get(id);
  }

  @Post(":id/token/regenerate")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.PeopleEvaluationInstallation)
  @ApiOperation({ summary: "Rotate the installation token (plaintext returned once)" })
  @ApiCreatedResponse({ type: PeopleEvaluationInstallationCredentialResponseDto })
  regenerate(@Param("id") id: string) {
    return this.installations.regenerateToken(id);
  }

  @Delete(":id")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.PeopleEvaluationInstallation)
  @ApiOperation({ summary: "Revoke an installation agent; subsequent ingest gets 401" })
  @ApiOkResponse()
  revoke(@Param("id") id: string) {
    return this.installations.revoke(id);
  }
}
