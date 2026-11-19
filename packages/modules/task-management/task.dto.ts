import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";
import { RequirementReview, TaskChangeClass, TaskImpact, TaskSourceRef, TaskStatus } from "./task.service";

// ─────────────────────────────────────────────────────────────────────────────
// Delivery-plan DTOs (ADR-054 D2)
// ─────────────────────────────────────────────────────────────────────────────

export class TaskImpactDto implements TaskImpact {
  @ApiPropertyOptional({
    type: [String],
    isArray: true,
    description: "Repositories the task is expected to change",
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  repos?: string[];

  @ApiPropertyOptional({ description: "Whether the task touches prisma schema or migrations" })
  @IsBoolean()
  @IsOptional()
  touchesSchema?: boolean;

  @ApiPropertyOptional({ description: "Whether the task changes cross-module or cross-repository contracts" })
  @IsBoolean()
  @IsOptional()
  touchesContracts?: boolean;

  @ApiPropertyOptional({ description: "Whether the task performs an irreversible operation" })
  @IsBoolean()
  @IsOptional()
  irreversible?: boolean;
}

export class TaskSourceRefDto implements TaskSourceRef {
  @ApiPropertyOptional({ type: String, description: "Discussion chat id the task came from" })
  @IsString()
  @IsOptional()
  chatId?: string;

  @ApiPropertyOptional({ type: String, description: "Message id inside that discussion" })
  @IsString()
  @IsOptional()
  messageId?: string;
}

export class RequirementReviewDto implements RequirementReview {
  @ApiPropertyOptional({ type: String, description: "Link to the requirement-review report" })
  @IsString()
  @IsOptional()
  reportUrl?: string;

  @ApiPropertyOptional({ type: Number, description: "Number of contradictions reported" })
  @IsNumber()
  @IsOptional()
  contradictionCount?: number;

  @ApiPropertyOptional({ type: Number, description: "Number of already-covered findings" })
  @IsNumber()
  @IsOptional()
  coveredCount?: number;

  @ApiPropertyOptional({ type: Number, description: "Number of suggestions" })
  @IsNumber()
  @IsOptional()
  suggestionCount?: number;

  @ApiPropertyOptional({ type: Number, description: "Number of uncovered areas" })
  @IsNumber()
  @IsOptional()
  uncoveredCount?: number;
}

/**
 * Fields shared by task creation and update. `changeClass` is absent on
 * purpose: the service derives it from `impact` and `scopePaths`.
 */
export class TaskDeliveryFieldsDto {
  @ApiPropertyOptional({ type: String, description: "Parent task ID (uuid); a child is not dispatched directly" })
  @IsUUID("4")
  @IsOptional()
  parentId?: string;

  @ApiPropertyOptional({ type: String, description: "Design source reference (ADR / spec id or path)" })
  @IsString()
  @IsOptional()
  designRef?: string;

  @ApiPropertyOptional({ type: String, description: "Acceptance criteria, required before a task may start" })
  @IsString()
  @IsOptional()
  acceptanceCriteria?: string;

  @ApiPropertyOptional({
    type: [String],
    isArray: true,
    description: "Allowed path globs; frozen once the task starts",
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  scopePaths?: string[];

  @ApiPropertyOptional({ type: TaskImpactDto, description: "Declared change impact" })
  @ValidateNested()
  @Type(() => TaskImpactDto)
  @IsOptional()
  impact?: TaskImpactDto;

  @ApiPropertyOptional({ type: [String], isArray: true, description: "Prerequisite task IDs (uuid)" })
  @IsArray()
  @IsUUID("4", { each: true })
  @IsOptional()
  dependsOn?: string[];

  @ApiPropertyOptional({ type: TaskSourceRefDto, description: "Origin discussion reference" })
  @ValidateNested()
  @Type(() => TaskSourceRefDto)
  @IsOptional()
  sourceRef?: TaskSourceRefDto;

  @ApiPropertyOptional({ type: String, description: "Reason captured when the task moves to BLOCKED" })
  @IsString()
  @IsOptional()
  blockedReason?: string;

  @ApiPropertyOptional({ type: String, description: "Why the change falls inside the designRef scope" })
  @IsString()
  @IsOptional()
  designRefJustification?: string;

  @ApiPropertyOptional({
    type: RequirementReviewDto,
    description: "Requirement-review summary from the discussion stage",
  })
  @ValidateNested()
  @Type(() => RequirementReviewDto)
  @IsOptional()
  requirementReview?: RequirementReviewDto;
}

// ─────────────────────────────────────────────────────────────────────────────
// Request DTOs
// ─────────────────────────────────────────────────────────────────────────────

export class LookupParticipantQueryDto {
  @ApiProperty({ type: String, description: "Host user ID the participant stands for" })
  @IsString()
  @IsNotEmpty()
  userId!: string;
}

export class ListTasksQueryDto {
  @ApiPropertyOptional({ type: Number, description: "Page number, 0-based", default: 0 })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ type: Number, description: "Page size", default: 10 })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  pageSize?: number;

  @ApiPropertyOptional({ type: String, description: "Keyword matched against task title" })
  @IsString()
  @IsOptional()
  keyword?: string;

  @ApiPropertyOptional({ enum: TaskStatus, description: "Filter by task status" })
  @IsEnum(TaskStatus)
  @IsOptional()
  status?: TaskStatus;

  @ApiPropertyOptional({ type: String, description: "Assignee display name filter" })
  @IsString()
  @IsOptional()
  assigneeName?: string;
}

export class CreateTaskItemDto extends TaskDeliveryFieldsDto {
  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: TaskStatus })
  @IsEnum(TaskStatus)
  @IsOptional()
  status?: TaskStatus;

