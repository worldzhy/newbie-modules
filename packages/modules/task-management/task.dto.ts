import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";
import { ActorKind, TaskStatus } from "@generated/prisma/enums";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";
import { ChangeImpact, OriginReference, RequirementReview } from "./task.service";

// ─────────────────────────────────────────────────────────────────────────────
// Delivery-plan DTOs (ADR-054 D2)
// ─────────────────────────────────────────────────────────────────────────────

export class ChangeImpactDto implements ChangeImpact {
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

export class OriginReferenceDto implements OriginReference {
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
 * Fields shared by task creation and update. `designReviewRequired` is absent on
 * purpose: the service derives it from `changeImpact` and `allowedPaths`.
 */
export class TaskDeliveryFieldsDto {
  @ApiPropertyOptional({ type: String, description: "Parent task ID (uuid); a child is not dispatched directly" })
  @IsUUID("4")
  @IsOptional()
  parentId?: string;

  @ApiPropertyOptional({ type: String, description: "Design source reference (ADR / spec id or path)" })
  @IsString()
  @IsOptional()
  designReference?: string;

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
  allowedPaths?: string[];

  @ApiPropertyOptional({ type: ChangeImpactDto, description: "Declared change impact" })
  @ValidateNested()
  @Type(() => ChangeImpactDto)
  @IsOptional()
  changeImpact?: ChangeImpactDto;

  @ApiPropertyOptional({ type: [String], isArray: true, description: "Prerequisite task IDs (uuid)" })
  @IsArray()
  @IsUUID("4", { each: true })
  @IsOptional()
  prerequisiteTaskIds?: string[];

  @ApiPropertyOptional({ type: OriginReferenceDto, description: "Origin discussion reference" })
  @ValidateNested()
  @Type(() => OriginReferenceDto)
  @IsOptional()
  originReference?: OriginReferenceDto;

  @ApiPropertyOptional({ type: String, description: "Reason captured when the task moves to BLOCKED" })
  @IsString()
  @IsOptional()
  blockedReason?: string;

  @ApiPropertyOptional({ type: String, description: "Why the change falls inside the designReference scope" })
  @IsString()
  @IsOptional()
  designReferenceJustification?: string;

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

export class LookupActorByUserIdRequestDto {
  @ApiProperty({ type: String, description: "Host user ID the HUMAN actor stands for" })
  @IsString()
  @IsNotEmpty()
  userId!: string;
}

export class LookupActorByCrewmateIdRequestDto {
  @ApiProperty({ type: String, description: "Crewmate ID the CREWMATE actor stands for" })
  @IsString()
  @IsNotEmpty()
  crewmateId!: string;
}

export class GetTaskRequestDto {
  @ApiProperty({ type: String, description: "Task ID (uuid)" })
  @IsUUID("4")
  taskId!: string;
}

export class GetTaskActorMembersRequestDto {
  @ApiProperty({ type: String, description: "Project whose actors are listed (uuid)" })
  @IsUUID("4")
  projectId!: string;
}

export class ListTasksRequestDto extends CommonListRequestDto {
  @ApiProperty({ type: String, description: "Project the tasks belong to (uuid)" })
  @IsUUID("4")
  projectId!: string;

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

  @ApiPropertyOptional({ type: String, description: "Assignee TaskActor ID (uuid)" })
  @IsUUID("4")
  @IsOptional()
  assigneeId?: string;
}

export class CreateTaskRequestDto extends CreateTaskItemDto {
  @ApiProperty({ type: String, description: "Owning project ID (uuid)" })
  @IsUUID("4")
  projectId!: string;
}

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

  @ApiPropertyOptional({ type: String, description: "Assignee TaskActor ID (uuid)" })
  @IsUUID("4")
  @IsOptional()
  assigneeId?: string;

  @ApiPropertyOptional({
    type: String,
    description:
      "Reason recorded when a human overrides the frozen delivery plan (changeImpact / allowedPaths) after the task started (ADR-054 D3)",
  })
  @IsString()
  @IsOptional()
  planOverrideReason?: string;
}

export class CreateTasksBatchRequestDto {
  @ApiProperty({ type: String, description: "Owning project ID (uuid)" })
  @IsUUID("4")
  @IsNotEmpty()
  projectId!: string;

  @ApiPropertyOptional({ type: String, description: "Creator TaskActor ID (uuid)" })
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

export class TaskActorResponseDto {
  @ApiProperty({ description: "TaskActor ID (uuid)" })
  id!: string;

  @ApiProperty({ enum: ActorKind, description: "Whether the actor is a HUMAN or a CREWMATE" })
  kind!: ActorKind;

  @ApiPropertyOptional({ description: "Host user this actor stands for (HUMAN)", type: String, nullable: true })
  userId?: string | null;

  @ApiPropertyOptional({
    description: "Crewmate this actor stands for (CREWMATE)",
    type: String,
    nullable: true,
  })
  crewmateId?: string | null;

  @ApiPropertyOptional({ description: "Display name snapshot", type: String })
  displayName?: string | null;

  @ApiPropertyOptional({ description: "Avatar URL snapshot", type: String })
  avatarUrl?: string | null;

  @ApiProperty({ type: Date })
  createdAt!: Date;

