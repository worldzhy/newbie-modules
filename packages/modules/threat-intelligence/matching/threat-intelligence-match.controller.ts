import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { ThreatIntelligenceMatchService } from "./threat-intelligence-match.service";
import {
  ListThreatIntelligenceMatchesQuery,
  ListThreatIntelligenceMatchesResponseDto,
  RunThreatIntelligenceMatchResponseDto,
  ThreatIntelligenceMatchDto,
  UpdateThreatIntelligenceMatchStatusRequest,
} from "./threat-intelligence-match.dto";

@ApiTags("Threat Intel Match")
@ApiBearerAuth()
@Controller("threat-intelligence/matches")
export class ThreatIntelligenceMatchController {
  constructor(private readonly service: ThreatIntelligenceMatchService) {}

  @Get()
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.ThreatIntelligenceMatch)
  @ApiOperation({ summary: "List threat intel matches, filterable by scopeType/scopeId" })
  @ApiResponse({ status: 200, type: ListThreatIntelligenceMatchesResponseDto })
  async listMatches(
    @Query() query: ListThreatIntelligenceMatchesQuery,
  ): Promise<ListThreatIntelligenceMatchesResponseDto> {
    return (await this.service.listMatches(query)) as ListThreatIntelligenceMatchesResponseDto;
  }

  @Get(":id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.ThreatIntelligenceMatch)
  @ApiOperation({ summary: "Get a threat intel match" })
  @ApiResponse({ status: 200, type: ThreatIntelligenceMatchDto })
  async getMatch(@Param("id") id: string): Promise<ThreatIntelligenceMatchDto> {
    return (await this.service.getMatch(id)) as ThreatIntelligenceMatchDto;
  }

  @Post("run")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.ThreatIntelligenceMatch)
  @ApiOperation({ summary: "Collect threat intel and match it against the host-bound scope entities" })
  @ApiResponse({ status: 200, type: RunThreatIntelligenceMatchResponseDto })
  async run(): Promise<RunThreatIntelligenceMatchResponseDto> {
    return this.service.collectAndMatch();
  }

  @Patch(":id/status")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.ThreatIntelligenceMatch)
  @ApiOperation({ summary: "Update match disposition status" })
  @ApiResponse({ status: 200, type: ThreatIntelligenceMatchDto })
  async updateMatchStatus(
    @Param("id") id: string,
    @Body() body: UpdateThreatIntelligenceMatchStatusRequest,
  ): Promise<ThreatIntelligenceMatchDto> {
    return (await this.service.updateMatchStatus(id, body.status)) as ThreatIntelligenceMatchDto;
  }
}
