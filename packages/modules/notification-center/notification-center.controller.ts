import { Body, Controller, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CommonGetByStringIdRequestDto } from "@devbie/newbie/common.dto";
import { NotificationCenterService } from "./notification-center.service";
import {
  ListNotificationsRequestDto,
  ListNotificationsResponseDto,
  MarkAllNotificationsReadResponseDto,
  MarkNotificationReadResponseDto,
  NotificationSettingDto,
  TestPushResultDto,
  UnreadCountResponseDto,
  UpdateNotificationSettingDto,
} from "./notification-center.dto";

interface AuthenticatedRequest {
  user: { userId: string };
}

@ApiTags("Notification Center")
@ApiBearerAuth()
@Controller()
export class NotificationCenterController {
  constructor(private readonly notificationCenter: NotificationCenterService) {}

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

  @Get("notification-settings")
  @ApiOperation({ summary: "Get platform notification settings" })
  @ApiResponse({ status: 200, type: NotificationSettingDto })
  getSettings(): Promise<NotificationSettingDto> {
    return this.notificationCenter.getSettings();
  }

  @Put("notification-settings")
  @ApiOperation({ summary: "Update platform notification settings" })
  @ApiResponse({ status: 200, type: NotificationSettingDto })
  updateSettings(@Body() body: UpdateNotificationSettingDto): Promise<NotificationSettingDto> {
    return this.notificationCenter.updateSettings(body ?? {});
  }

  @Post("notification-settings/test-push")
  @ApiOperation({ summary: "Send a test message to the configured push channel group" })
  @ApiResponse({ status: 200, type: TestPushResultDto })
  testPush(): Promise<TestPushResultDto> {
    return this.notificationCenter.testPush();
  }
}