  @ApiProperty({ type: Date })
  updatedAt!: Date;
}

export class TaskActorListItemResponseDto {
  @ApiProperty({ description: "TaskActor ID (uuid)" })
  id!: string;

  @ApiProperty({ enum: ActorKind })
  kind!: ActorKind;

  @ApiPropertyOptional({ description: "Host user this actor stands for (HUMAN)", type: String, nullable: true })
  userId?: string | null;

  @ApiPropertyOptional({
    description: "Crewmate this actor stands for (CREWMATE)",
    type: String,
    nullable: true,
  })
  crewmateId?: string | null;

  @ApiPropertyOptional({ description: "Display name snapshot", type: String })
  displayName?: string | null;

  @ApiPropertyOptional({ description: "Avatar URL snapshot", type: String })
  avatarUrl?: string | null;
}

export class TaskResponseDto {
  @ApiProperty({ description: "Task ID (uuid)" })
  id!: string;

  @ApiProperty({ description: "Task title" })
  title!: string;

  @ApiPropertyOptional({ description: "Task details", type: String })
  description?: string | null;

  @ApiProperty({ enum: TaskStatus })
  status!: TaskStatus;

  @ApiProperty({ type: Date })
  createdAt!: Date;

  @ApiProperty({ type: Date })
  updatedAt!: Date;

  @ApiPropertyOptional({ type: Date, description: "Soft-delete timestamp" })
  deletedAt?: Date | null;

  @ApiProperty({ description: "Owning project ID (uuid)" })
  projectId!: string;

  @ApiPropertyOptional({ description: "Creator TaskActor ID (uuid)", type: String })
  creatorId?: string | null;

  @ApiPropertyOptional({ description: "Assignee TaskActor ID (uuid)", type: String })
  assigneeId?: string | null;

  @ApiPropertyOptional({ description: "Last operator TaskActor ID (uuid)", type: String })
  lastOperatorId?: string | null;

  @ApiPropertyOptional({ description: "Parent task ID (uuid)", type: String, nullable: true })
  parentId?: string | null;

  @ApiPropertyOptional({ description: "Design source reference", type: String, nullable: true })
  designReference?: string | null;

  @ApiPropertyOptional({
    description: "Derived: the task needs a design review before it may start",
    type: Boolean,
  })
  designReviewRequired?: boolean;

  @ApiPropertyOptional({ description: "Acceptance criteria", type: String, nullable: true })
  acceptanceCriteria?: string | null;

  @ApiPropertyOptional({ description: "Allowed path globs", type: [String], isArray: true })
  allowedPaths?: string[];

  @ApiPropertyOptional({ description: "Declared change impact", type: Object, nullable: true })
  changeImpact?: unknown;

  @ApiPropertyOptional({ description: "Prerequisite task IDs (uuid)", type: [String], isArray: true })
  prerequisiteTaskIds?: string[];

  @ApiPropertyOptional({ description: "Origin discussion reference", type: Object, nullable: true })
  originReference?: unknown;

  @ApiPropertyOptional({ description: "Reason the task is blocked", type: String, nullable: true })
  blockedReason?: string | null;

  @ApiPropertyOptional({
    description: "Why the change falls inside the designReference scope",
    type: String,
    nullable: true,
  })
  designReferenceJustification?: string | null;

  @ApiPropertyOptional({ description: "Requirement-review summary", type: Object, nullable: true })
  requirementReview?: unknown;

  @ApiPropertyOptional({
    type: Date,
    description:
      "When the delivery plan (changeImpact / allowedPaths / designReviewRequired) froze; null until the task starts",
  })
  planFrozenAt?: Date | null;
}

export class TaskWithRelationsResponseDto extends TaskResponseDto {
  @ApiPropertyOptional({ type: TaskActorResponseDto, description: "Task creator" })
  creator?: TaskActorResponseDto | null;

  @ApiPropertyOptional({ type: TaskActorResponseDto, description: "Task assignee" })
  assignee?: TaskActorResponseDto | null;

  @ApiPropertyOptional({ type: TaskActorResponseDto, description: "Last operator" })
  lastOperator?: TaskActorResponseDto | null;
}

export class TaskActorMemberStatsResponseDto {
  @ApiProperty({ description: "Total active tasks assigned" })
  total!: number;

  @ApiProperty({ description: "Completed task count" })
  completed!: number;

  @ApiProperty({ description: "In-progress task count" })
  inProgress!: number;
}

export class TaskActorMemberResponseDto {
  @ApiProperty({ description: "TaskActor ID (uuid)" })
  id!: string;

  @ApiProperty({ enum: ActorKind })
  kind!: ActorKind;

  @ApiPropertyOptional({ description: "Display name snapshot", type: String })
  displayName?: string | null;

  @ApiPropertyOptional({ description: "Avatar URL snapshot", type: String })
  avatarUrl?: string | null;

  @ApiProperty({ type: TaskActorMemberStatsResponseDto })
  taskStats!: TaskActorMemberStatsResponseDto;

  @ApiProperty({ type: Date })
  createdAt!: Date;
}

/** Paginated list response for tasks. */
export class ListTasksResponseDto extends CommonListResponseDto<TaskWithRelationsResponseDto> {}

/** Result returned by the batch-create endpoint. */
export class BatchCreateTasksResponseDto {
  @ApiProperty({ description: "Number of tasks created" })
  count!: number;
}
