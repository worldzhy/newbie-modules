import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Allow,
  MaxLength,
} from "class-validator";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";
import {
  DELIVERY_DECISION_REASONS,
  DELIVERY_RULE_ACTIONS,
  DELIVERY_RUNTIME_REASONS,
  NOTIFICATION_SCOPES,
  SEVERITIES,
} from "./notification-center.constants";

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

  @ApiProperty({ enum: ["firing", "recovered"], description: "Alert lifecycle phase (ADR-051)" })
  status!: string;

  @ApiProperty({ type: Date, required: false, nullable: true, description: "Recovery timestamp for recovered alerts" })
  recoveredAt!: Date | null;

  @ApiProperty({ description: "Read state for the requesting user" })
  read!: boolean;

  @ApiProperty()
  createdAt!: Date;
}

export class NotifyDto {
  @ApiProperty({ description: "Key of a registered notification", maxLength: 100 })
  @IsString()
  @MaxLength(100)
  notificationKey!: string;

  @ApiPropertyOptional({ type: Object, description: "Values interpolated into the notification templates" })
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: SEVERITIES, description: "Override the notification default severity" })
  @IsOptional()
  @IsIn(SEVERITIES as unknown as string[])
  severity?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ type: String, maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  link?: string;

  @ApiPropertyOptional({ type: String, description: "Optional idempotency key", maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deduplicationKey?: string;

  @ApiPropertyOptional({
    type: String,
    description: "Pairing key for one alert lifecycle (ADR-064); a firing and its recovery must pass the same value",
  })
  @IsOptional()
  @IsString()
  alertKey?: string;

  @ApiPropertyOptional({
    enum: ["firing", "recovered"],
    description: "Alert lifecycle phase (ADR-051); defaults to firing",
  })
  @IsOptional()
  @IsIn(["firing", "recovered"])
  status?: "firing" | "recovered";

  @ApiPropertyOptional({
    type: String,
    format: "date-time",
    description: "Recovery timestamp for recovered events; defaults to now",
  })
  @IsOptional()
  @IsDateString()
  recoveredAt?: string;
}

export class NotifyResultDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: "True when the deduplication key already existed" })
  deduplicated!: boolean;

  @ApiProperty({ enum: DELIVERY_RULE_ACTIONS, description: "Delivery verdict of the alert this event belongs to" })
  decision!: string;

  @ApiProperty({
    enum: DELIVERY_DECISION_REASONS,
    nullable: true,
    description: "Why the verdict came out that way; null for verdicts frozen before the reason was recorded",
  })
  reason!: string | null;

  @ApiProperty({
    enum: DELIVERY_RUNTIME_REASONS,
    nullable: true,
    description: "Real-time interception that kept a deliverable notification in-app (ADR-063)",
  })
  runtimeReason!: string | null;
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
}

export class UpdateNotificationCenterSettingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPushEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Delivery rule DTOs (ADR-062)
// ---------------------------------------------------------------------------

export class DeliveryConditionDto {
  @ApiPropertyOptional({ enum: ["firing", "recovered"], description: "Lifecycle phase the rule applies to" })
  @IsOptional()
  @IsIn(["firing", "recovered"])
  phase?: string;

  @ApiPropertyOptional({ enum: SEVERITIES, description: "Minimum severity label the event must carry" })
  @IsOptional()
  @IsString()
  @IsIn(SEVERITIES as unknown as string[])
  severityAtLeast?: string;

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    description: "Notification keys the rule applies to; an empty array never matches",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  notificationKeys?: string[];

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    description: "Project ids the rule applies to; an empty array never matches",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  projectIds?: string[];

  @ApiPropertyOptional({ type: Object, description: "Tag key/value pairs the event must carry" })
  @IsOptional()
  @IsObject()
  tags?: Record<string, string>;
}

export class DeliveryRuleDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: "Ascending evaluation order; lower runs first. The UI shows the row order instead." })
  priority!: number;

  @ApiProperty({ type: () => DeliveryConditionDto })
  condition!: DeliveryConditionDto;

  @ApiProperty({ enum: DELIVERY_RULE_ACTIONS })
  action!: string;

  @ApiProperty()
  isEnabled!: boolean;

  @ApiProperty()
  updatedAt!: Date;
}

export class CreateDeliveryRuleDto {
  @ApiProperty({ type: () => DeliveryConditionDto })
  @IsObject()
  condition!: DeliveryConditionDto;

  @ApiProperty({ enum: DELIVERY_RULE_ACTIONS })
  @IsString()
  @IsIn(DELIVERY_RULE_ACTIONS as unknown as string[])
  action!: string;

