import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, IsUUID, Allow } from "class-validator";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";
import { NOTIFICATION_SCOPES, SEVERITIES } from "./notification-center.constants";

// ---------------------------------------------------------------------------
// Notification record DTOs
// ---------------------------------------------------------------------------

export class NotificationRecordDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: "Key of the notification this record was produced from" })
  notificationKey!: string;

  @ApiProperty({ enum: SEVERITIES })
  severity!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  detail!: string | null;

  @ApiProperty({
    type: Object,
    required: false,
    nullable: true,
    description: "Context values passed to notify(), preserved for detail panels",
  })
  payload!: Record<string, unknown> | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  deduplicationKey!: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  projectId!: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  link!: string | null;

  @ApiProperty({ description: "Read state for the requesting user" })
  read!: boolean;

  @ApiProperty()
  createdAt!: Date;
}

export class NotifyDto {
  @ApiProperty({ description: "Key of a registered notification" })
  @IsString()
  notificationKey!: string;

  @ApiPropertyOptional({ type: Object, description: "Values interpolated into the notification templates" })
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: SEVERITIES, description: "Override the notification default severity" })
  @IsOptional()
  @IsString()
  @IsIn(SEVERITIES as unknown as string[])
  severity?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  link?: string;

  @ApiPropertyOptional({ type: String, description: "Optional idempotency key" })
  @IsOptional()
  @IsString()
  deduplicationKey?: string;
}

export class NotifyResultDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: "True when the deduplication key already existed" })
  deduplicated!: boolean;

  @ApiProperty({ description: "True when the delivery was dropped (below minimum severity)" })
  dropped!: boolean;
}

export class ListNotificationsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ type: String, description: "Pass 'true' to return only unread notifications" })
  @IsOptional()
  @IsString()
  unreadOnly?: string;

  @ApiPropertyOptional({ enum: SEVERITIES, description: "Filter by resolved severity" })
  @IsOptional()
  @IsString()
  @IsIn(SEVERITIES as unknown as string[])
  severity?: string;

  @ApiPropertyOptional({
    type: String,
    description: "Comma-separated notification keys to filter by, e.g. 'heartbeat.offline,job.run-failed'",
  })
  @IsOptional()
  @IsString()
  notificationKeys?: string;

  @ApiPropertyOptional({ type: String, description: "Filter by scoped project id (UUID)" })
  @IsOptional()
  @IsString()
  @IsUUID()
  projectId?: string;
}

export class ListNotificationsResponseDto extends CommonListResponseDto {
  @ApiProperty({ type: NotificationRecordDto, isArray: true })
  declare records: NotificationRecordDto[];
}

export class UnreadCountResponseDto {
  @ApiProperty()
  count!: number;
}

export class MarkNotificationReadResponseDto {
  @ApiProperty()
  read!: boolean;
}

export class MarkAllNotificationsReadResponseDto {
  @ApiProperty({ description: "Number of notifications marked as read" })
  marked!: number;
}

// ---------------------------------------------------------------------------
// Per-notification setting DTOs
// ---------------------------------------------------------------------------

export class NotificationSettingDto {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  titleTemplate!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  detailTemplate!: string | null;

  @ApiProperty({ enum: SEVERITIES })
  defaultSeverity!: string;

  @ApiProperty()
  isPushEnabled!: boolean;

  @ApiProperty({
    enum: NOTIFICATION_SCOPES,
    description:
      "Delivery scope: system notifications push through the host-configured system chats; project notifications are routed to the owning project's bound chats by the host.",
  })
  scope!: string;
}

export class UpdateNotificationSettingDto {
  @ApiPropertyOptional({ enum: SEVERITIES })
  @IsOptional()
  @IsString()
  @IsIn(SEVERITIES as unknown as string[])
  defaultSeverity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPushEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Center settings DTOs
// ---------------------------------------------------------------------------

export class NotificationCenterSettingDto {
  @ApiProperty({ description: "Master switch for chat push through the host-provided push adapter" })
  isPushEnabled!: boolean;

  @ApiProperty({ enum: SEVERITIES })
  minimumSeverity!: string;
}

export class UpdateNotificationCenterSettingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPushEnabled?: boolean;

  @ApiPropertyOptional({ enum: SEVERITIES })
  @IsOptional()
  @IsString()
  @IsIn(SEVERITIES as unknown as string[])
  minimumSeverity?: string;
}

export class PushDeliveryResultDto {
  @ApiProperty({ description: "Opaque recipient key, e.g. lark:group:oc_xxx" })
  @IsString()
  recipientKey!: string;

  @ApiProperty({ description: "True when the push succeeded" })
  @IsBoolean()
  success!: boolean;

  @ApiPropertyOptional({ description: "Provider error message when the push failed" })
  @IsOptional()
  @IsString()
  error?: string;
}

export class TestPushResultDto {
  @ApiProperty({ description: "Number of system chats that accepted the test message" })
  @IsNumber()
  succeeded!: number;

  @ApiProperty({ description: "Number of system chats that rejected the test message" })
  @IsNumber()
  failed!: number;

  @ApiProperty({
    description: "Per-recipient delivery results so the caller can surface specific failures",
    type: "array",
    items: {
      type: "object",
      required: ["recipientKey", "success"],
      properties: {
        recipientKey: { type: "string", description: "Opaque recipient key, e.g. lark:group:oc_xxx" },
        success: { type: "boolean", description: "True when the push succeeded" },
        error: { type: "string", nullable: true, description: "Provider error message when the push failed" },
      },
    },
    isArray: true,
  })
  @Type(() => PushDeliveryResultDto)
  @Allow()
  results!: PushDeliveryResultDto[];
}

// ---------------------------------------------------------------------------
// Push failure DTOs
// ---------------------------------------------------------------------------

export class NotificationPushFailureDto {
  @ApiProperty({ description: "Failure row ID" })
  id!: string;

  @ApiProperty({ type: String, nullable: true, description: "Linked notification record; null on system push track" })
  notificationRecordId!: string | null;

  @ApiProperty({ type: String, nullable: true, description: "Title of the linked notification record" })
  notificationTitle!: string | null;

  @ApiProperty({ description: "Opaque recipient key defined by the host (e.g. lark:group:oc_xxx)" })
  recipientKey!: string;

  @ApiProperty({ description: "Error message from the push adapter" })
  error!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ type: Date, nullable: true, description: "Null when still unresolved" })
  resolvedAt!: Date | null;
}
