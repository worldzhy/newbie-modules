import { Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { AlertCenterService } from "./alert-center.service";
import {
  AlertDto,
  AlertSourceDto,
  ListAlertsRequestDto,
  ListAlertsResponseDto,
  RaiseAlertDto,
  RaiseAlertResultDto,
  ResolveAlertDto,
  ResolveAlertResultDto,
  UpdateAlertSourceDto,
} from "./alert-center.dto";
import type { AlertSeverity } from "./alert-center.constants";

@ApiTags("Alert Center")
@ApiBearerAuth()
@Controller()
export class AlertCenterController {
  constructor(private readonly alerts: AlertCenterService) {}

  @Post("alerts")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.Alert)
  @ApiOperation({ summary: "Raise or advance one alert lifecycle" })
  @ApiResponse({ status: 201, type: RaiseAlertResultDto })
  raise(@Body() body: RaiseAlertDto): Promise<RaiseAlertResultDto> {
    return this.alerts.raise({
      source: body.source,
      alertKey: body.alertKey,
      scopeId: body.scopeId,
      severity: body.severity as AlertSeverity,
      labels: body.labels,
      data: body.data,
      repeatIntervalMinutes: body.repeatIntervalMinutes,
    });
  }

  @Post("alerts/resolve")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.Alert)
  @ApiOperation({ summary: "Resolve one alert lifecycle; a late resolve returns a null id" })
  @ApiResponse({ status: 201, type: ResolveAlertResultDto })
  async resolve(@Body() body: ResolveAlertDto): Promise<ResolveAlertResultDto> {
    const result = await this.alerts.resolve({
      source: body.source,
      alertKey: body.alertKey,
      scopeId: body.scopeId,
      resolvedAt: body.resolvedAt ? new Date(body.resolvedAt) : undefined,
    });
    return { id: result?.id ?? null };
  }

  @Get("alerts")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.Alert)
  @ApiOperation({ summary: "List alerts, newest first" })
  @ApiResponse({ status: 200, type: ListAlertsResponseDto })
  list(@Query() query: ListAlertsRequestDto): Promise<ListAlertsResponseDto> {
    return this.alerts.list(query);
  }

  @Get("alerts/:id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.Alert)
  @ApiOperation({ summary: "Read one alert" })
  @ApiResponse({ status: 200, type: AlertDto })
  get(@Param("id") id: string): Promise<AlertDto> {
    return this.alerts.get(id);
  }

  @Get("alert-sources")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.AlertSource)
  @ApiOperation({ summary: "Registered alert sources with their rhythm and pause overrides" })
  @ApiResponse({ status: 200, type: [AlertSourceDto] })
  listSources(): Promise<AlertSourceDto[]> {
    return this.alerts.listSources();
  }

  @Put("alert-sources/:key")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.AlertSource)
  @ApiOperation({ summary: "Change one source's reminder rhythm or pause window" })
  @ApiResponse({ status: 200, type: AlertSourceDto })
  updateSource(@Param("key") key: string, @Body() body: UpdateAlertSourceDto): Promise<AlertSourceDto> {
    return this.alerts.updateSource(key, body ?? {});
  }
}
