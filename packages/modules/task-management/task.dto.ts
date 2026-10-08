import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";
import { TaskStatus } from "./task.service";

// ─────────────────────────────────────────────────────────────────────────────
// Request DTOs
// ─────────────────────────────────────────────────────────────────────────────

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

export class CreateTaskItemDto {
  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: TaskStatus })
  @IsEnum(TaskStatus)
  @IsOptional()
  status?: TaskStatus;

  @ApiPropertyOptional({ type: String, description: "Assignee TaskUser ID (uuid)" })
  @IsUUID("4")
  @IsOptional()
  assigneeId?: string;

  @ApiPropertyOptional({ type: String, format: "date-time", description: "ISO 8601 due date" })
  @IsDateString()
  @IsOptional()
  dueDate?: Date;
}

export class CreateTaskRequestDto extends CreateTaskItemDto {}

export class UpdateTaskRequestDto {
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

  @ApiPropertyOptional({ type: String, description: "Assignee TaskUser ID (uuid)" })
  @IsUUID("4")
  @IsOptional()
  assigneeId?: string;

  @ApiPropertyOptional({ type: String, format: "date-time", description: "ISO 8601 due date" })
  @IsDateString()
  @IsOptional()
  dueDate?: Date;
}

export class CreateTasksBatchRequestDto {
  @ApiProperty({ type: String, description: "Owning TaskSpace ID (uuid)" })
  @IsUUID("4")
  @IsNotEmpty()
  spaceId: string;

  @ApiProperty({ type: String, description: "Nightwatch Project ID (uuid)" })
  @IsUUID("4")
  @IsNotEmpty()
  projectId: string;

  @ApiPropertyOptional({ type: String, description: "Creator TaskUser ID (uuid)" })
  @IsUUID("4")
  @IsOptional()
  creatorId?: string;

