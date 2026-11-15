import { Body, Controller, ForbiddenException, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
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
import {
  ALERT_SCOPE_VISIBILITY_PORT,
  type AlertScopeVisibilityPort,
  type AlertSeverity,
} from "./alert-center.constants";

interface AuthenticatedRequest {
  user: { userId: string };
}

@ApiTags("Alert Center")
@ApiBearerAuth()
@Controller()
export class AlertCenterController {
  constructor(
    private readonly alerts: AlertCenterService,
    @Inject(ALERT_SCOPE_VISIBILITY_PORT)
    private readonly scopeVisibility: AlertScopeVisibilityPort,
  ) {}

  @Post("alerts")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.Alert)
  @ApiOperation({ summary: "Raise or advance one alert lifecycle" })
  @ApiResponse({ status: 201, type: RaiseAlertResultDto })
  async raise(@Req() req: AuthenticatedRequest, @Body() body: RaiseAlertDto): Promise<RaiseAlertResultDto> {
    await this.assertScopeWritable(req.user.userId, body.scopeId);
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
  async resolve(@Req() req: AuthenticatedRequest, @Body() body: ResolveAlertDto): Promise<ResolveAlertResultDto> {
    await this.assertScopeWritable(req.user.userId, body.scopeId);
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

  /**
   * Bind one HTTP write to the caller's own scopes. Only checked when the body
   * names a scope: a scope-less (platform) write never reaches a project's push
   * track, matching the notification endpoint's rule. In-process producers call
   * the service directly and are not subject to this guard.
   */
  private async assertScopeWritable(userId: string, scopeId: string | undefined): Promise<void> {
    if (!scopeId) {
      return;
    }
    const visible = await this.scopeVisibility.visibleScopeIds(userId);
    if (!visible.includes(scopeId)) {
      throw new ForbiddenException(`Alert scope is not visible to the caller: ${scopeId}`);
    }
  }
}