  @ApiPropertyOptional({ type: String, description: "Assignee TaskParticipant ID (uuid)" })
  @IsUUID("4")
  @IsOptional()
  assigneeId?: string;

  @ApiPropertyOptional({ type: String, format: "date-time", description: "ISO 8601 due date" })
  @Type(() => String)
  @IsDateString()
  @IsOptional()
  dueDate?: Date;
}

export class CreateTaskRequestDto extends CreateTaskItemDto {}

export class UpdateTaskRequestDto extends TaskDeliveryFieldsDto {
  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: TaskStatus })
  @IsEnum(TaskStatus)
  @IsOptional()
  status?: TaskStatus;

  @ApiPropertyOptional({ type: String, description: "Assignee TaskParticipant ID (uuid)" })
  @IsUUID("4")
  @IsOptional()
  assigneeId?: string;

  @ApiPropertyOptional({ type: String, format: "date-time", description: "ISO 8601 due date" })
  @Type(() => String)
  @IsDateString()
  @IsOptional()
  dueDate?: Date;

  @ApiPropertyOptional({
    type: String,
    description:
      "Reason recorded when a human overrides the frozen delivery plan (impact / scopePaths) after the task started (ADR-054 D3)",
  })
  @IsString()
  @IsOptional()
  planOverrideReason?: string;
}

export class CreateTasksBatchRequestDto {
  @ApiProperty({ type: String, description: "Owning TaskSpace ID (uuid)" })
  @IsUUID("4")
  @IsNotEmpty()
  spaceId!: string;

  @ApiPropertyOptional({ type: String, description: "Creator TaskParticipant ID (uuid)" })
  @IsUUID("4")
  @IsOptional()
  creatorId?: string;

