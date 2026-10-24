import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { ThreatIntelService } from "./threat-intel.service";
import {
  ListThreatIntelItemsQuery,
  ListThreatIntelMatchesQuery,
  ThreatIntelItemDto,
  ThreatIntelMatchDto,
  UpdateMatchStatusRequest,
} from "./threat-intel.dto";

@ApiTags("Threat Intel")
@ApiBearerAuth()
@Controller("threat-intel")
export class ThreatIntelController {
  constructor(private readonly service: ThreatIntelService) {}

  @Get("items")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.ThreatIntelItem)
  @ApiOperation({ summary: "List threat intel items with filters" })
  @ApiResponse({ status: 200, type: [ThreatIntelItemDto] })
  async listItems(@Query() query: ListThreatIntelItemsQuery) {
    return this.service.listItems(query);
  }

  @Get("items/:id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.ThreatIntelItem)
  @ApiOperation({ summary: "Get a threat intel item with its matches" })
  @ApiResponse({ status: 200, type: ThreatIntelItemDto })
  async getItem(@Param("id") id: string) {
    return this.service.getItem(id);
  }

  @Post("collect")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.ThreatIntelItem)
  @ApiOperation({ summary: "Manually trigger collection and matching pipeline" })
  @ApiResponse({ status: 200, description: "Collection and matching result" })
  async collect() {
    return this.service.collectAndMatch();
  }

  @Get("matches")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.ThreatIntelMatch)
  @ApiOperation({ summary: "List threat intel matches against projects" })
  @ApiResponse({ status: 200, type: [ThreatIntelMatchDto] })
  async listMatches(@Query() query: ListThreatIntelMatchesQuery) {
    return this.service.listMatches(query);
  }

  @Patch("matches/:id/status")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.ThreatIntelMatch)
  @ApiOperation({ summary: "Update match disposition status" })
  @ApiResponse({ status: 200, type: ThreatIntelMatchDto })
  async updateMatchStatus(@Param("id") id: string, @Body() body: UpdateMatchStatusRequest) {
    return this.service.updateMatchStatus(id, body.status);
  }
}
