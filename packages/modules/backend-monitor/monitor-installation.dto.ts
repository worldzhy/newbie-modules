import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

// ---------------------------------------------------------------------------
// Host integration API DTOs for BackendMonitorInstallation (module-hub design §9.2).
// Ingest itself stays token-only via the X-Backend-Monitor-Token header.
// ---------------------------------------------------------------------------

export class CreateMonitorInstallationDto {
  @ApiProperty({ description: 'Human-readable label, e.g. "nightwatch-prod"' })
  @IsString()
  @MaxLength(255)
  label: string;

  @ApiPropertyOptional({
    description: 'Opaque host tag; convention "projectId/applicationId"',
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
  @ApiPropertyOptional({ description: "Filter by host-owned externalRef" })
  @IsOptional()
  @IsString()
  externalRef?: string;
}