  @ApiProperty({ type: [CreateTaskItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateTaskItemDto)
  tasks: CreateTaskItemDto[];
}

export class LinkTaskUserRequestDto {
  @ApiProperty({ type: String, description: "TaskUser ID (uuid) to link to the current user" })
  @IsString()
  @IsNotEmpty()
  taskUserId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Response DTOs (no class-validator decorators: validation applies to inbound payloads only)
// ─────────────────────────────────────────────────────────────────────────────

export class TaskUserDto {
  @ApiProperty({ description: "TaskUser ID (uuid)" })
  id: string;

  @ApiProperty({ description: "External user ID, e.g. Lark open_id" })
  openId: string;

  @ApiPropertyOptional({ description: "Linked Nightwatch User ID (uuid), null when unlinked", type: String })
  userId?: string | null;

  @ApiPropertyOptional({ description: "Display name", type: String })
  name?: string | null;

  @ApiPropertyOptional({ description: "Avatar URL", type: String })
  avatarUrl?: string | null;

  @ApiProperty({ type: Date })
  createdAt: Date;

  @ApiProperty({ type: Date })
  updatedAt: Date;
}

export class TaskUserListItemDto {
  @ApiProperty({ description: "TaskUser ID (uuid)" })
  id: string;

  @ApiProperty({ description: "External user ID, e.g. Lark open_id" })
  openId: string;

  @ApiPropertyOptional({ description: "Linked Nightwatch User ID (uuid)", type: String })
  userId?: string | null;

  @ApiPropertyOptional({ description: "Display name", type: String })
  name?: string | null;

  @ApiPropertyOptional({ description: "Avatar URL", type: String })
  avatarUrl?: string | null;
}

export class TaskSpaceDto {
  @ApiProperty({ description: "TaskSpace ID (uuid)" })
  id: string;

  @ApiProperty({ description: "Nightwatch Project ID (uuid), 1:1 companion space" })
  projectId: string;

  @ApiPropertyOptional({ description: "Space name", type: String })
  name?: string | null;

  @ApiPropertyOptional({ description: "Space description", type: String })
  description?: string | null;

  @ApiProperty({ type: Date })
  createdAt: Date;

  @ApiProperty({ type: Date })
  updatedAt: Date;
}

export class TaskSpaceCountDto {
  @ApiProperty({ description: "Number of non-deleted tasks in the space" })
  tasks: number;
}

export class TaskSpaceWithCountDto extends TaskSpaceDto {
  @ApiProperty({ type: TaskSpaceCountDto, description: "Relation counts" })
  _count: TaskSpaceCountDto;
}

export class TaskDto {
  @ApiProperty({ description: "Task ID (uuid)" })
  id: string;

  @ApiProperty({ description: "Task title" })
  title: string;

  @ApiPropertyOptional({ description: "Task details", type: String })
  description?: string | null;

  @ApiProperty({ enum: TaskStatus })
  status: TaskStatus;

  @ApiPropertyOptional({ type: Date, description: "Expected completion time" })
  dueDate?: Date | null;

  @ApiProperty({ type: Date })
  createdAt: Date;

  @ApiProperty({ type: Date })
  updatedAt: Date;

  @ApiPropertyOptional({ type: Date, description: "Soft-delete timestamp" })
  deletedAt?: Date | null;

  @ApiProperty({ description: "Owning TaskSpace ID (uuid)" })
  spaceId: string;

  @ApiProperty({ description: "Nightwatch Project ID (uuid)" })
  projectId: string;

  @ApiPropertyOptional({ description: "Creator TaskUser ID (uuid)", type: String })
  creatorId?: string | null;

  @ApiPropertyOptional({ description: "Assignee TaskUser ID (uuid)", type: String })
  assigneeId?: string | null;

  @ApiPropertyOptional({ description: "ID of the last operator", type: String })
  lastOperatorId?: string | null;

  @ApiPropertyOptional({ description: "Display name of the last operator", type: String })
  lastOperatorName?: string | null;

  @ApiPropertyOptional({ description: "Source of the last operator, e.g. LARK | SYSTEM | WEB", type: String })
  lastOperatorSource?: string | null;
}

export class TaskWithRelationsDto extends TaskDto {
  @ApiPropertyOptional({ type: TaskUserDto, description: "Task creator" })
  creator?: TaskUserDto | null;

  @ApiPropertyOptional({ type: TaskUserDto, description: "Task assignee" })
  assignee?: TaskUserDto | null;

  @ApiPropertyOptional({ type: TaskSpaceDto, description: "Owning task space" })
  space?: TaskSpaceDto | null;
}

export class TaskMemberStatsDto {
  @ApiProperty({ description: "Total active tasks assigned" })
  total: number;

  @ApiProperty({ description: "Completed task count" })
  completed: number;

  @ApiProperty({ description: "In-progress task count" })
  inProgress: number;
}

export class TaskMemberDto {
  @ApiProperty({ description: "TaskUser ID (uuid)" })
  id: string;

  @ApiPropertyOptional({ description: "Display name", type: String })
  name?: string | null;

  @ApiPropertyOptional({ description: "Avatar URL", type: String })
  avatarUrl?: string | null;

  @ApiPropertyOptional({ description: "Nightwatch account email, null when unlinked", type: String })
  email?: string | null;

  @ApiPropertyOptional({ description: "Nightwatch display name/username, null when unlinked", type: String })
  systemUsername?: string | null;

  @ApiProperty({ type: TaskMemberStatsDto })
  taskStats: TaskMemberStatsDto;

  @ApiProperty({ type: Date })
  createdAt: Date;
}

// ── Envelope responses ({success, data?[, message]}) ──

export class TaskUsersListResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ type: [TaskUserListItemDto] })
  data: TaskUserListItemDto[];
}

export class TaskUserDataResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiPropertyOptional({ type: TaskUserDto, description: "Linked TaskUser, null when not linked" })
  data?: TaskUserDto | null;
}

export class LinkTaskUserResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiPropertyOptional({ type: TaskUserDto, description: "Present on success" })
  data?: TaskUserDto;

  @ApiPropertyOptional({ type: String, description: "Error message, present when success is false" })
  message?: string;
}

export class MembersResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ type: [TaskMemberDto] })
  data: TaskMemberDto[];
}

export class PaginatedTasksDto {
  @ApiProperty({ type: [TaskWithRelationsDto] })
  records: TaskWithRelationsDto[];

  @ApiProperty({ description: "Total record count" })
  total: number;

  @ApiProperty({ description: "Current page, 0-based" })
  page: number;

  @ApiProperty({ description: "Page size" })
  pageSize: number;
}

export class TasksResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ type: PaginatedTasksDto })
  data: PaginatedTasksDto;
}

export class TaskSpaceResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ type: TaskSpaceDto })
  data: TaskSpaceDto;
}

export class CreateTaskResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ type: TaskDto })
  data: TaskDto;
}

export class BatchCreateTasksResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ type: Object, description: "Batch creation result" })
  data: {
    count: number;
  };
}
