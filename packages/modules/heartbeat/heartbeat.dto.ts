import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

// ---------------------------------------------------------------------------
// host integration API DTOs (host side; the host may also inject the service
// directly instead of going over HTTP)
// ---------------------------------------------------------------------------

export class CreateHeartbeatInstallationDto {
  @ApiProperty({ description: 'Human-readable label, e.g. "nightwatch-prod"' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  label: string;

  @ApiPropertyOptional({ description: "Opaque host-owned tag (e.g. projectId/applicationId); never parsed here" })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalRef?: string;
}

export class ListHeartbeatInstallationsQueryDto {
  @ApiPropertyOptional({ description: "Filter by host-owned externalRef" })
  @IsOptional()
  @IsString()
  externalRef?: string;
}

// ---------------------------------------------------------------------------
// instance ping API DTOs (token-only, X-Heartbeat-Token)
// ---------------------------------------------------------------------------

export class HeartbeatPingDto {
  // Deployed application version (git sha / semver), self-reported.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  appVersion?: string;

  // Self-reported deployment environment, e.g. "prod".
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  env?: string;

  // Self-reported instance identifier (EC2 instance id, hostname, ...).
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  instanceId?: string;
}

export class HeartbeatPingResponseDto {
  @ApiProperty()
  serverTime: Date;

  // Requested ping interval (seconds). v1 fixed 30; reserved for server-side
  // throttling without a client upgrade.
  @ApiProperty()
  reportIntervalSeconds: number;
}
