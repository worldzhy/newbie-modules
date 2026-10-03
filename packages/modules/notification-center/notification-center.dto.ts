import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID } from "class-validator";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";
import { SEVERITIES } from "./notification-center.constants";

// ---------------------------------------------------------------------------
// Notification record DTOs
// ---------------------------------------------------------------------------

export class NotificationRecordDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: "Key of the notification this record was produced from" })
  notificationKey: string;

  @ApiProperty({ enum: SEVERITIES })
  severity: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  detail: string | null;

  @ApiProperty({
    type: Object,
    required: false,
    nullable: true,
    description: "Context values passed to notify(), preserved for detail panels",
  })
  payload: Record<string, unknown> | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  deduplicationKey: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  projectId: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  link: string | null;

  @ApiProperty({ description: "Read state for the requesting user" })
  read: boolean;

  @ApiProperty()
  createdAt: Date;
}

export class NotifyDto {
  @ApiProperty({ description: "Key of a registered notification" })
  @IsString()
  notificationKey: string;

  @ApiProperty({ type: Object, required: false, description: "Values interpolated into the notification templates" })
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;

  @ApiProperty({ enum: SEVERITIES, required: false, description: "Override the notification default severity" })
  @IsOptional()
  @IsString()
  @IsIn(SEVERITIES as unknown as string[])
  severity?: string;

  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  link?: string;

  @ApiProperty({ type: String, required: false, description: "Optional idempotency key" })
  @IsOptional()
  @IsString()
  deduplicationKey?: string;
}

export class NotifyResultDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: "True when the deduplication key already existed" })
  deduplicated: boolean;

  @ApiProperty({ description: "True when the delivery was dropped (below minimum severity)" })
  dropped: boolean;
}

export class ListNotificationsRequestDto extends CommonListRequestDto {
  @ApiProperty({ type: String, required: false, description: "Pass 'true' to return only unread notifications" })
  @IsOptional()
  @IsString()
  unreadOnly?: string;
}

export class ListNotificationsResponseDto extends CommonListResponseDto {
  @ApiProperty({ type: [NotificationRecordDto] })
  declare records: NotificationRecordDto[];
}

export class UnreadCountResponseDto {
  @ApiProperty()
  count: number;
}

export class MarkNotificationReadResponseDto {
  @ApiProperty()
  read: boolean;
}

export class MarkAllNotificationsReadResponseDto {
  @ApiProperty({ description: "Number of notifications marked as read" })
  marked: number;
}

// ---------------------------------------------------------------------------
// Per-notification setting DTOs
// ---------------------------------------------------------------------------

export class NotificationSettingDto {
  @ApiProperty()
  key: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  titleTemplate: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  detailTemplate: string | null;

  @ApiProperty({ enum: SEVERITIES })
  defaultSeverity: string;

  @ApiProperty()
  pushEnabled: boolean;

  @ApiProperty({ type: String, required: false, nullable: true })
  channelGroupId: string | null;

  @ApiProperty({
    type: [String],
    description:
      "Explicit push channels for this notification. When non-empty, delivery goes to these channels directly, bypassing the notification group and the center default group.",
  })
  channelIds: string[];
}

export class UpdateNotificationSettingDto {
  @ApiProperty({ required: false, enum: SEVERITIES })
  @IsOptional()
  @IsString()
  @IsIn(SEVERITIES as unknown as string[])
  defaultSeverity?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @ApiProperty({ required: false, nullable: true, type: String })
  @IsOptional()
  @IsString()
  channelGroupId?: string | null;

  @ApiProperty({
    type: [String],
    required: false,
    description: "Full-replace list of explicit channel ids; pass an empty array to clear",
  })
  @IsOptional()
  @IsArray()
  @IsUUID(4, { each: true })
  channelIds?: string[];
}

// ---------------------------------------------------------------------------
// Center settings DTOs
// ---------------------------------------------------------------------------

export class NotificationCenterSettingDto {
  @ApiProperty()
  inAppEnabled: boolean;

  @ApiProperty({ description: "Master switch for Lark/Slack push via message-bot" })
  pushEnabled: boolean;

  @ApiProperty({ enum: SEVERITIES })
  minimumSeverity: string;

  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    description: "Default message-bot channel group for notifications without their own",
  })
  channelGroupId: string | null;

  @ApiProperty({ required: false, type: Number, nullable: true })
  availableChannelCount: number | null;
}

export class UpdateNotificationCenterSettingDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  inAppEnabled?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @ApiProperty({ required: false, enum: SEVERITIES })
  @IsOptional()
  @IsString()
  @IsIn(SEVERITIES as unknown as string[])
  minimumSeverity?: string;

  @ApiProperty({ required: false, nullable: true, type: String })
  @IsOptional()
  @IsString()
  channelGroupId?: string | null;
}

export class TestPushResultDto {
  @ApiProperty({ description: "Number of channels that accepted the test message" })
  succeeded: number;

  @ApiProperty({ description: "Number of channels that rejected the test message" })
  failed: number;
}
