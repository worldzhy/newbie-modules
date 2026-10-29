import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

// ---------------------------------------------------------------------------
// Host integration API DTOs for BackendMonitorInstallation (module-hub design §9.2).
// Ingest itself stays token-only via the X-Backend-Monitor-Token header.
// ---------------------------------------------------------------------------

export class CreateMonitorInstallationDto {
  @ApiProperty({ description: 'Human-readable label, e.g. "api-prod"' })
  @IsString()
  @MaxLength(255)
  label!: string;

  @ApiPropertyOptional({
    description:
      "Opaque platform-owned tag; the module never parses it. The host-bound MonitorApplicationRefResolver port maps it to the applicationId stamped on ClickHouse rows.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalRef?: string;

  @ApiPropertyOptional({ description: "Deployment environment, e.g. prod" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  env?: string;

  @ApiPropertyOptional({ description: "Reporter family/kind, e.g. newbie" })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  kind?: string;
}

export class ListMonitorInstallationsQueryDto {
  @ApiPropertyOptional({ description: "Filter by platform-owned externalRef" })
  @IsOptional()
  @IsString()
  externalRef?: string;
}
