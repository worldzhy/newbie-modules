import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { ThreatIntelService } from "./threat-intel.service";
import { ListThreatIntelItemsQuery, ThreatIntelItemDto } from "./threat-intel.dto";

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
  @ApiOperation({ summary: "Get a threat intel item" })
  @ApiResponse({ status: 200, type: ThreatIntelItemDto })
  async getItem(@Param("id") id: string) {
    return this.service.getItem(id);
  }

  @Post("collect")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.ThreatIntelItem)
  @ApiOperation({ summary: "Manually trigger the collection pipeline" })
  @ApiResponse({ status: 200, description: "Collection result" })
  async collect() {
    return this.service.collect();
  }
}
