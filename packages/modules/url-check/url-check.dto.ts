import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

// --- Request DTOs ---

export class ListUrlCheckTargetsRequestDto {
  @ApiProperty({ description: "Owning project ID" })
  @IsUUID()
  projectId!: string;
}

export class CreateUrlCheckTargetDto {
  @ApiProperty({ description: "Owning project ID" })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ description: "Display name of the monitored target" })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiProperty({ description: "URL to probe; http(s) only, redirects are followed" })
  @IsNotEmpty()
  @IsString()
  @MaxLength(2048)
  url!: string;
}

export class UrlCheckTargetStatsRequestDto {
  @ApiPropertyOptional({
    enum: ["24h", "7d", "30d"],
    description: "Stats window ending now; defaults to 24h",
  })
  @IsOptional()
  @IsIn(["24h", "7d", "30d"])
  window?: "24h" | "7d" | "30d";
}

export class UpdateUrlCheckTargetDto {
  @ApiPropertyOptional({ description: "Display name of the monitored target" })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: "URL to probe; http(s) only, redirects are followed" })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional({ description: "Whether the target is probed on the schedule" })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// --- Response DTOs (validation decorators apply to inbound payloads only) ---

export class UrlCheckTargetDto {
  @ApiProperty({ description: "Target ID (uuid)" })
  id!: string;

  @ApiProperty({ description: "Owning project ID" })
  projectId!: string;

  @ApiProperty({ description: "Display name of the monitored target" })
  name!: string;

  @ApiProperty({ description: "Probed URL" })
  url!: string;

  @ApiProperty({ description: "Whether the target is probed on the schedule" })
  isActive!: boolean;

  @ApiProperty({ description: "Consecutive failed checks since the last success" })
  consecutiveFailures!: number;

  @ApiProperty({ description: "Whether an outage alert is currently open" })
  isAlertOpen!: boolean;

  @ApiProperty({ description: "When the open outage alert fired", type: Date, nullable: true })
  alertOpenedAt!: Date | null;

  @ApiProperty({ description: "When the target was last probed", type: Date, nullable: true })
  lastCheckedAt!: Date | null;

  @ApiProperty({
    description: "HTTP status of the last probe; null on network-level failure",
    type: Number,
    nullable: true,
  })
  lastStatusCode!: number | null;

  @ApiProperty({ description: "Whether the last probe considered the URL up", type: Boolean, nullable: true })
  lastIsUp!: boolean | null;

  @ApiProperty({ type: Date, description: "Creation timestamp (ISO after serialization)" })
  createdAt!: Date;

  @ApiProperty({ type: Date, description: "Last update timestamp (ISO after serialization)" })
  updatedAt!: Date;
}

export class UrlCheckIncidentDto {
  @ApiProperty({ description: "Incident ID (uuid)" })
  id!: string;

  @ApiProperty({ description: "Monitored target ID" })
  targetId!: string;

  @ApiProperty({ description: "When the outage alert opened", type: Date })
  openedAt!: Date;

  @ApiProperty({
    description: "When the target recovered; null while the outage is ongoing",
    type: Date,
    nullable: true,
  })
  recoveredAt!: Date | null;

  @ApiProperty({ description: "Outage length in milliseconds; null while ongoing", type: Number, nullable: true })
  durationMs!: number | null;

  @ApiProperty({ description: "Peak consecutive failures observed during the incident" })
  peakConsecutiveFailures!: number;

  @ApiProperty({ type: Date, description: "Creation timestamp (ISO after serialization)" })
  createdAt!: Date;

  @ApiProperty({ type: Date, description: "Last update timestamp (ISO after serialization)" })
  updatedAt!: Date;
}

export class UrlCheckResultDto {
  @ApiProperty({ description: "Whether the probe considered the URL up" })
  isUp!: boolean;

  @ApiProperty({ description: "HTTP status; null on network-level failure", type: Number, nullable: true })
  statusCode!: number | null;

  @ApiProperty({ description: "Probe round-trip time in milliseconds" })
  durationMs!: number;

  @ApiProperty({ description: "Failure detail; empty on success and on HTTP >= 400" })
  error!: string;

  @ApiProperty({ description: "When the probe ran (ISO)", type: Date })
  checkedAt!: Date;
}

export class DeleteUrlCheckTargetResponseDto {
  @ApiProperty({ description: "Always true when deletion succeeds" })
  success!: boolean;
}

export class UrlCheckLatencyBucketDto {
  @ApiProperty({ description: "Bucket start as unix seconds (UTC)" })
  bucketStart!: number;

  @ApiProperty({ description: "Probe executions in the bucket" })
  totalChecks!: number;

  @ApiProperty({ description: "Successful probes in the bucket" })
  upChecks!: number;

  @ApiProperty({
    description: "Mean round-trip of successful probes in ms; null when the bucket has no successful probe",
    type: Number,
    nullable: true,
  })
  avgDurationMs!: number | null;

  @ApiProperty({
    description: "p50 round-trip of successful probes in ms; null when the bucket has no successful probe",
    type: Number,
    nullable: true,
  })
  p50DurationMs!: number | null;

  @ApiProperty({
    description: "p95 round-trip of successful probes in ms; null when the bucket has no successful probe",
    type: Number,
    nullable: true,
  })
  p95DurationMs!: number | null;

  @ApiProperty({
    description: "p99 round-trip of successful probes in ms; null when the bucket has no successful probe",
    type: Number,
    nullable: true,
  })
  p99DurationMs!: number | null;
}

export class UrlCheckTargetStatsDto {
  @ApiProperty({ enum: ["24h", "7d", "30d"], description: "Window the stats cover, ending now" })
  window!: "24h" | "7d" | "30d";

  @ApiProperty({ description: "Probe executions in the window" })
  totalChecks!: number;

  @ApiProperty({ description: "Successful probes in the window" })
  upChecks!: number;

  @ApiProperty({
    description: "upChecks / totalChecks over the window; null when no probe ran",
    type: Number,
    nullable: true,
  })
  availability!: number | null;

  @ApiProperty({ description: "Incidents that closed (recovered) in the window" })
  closedIncidents!: number;

  @ApiProperty({
    description: "Mean outage duration in ms across incidents closed in the window; null when none closed",
    type: Number,
    nullable: true,
  })
  mttrMs!: number | null;

  @ApiProperty({
    description: "Per-bucket probe counts and latency percentiles, oldest first",
    type: UrlCheckLatencyBucketDto,
    isArray: true,
  })
  latency!: UrlCheckLatencyBucketDto[];
}
