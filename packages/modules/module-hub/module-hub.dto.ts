import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min, ValidateIf } from "class-validator";

// ---------------------------------------------------------------------------
// host integration API DTOs (hub side; the host may also inject the services
// directly instead of going over HTTP)
// ---------------------------------------------------------------------------

export class CreateHubInstallationDto {
  @ApiProperty({ description: 'Human-readable label, e.g. "nightwatch-prod"' })
  @IsString()
  label: string;

  @ApiPropertyOptional({ description: "Source repository URL of the installation" })
  @IsOptional()
  @IsString()
  repoUrl?: string;

  @ApiPropertyOptional({ description: "Opaque host-owned tag (e.g. projectId/applicationId); hub never parses it" })
  @IsOptional()
  @IsString()
  externalRef?: string;

  @ApiPropertyOptional({ description: "Host actor identifier recorded in the audit log" })
  @IsOptional()
  @IsString()
  actor?: string;
}

export class ListHubInstallationsQueryDto {
  @ApiPropertyOptional({ description: "Filter by host-owned externalRef" })
  @IsOptional()
  @IsString()
  externalRef?: string;
}

/** Query params for audit feeds (installation-scoped and global). */
export class ListHubAuditQueryDto {
  @ApiPropertyOptional({
    description: "Filter by dot-namespaced action, e.g. release.ingest",
  })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ description: "Max rows to return", default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/**
 * Body of PUT /module-hub/installations/:id/target-spec. The hub stores the
 * spec verbatim — it is pure data for read-time "target vs actual" display
 * and is NOT an execution channel (design §3, §4.1).
 */
export class SetHubTargetSpecDto {
  // modules.json spec shape; null clears the target spec. Validation skips
  // when the value is null/undefined so clients can send `{"spec": null}`
  // to clear.
  @ApiProperty({
    description: "modules.json spec shape; null clears the target spec",
    type: Object,
    nullable: true,
  })
  @ValidateIf((o) => o.spec !== null && o.spec !== undefined)
  @IsObject()
  spec: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// instance report API DTOs (token-only, X-Module-Hub-Token). Design doc §4.2.
// ---------------------------------------------------------------------------

export class HubReportDto {
  // "full": process-start self-registration with runtime facts and snapshot;
  // "ping": periodic liveness touch without snapshot.
  @ApiProperty({ enum: ["full", "ping"] })
  @IsIn(["full", "ping"])
  kind: "full" | "ping";

  // --- kind="full" fields below; "ping" omits them ---

  // Framework family of the running process.
  @ApiPropertyOptional({ enum: ["newbie", "fewbie", "other-node"] })
  @IsOptional()
  @IsIn(["newbie", "fewbie", "other-node"])
  framework?: "newbie" | "fewbie" | "other-node";

  @ApiPropertyOptional({ description: 'e.g. "newbie@0.2"' })
  @IsOptional()
  @IsString()
  frameworkVersion?: string;

  // Deployed application version (git sha / semver), self-reported.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  appVersion?: string;

  // Self-reported deployment environment, e.g. "prod".
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  env?: string;

  // Self-reported instance identifier (EC2 instance id, hostname, ...).
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  instanceId?: string;

  // Module snapshot in the shape of `newbie status --json` modules[] entries
  // (see design doc section 3). Source: the framework's own assembled-module
  // inventory, NOT a CLI invocation (design doc section 5).
  @ApiPropertyOptional({ description: "newbie status --json modules[] shape" })
  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  modules?: Array<Record<string, unknown>>;
}

export class HubReportResponseDto {
  @ApiProperty()
  serverTime: Date;

  // Requested report interval (seconds) for "ping" reports. v1 fixed 60;
  // reserved for hub-side throttling without a client upgrade.
  @ApiProperty()
  reportIntervalSeconds: number;

  // Latest registry HEAD commit known to the hub (webhook/fallback ingested).
  // Lets clients/ops see upgradability without a catalog query.
  @ApiPropertyOptional()
  latestRegistrySourceCommit?: string;
}
