import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { EventEmitterService } from "./event-emitter.service";
import { EventDescriptionDto, ListEventEmissionsRequestDto, ListEventEmissionsResponseDto } from "./event-emitter.dto";

@ApiTags("Event Emitter")
@ApiBearerAuth()
@Controller("event-emitter")
export class EventEmitterController {
  constructor(private readonly eventEmitterService: EventEmitterService) {}

  @Get("events")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EventEmission)
  @ApiOperation({ summary: "List declared and observed events with listener and emission stats" })
  @ApiResponse({ status: 200, type: [EventDescriptionDto] })
  listEvents(): Promise<EventDescriptionDto[]> {
    return this.eventEmitterService.listEvents() as Promise<EventDescriptionDto[]>;
  }

  @Get("emissions")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.EventEmission)
  @ApiOperation({ summary: "List recorded event emissions, optionally filtered by event key" })
  @ApiResponse({ status: 200, type: ListEventEmissionsResponseDto })
  listEmissions(@Query() query: ListEventEmissionsRequestDto): Promise<ListEventEmissionsResponseDto> {
    return this.eventEmitterService.listEmissions(
      query.eventKey,
      query.page,
      query.pageSize,
    ) as Promise<ListEventEmissionsResponseDto>;
  }
}
