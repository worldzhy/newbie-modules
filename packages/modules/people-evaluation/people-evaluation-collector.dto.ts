import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";

/** Hard caps keep one ingest call bounded (collector batches are small by design). */
export const MAX_WORKSPACES_PER_BATCH = 100;
export const MAX_SESSIONS_PER_BATCH = 50;
export const MAX_MESSAGES_PER_SESSION = 2000;
export const MAX_DOCUMENTS_PER_BATCH = 100;

/**
 * Transcript origins the collector knows how to read. "trae-memory" is the
 * IDE's own session summary (lower fidelity than a raw transcript) — the
 * distinction travels end to end so coverage can state it explicitly.
 */
export const COLLECTOR_SESSION_SOURCES = ["claude", "codex", "trae-memory"] as const;
export type CollectorSessionSource = (typeof COLLECTOR_SESSION_SOURCES)[number];

export class CollectorWorkspaceItemDto {
  @ApiProperty({ description: "Member the workspace belongs to" })
  @IsUUID()
  @IsNotEmpty()
  evaluateeUserId!: string;

  @ApiProperty({ description: "IDE-side workspace identifier (stable across reports)" })
  @IsString()
  @IsNotEmpty()
  workspaceKey!: string;

  @ApiProperty({ description: "Absolute workspace root path" })
  @IsString()
  @IsNotEmpty()
  rootPath!: string;

  @ApiProperty({ description: "Self-declared company/personal split" })
  @IsBoolean()
  isCompany!: boolean;

  @ApiProperty({ type: [Object], isArray: true, description: "[{ path, platform, repositoryFullName }]" })
  @IsArray()
  @IsObject({ each: true })
  repositories!: object[];
}

export class CollectorWorkspaceReportDto {
  @ApiProperty({ type: [CollectorWorkspaceItemDto], isArray: true })
  @IsArray()
  @ArrayMaxSize(MAX_WORKSPACES_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => CollectorWorkspaceItemDto)
  workspaces!: CollectorWorkspaceItemDto[];
}

export class CollectorSessionMessageDto {
  @ApiProperty({ description: "Monotonic sequence inside the session" })
  @IsNumber()
  seq!: number;

  @ApiProperty({ description: 'Message role, e.g. "user" / "assistant" / "tool"' })
  @IsString()
  @IsNotEmpty()
  role!: string;

  @ApiProperty({ description: "Message content chunk (already redacted client-side)" })
  @IsString()
  content!: string;

  @ApiPropertyOptional({ description: "Tool name when this message is a tool call/result" })
  @IsOptional()
  @IsString()
  toolName?: string;

  @ApiPropertyOptional({ description: "Raw JSON of tool calls in this message" })
  @IsOptional()
  @IsString()
  toolCalls?: string;

  @ApiPropertyOptional({ description: "Token count reported by the IDE, when known" })
  @IsOptional()
  @IsNumber()
  tokenCount?: number;

  @ApiPropertyOptional({ description: "Message timestamp — defaults to the session start" })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  createdAt?: Date;
}

export class CollectorSessionItemDto {
  @ApiProperty() @IsUUID() @IsNotEmpty() evaluateeUserId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() workspaceKey!: string;
  @ApiProperty() @IsString() @IsNotEmpty() externalSessionId!: string;

  @ApiPropertyOptional({
    description: 'Transcript origin: "claude" / "codex" / "trae-memory" — defaults to "claude"',
    enum: COLLECTOR_SESSION_SOURCES,
  })
  @IsOptional()
  @IsIn(COLLECTOR_SESSION_SOURCES)
  source?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() model?: string;
  @ApiProperty() @IsNumber() turnCount!: number;
  @ApiProperty() @IsNumber() messageCount!: number;
  @ApiProperty() @IsNumber() toolCallCount!: number;

  @ApiPropertyOptional({ type: [String], isArray: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  toolNames?: string[];

  @ApiPropertyOptional({ type: [String], isArray: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  touchedFiles?: string[];

  @ApiPropertyOptional() @IsOptional() @IsNumber() durationMs?: number;
  @ApiProperty() @Type(() => Date) @IsDate() startedAt!: Date;
  @ApiProperty() @Type(() => Date) @IsDate() endedAt!: Date;

  @ApiProperty({ type: [CollectorSessionMessageDto], isArray: true })
  @IsArray()
  @ArrayMaxSize(MAX_MESSAGES_PER_SESSION)
  @ValidateNested({ each: true })
  @Type(() => CollectorSessionMessageDto)
  messages!: CollectorSessionMessageDto[];
}

export class CollectorSessionReportDto {
  @ApiProperty({ type: [CollectorSessionItemDto], isArray: true })
  @IsArray()
  @ArrayMaxSize(MAX_SESSIONS_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => CollectorSessionItemDto)
  sessions!: CollectorSessionItemDto[];
}

export class CollectorDocumentItemDto {
  @ApiProperty() @IsUUID() @IsNotEmpty() evaluateeUserId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() workspaceKey!: string;
  @ApiProperty() @IsString() @IsNotEmpty() title!: string;
  @ApiProperty({ description: "Workspace-relative path — stable identity of the document" })
  @IsString()
  @IsNotEmpty()
  refPath!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty({ description: "Document content, already redacted client-side" })
  @IsString()
  content!: string;
  @ApiProperty() @Type(() => Date) @IsDate() capturedAt!: Date;
}

export class CollectorDocumentReportDto {
  @ApiProperty({ type: [CollectorDocumentItemDto], isArray: true })
  @IsArray()
  @ArrayMaxSize(MAX_DOCUMENTS_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => CollectorDocumentItemDto)
  documents!: CollectorDocumentItemDto[];
}

/** Installation enrollment (supervisor-side; carries the member the token reports for). */
export class CreateCollectorInstallationDto {
  @ApiProperty({ description: 'Human-readable label, e.g. "worldzhy-macbook"' })
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiProperty({ description: "Member userId the token is allowed to report for" })
  @IsUUID()
  @IsNotEmpty()
  memberUserId!: string;

  @ApiPropertyOptional({ description: "Host the collector runs on (informational)" })
  @IsOptional()
  @IsString()
  hostname?: string;
}

export class ListCollectorInstallationsQueryDto {
  @ApiPropertyOptional({ description: "Filter by member userId" })
  @IsOptional()
  @IsUUID()
  memberUserId?: string;
}

export class CollectorInstallationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;
  @ApiProperty() memberUserId!: string;
  @ApiPropertyOptional() hostname?: string | null;
  @ApiPropertyOptional() firstSeenAt?: Date | null;
  @ApiPropertyOptional() lastSeenAt?: Date | null;
  @ApiPropertyOptional() revokedAt?: Date | null;
  @ApiProperty() online!: boolean;
  @ApiProperty() createdAt!: Date;
}

/**
 * Self-service collector profile. Tokens are stored as hashes, so the profile
 * can only carry a freshly rotated token — downloading it invalidates the
 * token the collector currently runs with.
 */
export class CollectorProfileResponseDto {
  @ApiProperty({ description: "API base URL the collector posts to" })
  endpoint!: string;
  @ApiProperty({ description: "Freshly rotated plaintext token — shown once" })
  token!: string;
  @ApiProperty({ description: "Member the token reports for" })
  memberUserId!: string;
}

/**
 * Session ingest payload roles — the collector normalizes provider-specific
 * roles into this small set so the transcript stays tool-agnostic.
 */
export enum CollectorMessageRole {
  USER = "user",
  ASSISTANT = "assistant",
  TOOL = "tool",
  SYSTEM = "system",
}