  @ApiProperty({ type: CreateTaskItemDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateTaskItemDto)
  tasks!: CreateTaskItemDto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Response DTOs
// ─────────────────────────────────────────────────────────────────────────────

export class TaskParticipantDto {
  @ApiProperty({ description: "TaskParticipant ID (uuid)" })
  id!: string;

  @ApiPropertyOptional({ description: "Host user this participant stands for", type: String, nullable: true })
  userId?: string | null;

  @ApiPropertyOptional({ description: "Display name snapshot", type: String })
  name?: string | null;

  @ApiPropertyOptional({ description: "Avatar URL snapshot", type: String })
  avatarUrl?: string | null;

  @ApiProperty({ type: Date })
  createdAt!: Date;

  @ApiProperty({ type: Date })
  updatedAt!: Date;
}

export class TaskParticipantListItemDto {
  @ApiProperty({ description: "TaskParticipant ID (uuid)" })
  id!: string;

  @ApiPropertyOptional({ description: "Host user this participant stands for", type: String, nullable: true })
  userId?: string | null;

  @ApiPropertyOptional({ description: "Display name snapshot", type: String })
  name?: string | null;

  @ApiPropertyOptional({ description: "Avatar URL snapshot", type: String })
  avatarUrl?: string | null;
}

export class TaskSpaceDto {
  @ApiProperty({ description: "TaskSpace ID (uuid)" })
  id!: string;

  @ApiProperty({ description: "Nightwatch Project ID (uuid), 1:1 companion space" })
  projectId!: string;

  @ApiPropertyOptional({ description: "Space name", type: String })
  name?: string | null;

  @ApiPropertyOptional({ description: "Space description", type: String })
  description?: string | null;

  @ApiProperty({ type: Date })
  createdAt!: Date;

  @ApiProperty({ type: Date })
  updatedAt!: Date;
}

export class TaskSpaceCountDto {
  @ApiProperty({ description: "Number of non-deleted tasks in the space" })
  tasks!: number;
}

export class TaskSpaceWithCountDto extends TaskSpaceDto {
  @ApiProperty({ type: TaskSpaceCountDto, description: "Relation counts" })
  _count!: TaskSpaceCountDto;
}

export class TaskDto {
  @ApiProperty({ description: "Task ID (uuid)" })
  id!: string;

  @ApiProperty({ description: "Task title" })
  title!: string;

  @ApiPropertyOptional({ description: "Task details", type: String })
  description?: string | null;

  @ApiProperty({ enum: TaskStatus })
  status!: TaskStatus;

  @ApiPropertyOptional({ type: Date, description: "Expected completion time" })
  dueDate?: Date | null;

  @ApiProperty({ type: Date })
  createdAt!: Date;

  @ApiProperty({ type: Date })
  updatedAt!: Date;

  @ApiPropertyOptional({ type: Date, description: "Soft-delete timestamp" })
  deletedAt?: Date | null;

  @ApiProperty({ description: "Owning TaskSpace ID (uuid)" })
  spaceId!: string;

  @ApiPropertyOptional({ description: "Creator TaskParticipant ID (uuid)", type: String })
  creatorId?: string | null;

  @ApiPropertyOptional({ description: "Assignee TaskParticipant ID (uuid)", type: String })
  assigneeId?: string | null;

  @ApiPropertyOptional({ description: "Last operator TaskParticipant ID (uuid)", type: String })
  lastOperatorParticipantId?: string | null;

  @ApiPropertyOptional({ description: "Display name of the last operator", type: String })
  lastOperatorName?: string | null;

  @ApiPropertyOptional({ description: "Parent task ID (uuid)", type: String, nullable: true })
  parentId?: string | null;

  @ApiPropertyOptional({ description: "Design source reference", type: String, nullable: true })
  designRef?: string | null;

  @ApiPropertyOptional({ description: "Acceptance criteria", type: String, nullable: true })
  acceptanceCriteria?: string | null;

  @ApiPropertyOptional({ description: "Allowed path globs", type: [String], isArray: true })
  scopePaths?: string[];

  @ApiPropertyOptional({ description: "Declared change impact", type: Object, nullable: true })
  impact?: unknown;

  @ApiPropertyOptional({ enum: TaskChangeClass, description: "Derived delivery-plan class", nullable: true })
  changeClass?: TaskChangeClass | null;

  @ApiPropertyOptional({ description: "Prerequisite task IDs (uuid)", type: [String], isArray: true })
  dependsOn?: string[];

  @ApiPropertyOptional({ description: "Origin discussion reference", type: Object, nullable: true })
  sourceRef?: unknown;

  @ApiPropertyOptional({ description: "Reason the task is blocked", type: String, nullable: true })
  blockedReason?: string | null;

  @ApiPropertyOptional({ description: "Why the change falls inside the designRef scope", type: String, nullable: true })
  designRefJustification?: string | null;

  @ApiPropertyOptional({ description: "Requirement-review summary", type: Object, nullable: true })
  requirementReview?: unknown;

  @ApiPropertyOptional({
    type: Date,
    description: "When the delivery plan (impact / scopePaths / changeClass) froze; null until the task starts",
  })
  planFrozenAt?: Date | null;
}

export class TaskWithRelationsDto extends TaskDto {
  @ApiPropertyOptional({ type: TaskParticipantDto, description: "Task creator" })
  creator?: TaskParticipantDto | null;

  @ApiPropertyOptional({ type: TaskParticipantDto, description: "Task assignee" })
  assignee?: TaskParticipantDto | null;

  @ApiPropertyOptional({ type: TaskParticipantDto, description: "Last operator" })
  lastOperatorParticipant?: TaskParticipantDto | null;

  @ApiPropertyOptional({ type: TaskSpaceDto, description: "Owning task space" })
  space?: TaskSpaceDto | null;
}

export class TaskMemberStatsDto {
  @ApiProperty({ description: "Total active tasks assigned" })
  total!: number;

  @ApiProperty({ description: "Completed task count" })
  completed!: number;

  @ApiProperty({ description: "In-progress task count" })
  inProgress!: number;
}

export class TaskMemberDto {
  @ApiProperty({ description: "TaskParticipant ID (uuid)" })
  id!: string;

  @ApiPropertyOptional({ description: "Display name snapshot", type: String })
  name?: string | null;

  @ApiPropertyOptional({ description: "Avatar URL snapshot", type: String })
  avatarUrl?: string | null;

  @ApiProperty({ type: TaskMemberStatsDto })
  taskStats!: TaskMemberStatsDto;

  @ApiProperty({ type: Date })
  createdAt!: Date;
}

// ── Envelope responses ({success, data?[, message]}) ──

export class ListTaskParticipantsResponseDto {
  @ApiProperty()
  success!: boolean;

  @ApiProperty({ type: TaskParticipantListItemDto, isArray: true })
  data!: TaskParticipantListItemDto[];
}

export class TaskParticipantDataResponseDto {
  @ApiProperty()
  success!: boolean;

  @ApiPropertyOptional({ type: TaskParticipantDto, description: "Participant, null when not found" })
  data?: TaskParticipantDto | null;
}

export class MembersResponseDto {
  @ApiProperty()
  success!: boolean;

  @ApiProperty({ type: TaskMemberDto, isArray: true })
  data!: TaskMemberDto[];
}

export class PaginatedTasksDto {
  @ApiProperty({ type: TaskWithRelationsDto, isArray: true })
  records!: TaskWithRelationsDto[];

  @ApiProperty({ description: "Total record count" })
  total!: number;

  @ApiProperty({ description: "Current page, 0-based" })
  page!: number;

  @ApiProperty({ description: "Page size" })
  pageSize!: number;
}

export class TasksResponseDto {
  @ApiProperty()
  success!: boolean;

  @ApiProperty({ type: PaginatedTasksDto })
  data!: PaginatedTasksDto;
}

export class TaskSpaceResponseDto {
  @ApiProperty()
  success!: boolean;

  @ApiProperty({ type: TaskSpaceDto })
  data!: TaskSpaceDto;
}

export class CreateTaskResponseDto {
  @ApiProperty()
  success!: boolean;

  @ApiProperty({ type: TaskDto })
  data!: TaskDto;
}

export class BatchCreateTasksResponseDto {
  @ApiProperty()
  success!: boolean;

  @ApiProperty({ type: Object, description: "Batch creation result" })
  data!: {
    count: number;
  };
}
