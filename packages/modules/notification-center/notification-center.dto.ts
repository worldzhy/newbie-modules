import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from "class-validator";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";
import { SEVERITIES } from "./notification-center.constants";

// ---------------------------------------------------------------------------
// Payload DTOs (embedded in Notification.payload)
// ---------------------------------------------------------------------------

export class SeverityCountsDto {
  @ApiProperty()
  critical: number;

  @ApiProperty()
  high: number;

  @ApiProperty()
  medium: number;

  @ApiProperty()
  low: number;

  @ApiProperty()
  unknown: number;

  @ApiProperty()
  total: number;
}

export class TopFindingDto {
  @ApiProperty({ enum: SEVERITIES })
  severity: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ required: false, nullable: true })
  service: string | null;

  @ApiProperty({ required: false, nullable: true })
  resourceType: string | null;

  @ApiProperty({ required: false, nullable: true })
  resourceId: string | null;

  @ApiProperty({ required: false, nullable: true })
  ruleId: string | null;

  @ApiProperty({ required: false, nullable: true })
  packageName: string | null;

  @ApiProperty({ required: false, nullable: true })
  packageVersion: string | null;

  @ApiProperty({ required: false, nullable: true })
  vulnId: string | null;

  @ApiProperty({ required: false, nullable: true })
  fixedVersion: string | null;
}

export class SpikeStatsDto {
  @ApiProperty({ description: "New high+ findings in this scan" })
  current: number;

  @ApiProperty({ description: "Average daily new high+ findings over the trailing baseline window" })
  averageDaily: number;

  @ApiProperty({ description: "Threshold the scan reached to be flagged as a spike" })
  threshold: number;
}

export class NotificationPayloadDto {
  @ApiProperty({ type: SeverityCountsDto, description: "New findings first seen in this scan" })
  new: SeverityCountsDto;

  @ApiProperty({ type: SeverityCountsDto, description: "Open findings for the scope after this scan" })
  open: SeverityCountsDto;

  @ApiProperty({ type: [TopFindingDto], description: "Highest-severity new findings, capped at 5" })
  topFindings: TopFindingDto[];

  @ApiProperty({ type: SpikeStatsDto, required: false, nullable: true })
  spike: SpikeStatsDto | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: "Human label of the scan scope (application name for dependency scans)",
  })
  scopeLabel: string | null;
}

// ---------------------------------------------------------------------------
// Notification DTOs
// ---------------------------------------------------------------------------

export class NotificationDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ["security-scan-digest", "security-spike"] })
  type: string;

  @ApiProperty({ enum: SEVERITIES })
  severity: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  detail: string | null;

  @ApiProperty({ type: NotificationPayloadDto, required: false, nullable: true })
  payload: NotificationPayloadDto | null;

  @ApiProperty()
  sourceModule: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  scanId: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  projectId: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  applicationId: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  link: string | null;

  @ApiProperty({ description: "Read state for the requesting user" })
  read: boolean;

  @ApiProperty()
  createdAt: Date;
}

export class ListNotificationsRequestDto extends CommonListRequestDto {
  @ApiProperty({ type: String, required: false, description: "Pass 'true' to return only unread notifications" })
  @IsOptional()
  @IsString()
  unreadOnly?: string;
}

export class ListNotificationsResponseDto extends CommonListResponseDto {
  @ApiProperty({ type: [NotificationDto] })
  declare records: NotificationDto[];
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
// Settings DTOs
// ---------------------------------------------------------------------------

export class NotificationSettingDto {
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
    description: "Id of the message-bot channel group that receives pushes",
  })
  channelGroupId: string | null;

  @ApiProperty()
  spikeEnabled: boolean;

  @ApiProperty({ description: "Absolute minimum new high+ findings that can flag a spike" })
  spikeThreshold: number;

  @ApiProperty({ description: "Trailing days used to compute the daily baseline for spike detection" })
  spikeBaselineDays: number;

  @ApiProperty({ required: false, type: Number, nullable: true })
  availableChannelCount: number | null;
}

export class UpdateNotificationSettingDto {
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

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  spikeEnabled?: boolean;

  @ApiProperty({ required: false, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @IsInt()
  @Min(1)
  @Max(100)
  spikeThreshold?: number;

  @ApiProperty({ required: false, minimum: 1, maximum: 90 })
  @IsOptional()
  @IsNumber()
  @IsInt()
  @Min(1)
  @Max(90)
  spikeBaselineDays?: number;
}

export class TestPushResultDto {
  @ApiProperty({ description: "Number of channels that accepted the test message" })
  succeeded: number;

  @ApiProperty({ description: "Number of channels that rejected the test message" })
  failed: number;
}
