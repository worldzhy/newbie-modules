import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from "class-validator";

// ---------------------------------------------------------------------------
// host integration API DTOs (host side; the host may also inject the service
// directly instead of going over HTTP)
// ---------------------------------------------------------------------------

export class CreateHealthInstallationDto {
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

export class ListHealthInstallationsQueryDto {
  @ApiPropertyOptional({ description: "Filter by host-owned externalRef" })
  @IsOptional()
  @IsString()
  externalRef?: string;
}

// ---------------------------------------------------------------------------
// instance snapshot API DTOs (token-only, X-Health-Token)
// ---------------------------------------------------------------------------

export class HealthSnapshotDto {
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

  // Aggregated check status: "ok" = all indicators up, "error" = at least one down.
  @ApiProperty({ description: "Aggregated status: ok | error" })
  @IsString()
  @IsNotEmpty()
  status: string;

  // Per-indicator results, keyed by indicator name (e.g. "prisma", "mongo").
  // Each entry has status ("up" | "down") and an optional message.
  @ApiProperty({
    description: "Per-indicator results, keyed by indicator name",
    type: "object",
    additionalProperties: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["up", "down"] },
        message: { type: "string" },
      },
    },
  })
  @IsObject()
  info: Record<string, { status: string; message?: string }>;
}

export class HealthSnapshotResponseDto {
  @ApiProperty()
  serverTime: Date;

  // Requested snapshot interval (seconds). v1 fixed 30; reserved for server-side
  // throttling without a client upgrade.
  @ApiProperty()
  reportIntervalSeconds: number;
}
