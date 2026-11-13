import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CommonGetByStringIdRequestDto } from "@devbie/newbie/common.dto";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequireOwner } from "@modules/security/authorization/require-owner.decorator";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { NotificationCenterService, NotifyResult } from "./notification-center.service";
import { NotificationDeliveryRuleService } from "./notification-delivery-rule.service";
import { NotificationSettingService } from "./notification-setting.service";
import { NotificationSilenceService } from "./notification-silence.service";
import {
  NOTIFICATION_VISIBILITY_PORT,
  NotificationVisibilityPort,
  type NotificationSeverity,
} from "./notification-center.constants";
import {
  CreateDeliveryRuleDto,
  CreateSilenceDto,
  DeliveryRuleDto,
  ListNotificationsRequestDto,
  ListNotificationsResponseDto,
  MarkAllNotificationsReadResponseDto,
  MarkNotificationReadResponseDto,
  NotificationCenterSettingDto,
  NotificationDeliveryAttemptDto,
  NotificationPushFailureDto,
  NotificationSettingDto,
  NotifyDto,
  NotifyResultDto,
  ReorderDeliveryRulesDto,
  SilenceDto,
  SimulateDeliveryRequestDto,
  SimulateDeliveryResultDto,
  TestPushResultDto,
  UnreadCountResponseDto,
  UpdateDeliveryRuleDto,
  UpdateNotificationCenterSettingDto,
  UpdateNotificationSettingDto,
  UpdateSilenceDto,
} from "./notification-center.dto";

interface AuthenticatedRequest {
  user: { userId: string };
}

@ApiTags("Notification Center")
@ApiBearerAuth()
@Controller()
export class NotificationCenterController {
  constructor(
    private readonly notificationCenter: NotificationCenterService,
    private readonly notificationSettings: NotificationSettingService,
    private readonly deliveryRules: NotificationDeliveryRuleService,
    private readonly silences: NotificationSilenceService,
    @Inject(NOTIFICATION_VISIBILITY_PORT)
    private readonly projectVisibility: NotificationVisibilityPort,
  ) {}

  // --- Notification delivery ----------------------------------------------

