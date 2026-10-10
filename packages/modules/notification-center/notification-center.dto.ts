import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID } from "class-validator";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";
import { NOTIFICATION_SCOPES, SEVERITIES } from "./notification-center.constants";

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

  @ApiProperty({ required: false, enum: SEVERITIES, description: "Filter by resolved severity" })
  @IsOptional()
  @IsString()
  @IsIn(SEVERITIES as unknown as string[])
  severity?: string;

  @ApiProperty({
    type: String,
    required: false,
    description: "Comma-separated notification keys to filter by, e.g. 'heartbeat.offline,job.run-failed'",
  })
  @IsOptional()
  @IsString()
  notificationKeys?: string;

  @ApiProperty({ type: String, required: false, description: "Filter by scoped project id (UUID)" })
  @IsOptional()
  @IsString()
  @IsUUID()
  projectId?: string;
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

  @ApiProperty({
    enum: NOTIFICATION_SCOPES,
    description:
      "Delivery scope: system notifications push through the host-configured system chats; project notifications are routed to the owning project's bound chats by the host.",
  })
  scope: string;
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
}

// ---------------------------------------------------------------------------
// Center settings DTOs
// ---------------------------------------------------------------------------

export class NotificationCenterSettingDto {
  @ApiProperty({ description: "Master switch for chat push through the host-provided push adapter" })
  pushEnabled: boolean;

  @ApiProperty({ enum: SEVERITIES })
  minimumSeverity: string;
}

export class UpdateNotificationCenterSettingDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @ApiProperty({ required: false, enum: SEVERITIES })
  @IsOptional()
  @IsString()
  @IsIn(SEVERITIES as unknown as string[])
  minimumSeverity?: string;
}

export class TestPushResultDto {
  @ApiProperty({ description: "Number of system chats that accepted the test message" })
  succeeded: number;

  @ApiProperty({ description: "Number of system chats that rejected the test message" })
  failed: number;
}
