import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";

/** Hard caps keep one ingest call bounded (worklog batches are small by design). */
export const MAX_WORKSPACES_PER_BATCH = 100;
export const MAX_SESSIONS_PER_BATCH = 50;
export const MAX_MESSAGES_PER_SESSION = 2000;
export const MAX_DOCUMENTS_PER_BATCH = 100;

/**
 * Transcript origins the worklog agent knows how to read. "trae-memory" is the
 * IDE's own session summary (lower fidelity than a raw transcript) — the
 * distinction travels end to end so coverage can state it explicitly.
 */
export const WORKLOG_SESSION_SOURCES = ["claude", "codex", "trae-memory"] as const;
export type WorklogSessionSource = (typeof WORKLOG_SESSION_SOURCES)[number];

export class WorklogWorkspaceItemDto {
  @ApiProperty({ description: "Evaluatee the workspace belongs to" })
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
}

export class WorklogWorkspaceReportDto {
  @ApiProperty({ type: [WorklogWorkspaceItemDto], isArray: true })
  @IsArray()
  @ArrayMaxSize(MAX_WORKSPACES_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => WorklogWorkspaceItemDto)
  workspaces!: WorklogWorkspaceItemDto[];
}

export class WorklogSessionMessageDto {
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

export class WorklogSessionItemDto {
  @ApiProperty() @IsUUID() @IsNotEmpty() evaluateeUserId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() workspaceKey!: string;
  @ApiProperty() @IsString() @IsNotEmpty() externalSessionId!: string;

  @ApiPropertyOptional({
    description: 'Transcript origin: "claude" / "codex" / "trae-memory" — defaults to "claude"',
    enum: WORKLOG_SESSION_SOURCES,
  })
  @IsOptional()
  @IsIn(WORKLOG_SESSION_SOURCES)
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

  @ApiProperty({ type: [WorklogSessionMessageDto], isArray: true })
  @IsArray()
  @ArrayMaxSize(MAX_MESSAGES_PER_SESSION)
  @ValidateNested({ each: true })
  @Type(() => WorklogSessionMessageDto)
  messages!: WorklogSessionMessageDto[];
}

export class WorklogSessionReportDto {
  @ApiProperty({ type: [WorklogSessionItemDto], isArray: true })
  @IsArray()
  @ArrayMaxSize(MAX_SESSIONS_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => WorklogSessionItemDto)
  sessions!: WorklogSessionItemDto[];
}

export class WorklogDocumentItemDto {
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

export class WorklogDocumentReportDto {
  @ApiProperty({ type: [WorklogDocumentItemDto], isArray: true })
  @IsArray()
  @ArrayMaxSize(MAX_DOCUMENTS_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => WorklogDocumentItemDto)
  documents!: WorklogDocumentItemDto[];
}

/** Worklog installation enrollment (supervisor-side; carries the evaluatee the token reports for). */
export class CreateWorklogInstallationRequestDto {
  @ApiProperty({ description: 'Human-readable label, e.g. "worldzhy-macbook"' })
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiProperty({ description: "Evaluatee userId the token is allowed to report for" })
  @IsUUID()
  @IsNotEmpty()
  evaluateeUserId!: string;

  @ApiPropertyOptional({ description: "Host the worklog agent runs on (informational)" })
  @IsOptional()
  @IsString()
  hostname?: string;
}

export class ListWorklogInstallationsRequestDto {
  @ApiPropertyOptional({ description: "Filter by evaluatee userId" })
  @IsOptional()
  @IsUUID()
  evaluateeUserId?: string;
}

export class WorklogInstallationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;
  @ApiProperty() evaluateeUserId!: string;
  @ApiPropertyOptional() hostname?: string | null;
  @ApiPropertyOptional() firstSeenAt?: Date | null;
  @ApiPropertyOptional() lastSeenAt?: Date | null;
  @ApiPropertyOptional() revokedAt?: Date | null;
  @ApiProperty() online!: boolean;
  @ApiProperty() createdAt!: Date;
}

/**
 * Self-service worklog profile. Tokens are stored as hashes, so the profile
 * can only carry a freshly rotated token — downloading it invalidates the
 * token the worklog agent currently runs with.
 */
export class WorklogProfileResponseDto {
  @ApiProperty({ description: "API base URL the worklog agent posts to" })
  endpoint!: string;
  @ApiProperty({ description: "Freshly rotated plaintext token — shown once" })
  token!: string;
  @ApiProperty({ description: "Evaluatee the token reports for" })
  evaluateeUserId!: string;
}

/**
 * Session ingest payload roles — the worklog agent normalizes provider-specific
 * roles into this small set so the transcript stays tool-agnostic.
 */
export enum WorklogMessageRole {
  USER = "user",
  ASSISTANT = "assistant",
  TOOL = "tool",
  SYSTEM = "system",
}
