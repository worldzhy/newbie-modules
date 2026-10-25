import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { ThreatIntelligenceService } from "./threat-intelligence.service";
import {
  ListThreatIntelligenceItemsQuery,
  ListThreatIntelligenceItemsResponseDto,
  ThreatIntelligenceItemDto,
} from "./threat-intelligence.dto";

@ApiTags("Threat Intel")
@ApiBearerAuth()
@Controller("threat-intelligence")
export class ThreatIntelligenceController {
  constructor(private readonly service: ThreatIntelligenceService) {}

  @Get("items")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.ThreatIntelligenceItem)
  @ApiOperation({ summary: "List threat intel items with filters" })
  @ApiResponse({ status: 200, type: ListThreatIntelligenceItemsResponseDto })
  async listItems(@Query() query: ListThreatIntelligenceItemsQuery) {
    return this.service.listItems(query);
  }

  @Get("items/:id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.ThreatIntelligenceItem)
  @ApiOperation({ summary: "Get a threat intel item" })
  @ApiResponse({ status: 200, type: ThreatIntelligenceItemDto })
  async getItem(@Param("id") id: string) {
    return this.service.getItem(id);
  }

  @Post("collect")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.ThreatIntelligenceItem)
  @ApiOperation({ summary: "Manually trigger the collection pipeline" })
  @ApiResponse({ status: 200, description: "Collection result" })
  async collect() {
    return this.service.collect();
  }
}
