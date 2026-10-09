import { Body, Controller, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CommonGetByStringIdRequestDto } from "@devbie/newbie/common.dto";
import { NotificationCenterService, NotifyInput, NotifyResult } from "./notification-center.service";
import { NotificationSettingService } from "./notification-setting.service";
import {
  ListNotificationsRequestDto,
  ListNotificationsResponseDto,
  MarkAllNotificationsReadResponseDto,
  MarkNotificationReadResponseDto,
  NotificationCenterSettingDto,
  NotificationSettingDto,
  NotifyDto,
  NotifyResultDto,
  TestPushResultDto,
  UnreadCountResponseDto,
  UpdateNotificationCenterSettingDto,
  UpdateNotificationSettingDto,
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
  ) {}

  // --- Notification delivery ----------------------------------------------

  @Post("notifications")
  @ApiOperation({ summary: "Deliver a notification from a registered notification" })
  @ApiResponse({ status: 201, type: NotifyResultDto })
  notify(@Body() body: NotifyDto): Promise<NotifyResult> {
    return this.notificationCenter.notify(body as NotifyInput);
  }

  // --- Notification reads -------------------------------------------------

  @Get("notifications")
  @ApiOperation({ summary: "List notifications for the current user (newest first)" })
  @ApiResponse({ status: 200, type: ListNotificationsResponseDto })
  list(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListNotificationsRequestDto,
  ): Promise<ListNotificationsResponseDto> {
    return this.notificationCenter.list(req.user.userId, query);
  }

  @Get("notifications/unread-count")
  @ApiOperation({ summary: "Count unread notifications for the current user" })
  @ApiResponse({ status: 200, type: UnreadCountResponseDto })
  unreadCount(@Req() req: AuthenticatedRequest): Promise<UnreadCountResponseDto> {
    return this.notificationCenter.unreadCount(req.user.userId);
  }

  @Post("notifications/:id/read")
  @ApiOperation({ summary: "Mark one notification as read for the current user" })
  @ApiResponse({ status: 200, type: MarkNotificationReadResponseDto })
  markRead(
    @Req() req: AuthenticatedRequest,
    @Param() params: CommonGetByStringIdRequestDto,
  ): Promise<MarkNotificationReadResponseDto> {
    return this.notificationCenter.markRead(req.user.userId, params.id);
  }

  @Post("notifications/read-all")
  @ApiOperation({ summary: "Mark every visible notification as read for the current user" })
  @ApiResponse({ status: 200, type: MarkAllNotificationsReadResponseDto })
  markAllRead(@Req() req: AuthenticatedRequest): Promise<MarkAllNotificationsReadResponseDto> {
    return this.notificationCenter.markAllRead(req.user.userId);
  }

  // --- Per-notification settings -------------------------------------------

  @Get("notification-settings")
  @ApiOperation({ summary: "List registered notifications with their runtime settings" })
  @ApiResponse({ status: 200, type: [NotificationSettingDto] })
  listSettings(): Promise<NotificationSettingDto[]> {
    return this.notificationSettings.listSettings() as unknown as Promise<NotificationSettingDto[]>;
  }

  @Put("notification-settings/:key")
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
  @ApiOperation({ summary: "Get notification-center settings" })
  @ApiResponse({ status: 200, type: NotificationCenterSettingDto })
  getCenterSettings(): Promise<NotificationCenterSettingDto> {
    return this.notificationCenter.getCenterSettings();
  }

  @Put("notification-center-setting")
  @ApiOperation({ summary: "Update notification-center settings" })
  @ApiResponse({ status: 200, type: NotificationCenterSettingDto })
  updateCenterSettings(@Body() body: UpdateNotificationCenterSettingDto): Promise<NotificationCenterSettingDto> {
    return this.notificationCenter.updateCenterSettings(body ?? {});
  }

  @Post("notification-center-setting/test-push")
  @ApiOperation({ summary: "Send a test message to the host-configured system chats" })
  @ApiResponse({ status: 200, type: TestPushResultDto })
  testPush(): Promise<TestPushResultDto> {
    return this.notificationCenter.testPush();
  }
}