  @Post("notifications")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.NotificationRecord)
  @ApiOperation({ summary: "Deliver a notification from a registered notification" })
  @ApiResponse({ status: 201, type: NotifyResultDto })
  async notify(@Req() req: AuthenticatedRequest, @Body() body: NotifyDto): Promise<NotifyResult> {
    // Permission is resolved here: the service only receives the scope. Skipped
    // for platform-scoped deliveries that carry no projectId.
    const visibleProjectIds = body.projectId
      ? await this.projectVisibility.visibleProjectIds(req.user.userId)
      : undefined;
    // The HTTP contract carries ISO strings; the service works with Date.
    return this.notificationCenter.notify({
      ...body,
      severity: body.severity as NotificationSeverity | undefined,
      recoveredAt: body.recoveredAt ? new Date(body.recoveredAt) : undefined,
      visibleProjectIds,
    });
  }

  // --- Notification reads -------------------------------------------------

  @Get("notifications")
  @RequireOwner()
  @ApiOperation({ summary: "List notifications for the current user (newest first)" })
  @ApiResponse({ status: 200, type: ListNotificationsResponseDto })
  async list(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListNotificationsRequestDto,
  ): Promise<ListNotificationsResponseDto> {
    const visibleProjectIds = await this.projectVisibility.visibleProjectIds(req.user.userId);
    return this.notificationCenter.list(req.user.userId, visibleProjectIds, query);
  }

  @Get("notifications/unread-count")
  @RequireOwner()
  @ApiOperation({ summary: "Count unread notifications for the current user" })
  @ApiResponse({ status: 200, type: UnreadCountResponseDto })
  async unreadCount(@Req() req: AuthenticatedRequest): Promise<UnreadCountResponseDto> {
    const visibleProjectIds = await this.projectVisibility.visibleProjectIds(req.user.userId);
    return this.notificationCenter.unreadCount(req.user.userId, visibleProjectIds);
  }

  @Post("notifications/:id/read")
  @RequireOwner()
  @ApiOperation({ summary: "Mark one notification as read for the current user" })
  @ApiResponse({ status: 200, type: MarkNotificationReadResponseDto })
  async markRead(
    @Req() req: AuthenticatedRequest,
    @Param() params: CommonGetByStringIdRequestDto,
  ): Promise<MarkNotificationReadResponseDto> {
    const visibleProjectIds = await this.projectVisibility.visibleProjectIds(req.user.userId);
    return this.notificationCenter.markRead(req.user.userId, params.id, visibleProjectIds);
  }

  @Post("notifications/read-all")
  @RequireOwner()
  @ApiOperation({ summary: "Mark every visible notification as read for the current user" })
  @ApiResponse({ status: 200, type: MarkAllNotificationsReadResponseDto })
  async markAllRead(@Req() req: AuthenticatedRequest): Promise<MarkAllNotificationsReadResponseDto> {
    const visibleProjectIds = await this.projectVisibility.visibleProjectIds(req.user.userId);
    return this.notificationCenter.markAllRead(req.user.userId, visibleProjectIds);
  }

  @Get("notifications/:id/delivery-attempt")
  @RequireOwner()
  @ApiOperation({ summary: "Delivery decision recorded for one notification (ADR-062)" })
  @ApiResponse({ status: 200, type: NotificationDeliveryAttemptDto })
  async getDeliveryAttempt(
    @Req() req: AuthenticatedRequest,
    @Param() params: CommonGetByStringIdRequestDto,
  ): Promise<NotificationDeliveryAttemptDto | null> {
    const visibleProjectIds = await this.projectVisibility.visibleProjectIds(req.user.userId);
    return this.notificationCenter.getDeliveryAttempt(params.id, visibleProjectIds);
  }

  // --- Per-notification settings -------------------------------------------

  @Get("notification-settings")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.NotificationSetting)
  @ApiOperation({ summary: "List registered notifications with their runtime settings" })
  @ApiResponse({ status: 200, type: [NotificationSettingDto] })
  listSettings(): Promise<NotificationSettingDto[]> {
    return this.notificationSettings.listSettings() as unknown as Promise<NotificationSettingDto[]>;
  }

  @Put("notification-settings/:key")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.NotificationSetting)
  @ApiOperation({ summary: "Update runtime settings for a notification" })
  @ApiResponse({ status: 200, type: NotificationSettingDto })
  updateSetting(
    @Param("key") key: string,
    @Body() body: UpdateNotificationSettingDto,
  ): Promise<NotificationSettingDto> {
    return this.notificationSettings.updateSetting(key, body ?? {}) as unknown as Promise<NotificationSettingDto>;
  }

  // --- Center settings -----------------------------------------------------

  @Get("notification-center-setting")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.NotificationCenterSetting)
  @ApiOperation({ summary: "Get notification-center settings" })
  @ApiResponse({ status: 200, type: NotificationCenterSettingDto })
  getCenterSettings(): Promise<NotificationCenterSettingDto> {
    return this.notificationCenter.getCenterSettings();
  }

  @Put("notification-center-setting")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.NotificationCenterSetting)
  @ApiOperation({ summary: "Update notification-center settings" })
  @ApiResponse({ status: 200, type: NotificationCenterSettingDto })
  updateCenterSettings(@Body() body: UpdateNotificationCenterSettingDto): Promise<NotificationCenterSettingDto> {
    return this.notificationCenter.updateCenterSettings(body ?? {});
  }

  @Post("notification-center-setting/test-push")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.NotificationCenterSetting)
  @ApiOperation({ summary: "Send a test message to the host-configured system chats" })
  @ApiResponse({ status: 200, type: TestPushResultDto })
  testPush(): Promise<TestPushResultDto> {
    return this.notificationCenter.testPush();
  }

  // --- Delivery rules (ADR-062) ---------------------------------------------

  @Get("notification-delivery-rules")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.NotificationDeliveryRule)
  @ApiOperation({ summary: "List delivery rules in evaluation order" })
  @ApiResponse({ status: 200, type: [DeliveryRuleDto] })
  listDeliveryRules(): Promise<DeliveryRuleDto[]> {
    return this.deliveryRules.list();
  }

  @Post("notification-delivery-rules")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.NotificationDeliveryRule)
  @ApiOperation({ summary: "Append a delivery rule" })
  @ApiResponse({ status: 201, type: DeliveryRuleDto })
  createDeliveryRule(@Body() body: CreateDeliveryRuleDto): Promise<DeliveryRuleDto> {
    return this.deliveryRules.create(body);
  }

  @Post("notification-delivery-rules/simulate")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.NotificationDeliveryRule)
  @ApiOperation({ summary: "Replay the rule table for one notification without changing state" })
  @ApiResponse({ status: 201, type: SimulateDeliveryResultDto })
  async simulateDelivery(
    @Req() req: AuthenticatedRequest,
    @Body() body: SimulateDeliveryRequestDto,
  ): Promise<SimulateDeliveryResultDto> {
    // Replaying a persisted record must respect the caller's project scope,
    // exactly like every other read of notification records (R39-06).
    const visibleProjectIds = await this.projectVisibility.visibleProjectIds(req.user.userId);
    return this.deliveryRules.simulate(body, visibleProjectIds);
  }

  // Declared before the ":id" route so the literal segment wins.
  @Put("notification-delivery-rules/order")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.NotificationDeliveryRule)
  @ApiOperation({ summary: "Rewrite the evaluation order from a complete id list" })
  @ApiResponse({ status: 200, type: [DeliveryRuleDto] })
  reorderDeliveryRules(@Body() body: ReorderDeliveryRulesDto): Promise<DeliveryRuleDto[]> {
    return this.deliveryRules.reorder(body.ids);
  }

  @Put("notification-delivery-rules/:id")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.NotificationDeliveryRule)
  @ApiOperation({ summary: "Update one delivery rule" })
  @ApiResponse({ status: 200, type: DeliveryRuleDto })
  updateDeliveryRule(@Param("id") id: string, @Body() body: UpdateDeliveryRuleDto): Promise<DeliveryRuleDto> {
    return this.deliveryRules.update(id, body ?? {});
  }

  @Delete("notification-delivery-rules/:id")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.NotificationDeliveryRule)
  @ApiOperation({ summary: "Delete one delivery rule (the last rule cannot be deleted)" })
  @ApiResponse({ status: 200, description: "The deleted rule id" })
  deleteDeliveryRule(@Param("id") id: string): Promise<{ id: string }> {
    return this.deliveryRules.remove(id);
  }

  // --- Silences (ADR-063) ---------------------------------------------------

  @Get("notification-silences")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.NotificationSilence)
  @ApiOperation({ summary: "List maintenance windows, newest end first" })
  @ApiResponse({ status: 200, type: [SilenceDto] })
  listSilences(): Promise<SilenceDto[]> {
    return this.silences.list();
  }

  @Post("notification-silences")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.NotificationSilence)
  @ApiOperation({ summary: "Open a maintenance window; matching notifications stay in-app" })
  @ApiResponse({ status: 201, type: SilenceDto })
  createSilence(@Req() req: AuthenticatedRequest, @Body() body: CreateSilenceDto): Promise<SilenceDto> {
    return this.silences.create(body, req.user.userId);
  }

  @Put("notification-silences/:id")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.NotificationSilence)
  @ApiOperation({ summary: "Update one maintenance window" })
  @ApiResponse({ status: 200, type: SilenceDto })
  updateSilence(@Param("id") id: string, @Body() body: UpdateSilenceDto): Promise<SilenceDto> {
    return this.silences.update(id, body ?? {});
  }

  @Post("notification-silences/:id/cancel")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.NotificationSilence)
  @ApiOperation({ summary: "End a maintenance window now, keeping its row for audit" })
  @ApiResponse({ status: 200, type: SilenceDto })
  cancelSilence(@Param("id") id: string): Promise<SilenceDto> {
    return this.silences.cancel(id);
  }

  // No DELETE route: a window that already intercepted deliveries owns the
  // audit rows that point at it, so the only supported disposition is ending
  // it early (ADR-063).

  // --- Push failures --------------------------------------------------------

  @Get("notification-center/push-failures")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.NotificationPushFailure)
  @ApiOperation({ summary: "List unresolved push failures across all recipients" })
  @ApiResponse({ status: 200, type: [NotificationPushFailureDto] })
  listPushFailures(): Promise<NotificationPushFailureDto[]> {
    return this.notificationCenter.listUnresolved();
  }
}
