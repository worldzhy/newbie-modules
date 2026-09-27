import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsIn, IsObject, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

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

export class CreateHubChangeRequestDto {
  @ApiProperty({ enum: ["ADD", "REMOVE", "UPGRADE"] })
  @IsIn(["ADD", "REMOVE", "UPGRADE"])
  type: "ADD" | "REMOVE" | "UPGRADE";

  @ApiProperty()
  @IsString()
  moduleKey: string;

  /** UPGRADE only. Null/absent = registry HEAD at execution time. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  targetSourceCommit?: string;

  @ApiPropertyOptional({
    description: "reject: refuse execution when local drift exists (default); force: pass --force",
    enum: ["reject", "force"],
  })
  @IsOptional()
  @IsIn(["reject", "force"])
  driftPolicy?: "reject" | "force";

  /** Reserved. v1 always executes as "worktree". */
  @ApiPropertyOptional({ enum: ["worktree", "pr"] })
  @IsOptional()
  @IsIn(["worktree", "pr"])
  delivery?: "worktree" | "pr";

  @ApiPropertyOptional({ description: "Host actor identifier recorded on the change request" })
  @IsOptional()
  @IsString()
  createdBy?: string;
}

export class ListHubChangeRequestsQueryDto {
  @ApiPropertyOptional({ enum: ["PENDING", "RUNNING", "DONE", "FAILED"] })
  @IsOptional()
  @IsIn(["PENDING", "RUNNING", "DONE", "FAILED"])
  status?: "PENDING" | "RUNNING" | "DONE" | "FAILED";
}

// ---------------------------------------------------------------------------
// agent polling API DTOs (token-only, X-Module-Hub-Token)
// ---------------------------------------------------------------------------

export class HubAgentResultDto {
  @ApiProperty()
  @IsUUID()
  changeRequestId: string;

  @ApiProperty({ enum: ["DONE", "FAILED"] })
  @IsIn(["DONE", "FAILED"])
  outcome: "DONE" | "FAILED";

  /** Post-execution snapshot excerpt + changed-file summary. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  summary?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  error?: string;
}

export class HubAgentPollDto {
  /** newbie CLI version of the agent process, e.g. "0.1.0-stage.2". */
  @ApiProperty()
  @IsString()
  cliVersion: string;

  /** Verbatim output of `newbie status --json [--drift]` from the project root. */
  @ApiProperty({ description: "Verbatim `newbie status --json` output" })
  @IsObject()
  status: Record<string, unknown>;

  /** Receipts for change requests received in earlier polls. */
  @ApiPropertyOptional({ type: [HubAgentResultDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HubAgentResultDto)
  results?: HubAgentResultDto[];
}