  @ApiPropertyOptional({ description: "Defaults to true" })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class UpdateDeliveryRuleDto {
  @ApiPropertyOptional({ type: () => DeliveryConditionDto })
  @IsOptional()
  @IsObject()
  condition?: DeliveryConditionDto;

  @ApiPropertyOptional({ enum: DELIVERY_RULE_ACTIONS })
  @IsOptional()
  @IsString()
  @IsIn(DELIVERY_RULE_ACTIONS as unknown as string[])
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class ReorderDeliveryRulesDto {
  @ApiProperty({
    type: String,
    isArray: true,
    description: "Every rule id exactly once, in the new evaluation order",
  })
  @IsArray()
  @IsUUID(undefined, { each: true })
  ids!: string[];
}

export class SimulateDeliveryRequestDto {
  @ApiPropertyOptional({ description: "Replay a persisted notification record" })
  @IsOptional()
  @IsUUID()
  recordId?: string;

  @ApiPropertyOptional({ description: "Manual mode: notification key to evaluate" })
  @IsOptional()
  @IsString()
  notificationKey?: string;

  @ApiPropertyOptional({ enum: SEVERITIES, description: "Manual mode: severity label to evaluate" })
  @IsOptional()
  @IsString()
  @IsIn(SEVERITIES as unknown as string[])
  severity?: string;

  @ApiPropertyOptional({ enum: ["firing", "recovered"], description: "Manual mode: defaults to firing" })
  @IsOptional()
  @IsIn(["firing", "recovered"])
  phase?: string;

  @ApiPropertyOptional({ description: "Manual mode: project id to evaluate" })
  @IsOptional()
  @IsUUID()
  projectId?: string;
}

export class DeliveryLabelsDto {
  @ApiProperty({ enum: ["firing", "recovered"] })
  phase!: string;

  @ApiProperty({ enum: SEVERITIES })
  severity!: string;

  @ApiProperty()
  notificationKey!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  projectId?: string;
}

export class SimulateDeliveryResultDto {
  @ApiProperty({ type: () => DeliveryLabelsDto, description: "Labels the rules were evaluated against" })
  labels!: DeliveryLabelsDto;

  @ApiProperty({ enum: DELIVERY_RULE_ACTIONS })
  decision!: string;

  @ApiProperty({ enum: DELIVERY_DECISION_REASONS, nullable: true })
  reason!: string | null;

  @ApiProperty({ type: String, nullable: true, description: "Rule that decided; null when nothing matched" })
  matchedRuleId!: string | null;

  @ApiProperty({ type: Number, nullable: true, description: "1-based position of the deciding rule" })
  matchedRuleIndex!: number | null;

  @ApiProperty({ description: "Number of enabled rules evaluated" })
  ruleCount!: number;

  @ApiProperty({
    enum: DELIVERY_RUNTIME_REASONS,
    nullable: true,
    description: "Real-time interception found while replaying; today the simulator evaluates active silences",
  })
  runtimeReason!: string | null;

  @ApiProperty({ type: String, nullable: true, description: "Silence that would intercept; null when none is active" })
  silenceId!: string | null;

  @ApiProperty({ description: "Final outcome: the rules deliver and no real-time interception applies" })
  delivered!: boolean;
}

export class NotificationDeliveryAttemptDto {
  @ApiProperty({ enum: DELIVERY_RULE_ACTIONS })
  decision!: string;

  @ApiProperty({ enum: DELIVERY_DECISION_REASONS, nullable: true })
  reason!: string | null;

  @ApiProperty({ type: String, nullable: true, description: "Rule that decided; null when nothing matched" })
  ruleId!: string | null;

  @ApiProperty({ enum: DELIVERY_RUNTIME_REASONS, nullable: true })
  runtimeReason!: string | null;

  @ApiProperty({ type: String, nullable: true, description: "Silence that intercepted; null unless silenced" })
  silenceId!: string | null;

  @ApiProperty()
  createdAt!: Date;
}

// ---------------------------------------------------------------------------
// Silence DTOs (ADR-063)
// ---------------------------------------------------------------------------

export class SilenceDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: () => DeliveryConditionDto, description: "Matchers; an empty object silences everything" })
  condition!: DeliveryConditionDto;

  @ApiProperty({ type: Date })
  startsAt!: Date;

  @ApiProperty({ type: Date })
  endsAt!: Date;

  @ApiProperty({ type: String, required: false, nullable: true })
  comment!: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  createdBy!: string | null;

  @ApiProperty({ description: "True while startsAt <= now < endsAt" })
  isActive!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class CreateSilenceDto {
  @ApiPropertyOptional({
    type: () => DeliveryConditionDto,
    description: "Matchers reused from delivery rules; omitted means silence everything",
  })
  @IsOptional()
  @IsObject()
  condition?: DeliveryConditionDto;

  @ApiPropertyOptional({ type: String, format: "date-time", description: "Defaults to now" })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiProperty({ type: String, format: "date-time" })
  @IsDateString()
  endsAt!: string;

  @ApiPropertyOptional({ type: String, maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  comment?: string;
}

export class UpdateSilenceDto {
  @ApiPropertyOptional({ type: () => DeliveryConditionDto })
  @IsOptional()
  @IsObject()
  condition?: DeliveryConditionDto;

  @ApiPropertyOptional({ type: String, format: "date-time" })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({ type: String, format: "date-time" })
  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @ApiPropertyOptional({ type: String, maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  comment?: string;
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
