import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from "class-validator";
import { ALERT_SEVERITIES, ALERT_STATES } from "./alert-center.constants";

export class RaiseAlertDto {
  @ApiProperty({ description: "Registered alert source key", maxLength: 100 })
  @IsString()
  @MaxLength(100)
  source!: string;

  @ApiProperty({ description: "Stable key of one alert inside the source", maxLength: 255 })
  @IsString()
  @MaxLength(255)
  alertKey!: string;

  @ApiPropertyOptional({ description: "Opaque scope id (project / tenant / platform)" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  scopeId?: string;

  @ApiProperty({ enum: ALERT_SEVERITIES, description: "Alert severity; validated against the fixed vocabulary" })
  @IsString()
  @IsIn(ALERT_SEVERITIES as unknown as string[])
  severity!: string;

  @ApiPropertyOptional({ type: Object, description: "Notification routing and display labels" })
  @IsOptional()
  @IsObject()
  labels?: Record<string, string>;

  @ApiPropertyOptional({ type: Object, description: "Opaque rendering context (url, error text, counts)" })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @ApiPropertyOptional({ description: "Overrides the source reminder rhythm for this lifecycle", minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  repeatIntervalMinutes?: number;
}

export class ResolveAlertDto {
  @ApiProperty({ description: "Registered alert source key", maxLength: 100 })
  @IsString()
  @MaxLength(100)
  source!: string;

  @ApiProperty({ description: "Stable key of one alert inside the source", maxLength: 255 })
  @IsString()
  @MaxLength(255)
  alertKey!: string;

  @ApiPropertyOptional({ description: "Opaque scope id (project / tenant / platform)" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  scopeId?: string;

  @ApiPropertyOptional({ type: String, format: "date-time", description: "Recovery time; defaults to now" })
  @IsOptional()
  @IsDateString()
  resolvedAt?: string;
}

export class RaiseAlertResultDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ALERT_STATES })
  state!: string;

  @ApiProperty({ description: "True when this call opened a new lifecycle" })
  isNew!: boolean;
}

export class ResolveAlertResultDto {
  @ApiProperty({ type: String, nullable: true, description: "Null when no alert existed for the key" })
  id!: string | null;
}

export class AlertDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  source!: string;

  @ApiProperty({ type: String, nullable: true })
  scopeId!: string | null;

  @ApiProperty({ enum: ALERT_SEVERITIES })
  severity!: string;

  @ApiProperty({ type: Object, description: "Notification routing and display labels" })
  labels!: Record<string, string>;

  @ApiProperty({ type: Object, nullable: true, description: "Opaque rendering context" })
  data!: Record<string, unknown> | null;

  @ApiProperty({ enum: ALERT_STATES })
  state!: string;

  @ApiProperty({ description: "Reminder rhythm of this lifecycle, in minutes" })
  repeatIntervalMinutes!: number;

  @ApiProperty({ type: Date, nullable: true, description: "Next due reminder; null once resolved" })
  nextNotificationAt!: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  lastNotificationAt!: Date | null;

  @ApiProperty({ description: "How many reminders were sent for this lifecycle" })
  reminderCount!: number;

  @ApiProperty({ description: "Start of the current lifecycle" })
  firstSeenAt!: Date;

  @ApiProperty({ description: "Last report of this alert" })
  lastSeenAt!: Date;

  @ApiProperty({ type: Date, nullable: true })
  resolvedAt!: Date | null;

  @ApiProperty({ description: "Reports seen during this lifecycle" })
  occurrences!: number;

  @ApiProperty()
  createdAt!: Date;
}

export class ListAlertsRequestDto {
  @ApiPropertyOptional({ enum: ALERT_STATES, description: "Only alerts in this state" })
  @IsOptional()
  @IsString()
  @IsIn(ALERT_STATES as unknown as string[])
  state?: string;

  @ApiPropertyOptional({ description: "Only alerts of this source" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  source?: string;

  @ApiPropertyOptional({ description: "Only alerts of this scope" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  scopeId?: string;

  @ApiPropertyOptional({ description: "Id of the last alert of the previous page" })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: "Page size; defaults to 50, at most 200", minimum: 1, maximum: 200 })
  @IsOptional()
  // Query parameters arrive as strings; without the transform every request
  // carrying `limit` would be rejected by @IsInt.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class ListAlertsResponseDto {
  @ApiProperty({ type: () => AlertDto, isArray: true })
  records!: AlertDto[];

  @ApiProperty({ type: String, nullable: true, description: "Cursor of the next page; null on the last page" })
  nextCursor!: string | null;
}

export class AlertSourceDto {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ description: "Rhythm declared in code" })
  defaultRepeatMinutes!: number;

  @ApiProperty({ type: Number, nullable: true, description: "Operator override; null inherits the declaration" })
  repeatMinutes!: number | null;

  @ApiProperty({ description: "Rhythm actually used when an alert opens or reopens" })
  effectiveRepeatMinutes!: number;

  @ApiProperty({
    type: Date,
    nullable: true,
    description: "External delivery is paused until this moment; null when not paused",
  })
  notificationPausedUntil!: Date | null;
}

export class UpdateAlertSourceDto {
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 1,
    description: "Override the rhythm; null clears the override",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  repeatMinutes?: number | null;

  @ApiPropertyOptional({
    type: String,
    format: "date-time",
    nullable: true,
    description: "Pause external delivery until this moment; null resumes it",
  })
  @IsOptional()
  @IsDateString()
  notificationPausedUntil?: string | null;
}
