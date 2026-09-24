import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';
import {Type} from 'class-transformer';
import {IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsDateString, IsUUID} from 'class-validator';
import {TaskStatus} from './task.service';

// ─────────────────────────────────────────────────────────────────────────────
// Request DTOs
// ─────────────────────────────────────────────────────────────────────────────

export class CreateGroupDto {
  @ApiProperty({type: String, description: 'Lark group chat ID or other platform group ID'})
  @IsString()
  @IsNotEmpty()
  chatId: string;

  @ApiPropertyOptional({type: String, description: 'Group name'})
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({type: String, description: 'Group description'})
  @IsString()
  @IsOptional()
  description?: string;
}

export class ListTasksQueryDto {
  @ApiPropertyOptional({type: Number, description: 'Page number, 0-based', default: 0})
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({type: Number, description: 'Page size', default: 10})
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  pageSize?: number;

  @ApiPropertyOptional({type: String, description: 'Keyword matched against task title'})
  @IsString()
  @IsOptional()
  keyword?: string;

  @ApiPropertyOptional({enum: TaskStatus, description: 'Filter by task status'})
  @IsEnum(TaskStatus)
  @IsOptional()
  status?: TaskStatus;

  @ApiPropertyOptional({type: String, description: 'Assignee display name filter'})
  @IsString()
  @IsOptional()
  assigneeName?: string;
}

export class ListReportsQueryDto {
  @ApiPropertyOptional({type: Number, description: 'Page number, 0-based', default: 0})
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({type: Number, description: 'Page size', default: 10})
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  pageSize?: number;
}

export class UpdateTaskApiDto {
  @ApiPropertyOptional({enum: TaskStatus})
  @IsEnum(TaskStatus)
  @IsOptional()
  status?: TaskStatus;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({type: String, description: 'Assignee TaskUser ID (uuid)'})
  @IsUUID('4')
  @IsOptional()
  assigneeId?: string;

  @ApiPropertyOptional({type: String, format: 'date-time', description: 'ISO 8601 due date'})
  @IsDateString()
  @IsOptional()
  dueDate?: Date;
}

export class CreateTaskApiDto {
  @ApiProperty({type: String})
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({enum: TaskStatus})
  @IsEnum(TaskStatus)
  @IsOptional()
  status?: TaskStatus;

  @ApiPropertyOptional({type: String, description: 'Assignee TaskUser ID (uuid)'})
  @IsUUID('4')
  @IsOptional()
  assigneeId?: string;

  @ApiPropertyOptional({type: String, format: 'date-time', description: 'ISO 8601 due date'})
  @IsDateString()
  @IsOptional()
  dueDate?: Date;
}

export class GenerateMonthlyReportDto {
  @ApiProperty({type: Number, description: 'Full year, e.g. 2026'})
  @IsNumber()
  year: number;

  @ApiProperty({type: Number, description: 'Month, 1-12'})
  @IsNumber()
  month: number;
}

export class LinkTaskUserDto {
  @ApiProperty({type: String, description: 'TaskUser ID (uuid) to link to the current user'})
  @IsString()
  @IsNotEmpty()
  taskUserId: string;
}

export class LinkTaskProjectDto {
  @ApiProperty({type: String, description: 'Nightwatch Project ID (uuid)'})
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @ApiProperty({type: String, description: 'TaskProject ID (uuid)'})
  @IsString()
  @IsNotEmpty()
  taskProjectId: string;
}

export class UnlinkTaskProjectDto {
  @ApiProperty({type: String, description: 'Nightwatch Project ID (uuid)'})
  @IsString()
  @IsNotEmpty()
  projectId: string;
}

export class UpdateMonthlyReportDto {
  @ApiProperty({type: String})
  @IsString()
  @IsNotEmpty()
  content: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Response DTOs (no class-validator decorators: validation applies to inbound payloads only)
// ─────────────────────────────────────────────────────────────────────────────

export class TaskUserDto {
  @ApiProperty({description: 'TaskUser ID (uuid)'})
  id: string;

  @ApiProperty({description: 'External user ID, e.g. Lark open_id'})
  openId: string;

  @ApiPropertyOptional({description: 'Linked Nightwatch User ID (uuid), null when unlinked', type: String})
  userId?: string | null;

  @ApiPropertyOptional({description: 'Display name', type: String})
  name?: string | null;

  @ApiPropertyOptional({description: 'Avatar URL', type: String})
  avatarUrl?: string | null;

  @ApiProperty({type: Date})
  createdAt: Date;

  @ApiProperty({type: Date})
  updatedAt: Date;
}

export class TaskUserListItemDto {
  @ApiProperty({description: 'TaskUser ID (uuid)'})
  id: string;

  @ApiProperty({description: 'External user ID, e.g. Lark open_id'})
  openId: string;

  @ApiPropertyOptional({description: 'Linked Nightwatch User ID (uuid)', type: String})
  userId?: string | null;

  @ApiPropertyOptional({description: 'Display name', type: String})
  name?: string | null;

  @ApiPropertyOptional({description: 'Avatar URL', type: String})
  avatarUrl?: string | null;
}

export class TaskProjectDto {
  @ApiProperty({description: 'TaskProject ID (uuid)'})
  id: string;

  @ApiPropertyOptional({description: 'Linked Nightwatch Project ID (uuid), null when unlinked', type: String})
  projectId?: string | null;

  @ApiProperty({description: 'Project name'})
  name: string;

  @ApiPropertyOptional({description: 'Project description', type: String})
  description?: string | null;

  @ApiProperty({type: Date})
  createdAt: Date;

  @ApiProperty({type: Date})
  updatedAt: Date;

  @ApiPropertyOptional({description: 'Soft-delete timestamp', type: Date})
  deletedAt?: Date | null;

  @ApiProperty({description: 'Owning TaskGroup ID (uuid)'})
  groupId: string;
}

export class TaskProjectListItemDto {
  @ApiProperty({description: 'TaskProject ID (uuid)'})
  id: string;

  @ApiPropertyOptional({description: 'Linked Nightwatch Project ID (uuid)', type: String})
  projectId?: string | null;

  @ApiProperty({description: 'Project name'})
  name: string;

  @ApiPropertyOptional({description: 'Project description', type: String})
  description?: string | null;

  @ApiProperty({description: 'Owning TaskGroup ID (uuid)'})
  groupId: string;
}

export class TaskGroupDto {
  @ApiProperty({description: 'TaskGroup ID (uuid)'})
  id: string;

  @ApiProperty({description: 'Lark group chat ID or other platform group ID'})
  chatId: string;

  @ApiPropertyOptional({description: 'Group name', type: String})
  name?: string | null;

  @ApiPropertyOptional({description: 'Group description', type: String})
  description?: string | null;

  @ApiPropertyOptional({description: 'Linked Nightwatch Project ID (uuid)', type: String})
  projectId?: string | null;

  @ApiProperty({type: Date})
  createdAt: Date;

  @ApiProperty({type: Date})
  updatedAt: Date;
}

export class TaskGroupCountDto {
  @ApiProperty({description: 'Number of non-deleted tasks in the group'})
  tasks: number;
}

export class TaskGroupWithCountDto extends TaskGroupDto {
  @ApiProperty({type: TaskGroupCountDto, description: 'Relation counts'})
  _count: TaskGroupCountDto;
}

export class TaskDto {
  @ApiProperty({description: 'Task ID (uuid)'})
  id: string;

  @ApiProperty({description: 'Task title'})
  title: string;

  @ApiPropertyOptional({description: 'Task details', type: String})
  description?: string | null;

  @ApiProperty({enum: TaskStatus})
  status: TaskStatus;

  @ApiPropertyOptional({type: Date, description: 'Expected completion time'})
  dueDate?: Date | null;

  @ApiProperty({type: Date})
  createdAt: Date;

  @ApiProperty({type: Date})
  updatedAt: Date;

  @ApiPropertyOptional({type: Date, description: 'Soft-delete timestamp'})
  deletedAt?: Date | null;

  @ApiProperty({description: 'Owning TaskGroup ID (uuid)'})
  groupId: string;

  @ApiPropertyOptional({description: 'Owning TaskProject ID (uuid)', type: String})
  taskProjectId?: string | null;

  @ApiPropertyOptional({description: 'Creator TaskUser ID (uuid)', type: String})
  creatorId?: string | null;

  @ApiPropertyOptional({description: 'Assignee TaskUser ID (uuid)', type: String})
  assigneeId?: string | null;

  @ApiPropertyOptional({description: 'Source requirement breakdown attempt ID', type: Number})
  requirementId?: number | null;

  @ApiPropertyOptional({description: 'ID of the last operator', type: String})
  lastOperatorId?: string | null;

  @ApiPropertyOptional({description: 'Display name of the last operator', type: String})
  lastOperatorName?: string | null;

  @ApiPropertyOptional({description: 'Source of the last operator, e.g. LARK | SYSTEM', type: String})
  lastOperatorSource?: string | null;
}

export class TaskWithRelationsDto extends TaskDto {
  @ApiPropertyOptional({type: TaskUserDto, description: 'Task creator'})
  creator?: TaskUserDto | null;

  @ApiPropertyOptional({type: TaskUserDto, description: 'Task assignee'})
  assignee?: TaskUserDto | null;

  @ApiPropertyOptional({type: TaskProjectDto, description: 'Owning task project'})
  taskProject?: TaskProjectDto | null;
}

export class TaskMemberStatsDto {
  @ApiProperty({description: 'Total active tasks assigned'})
  total: number;

  @ApiProperty({description: 'Completed task count'})
  completed: number;

  @ApiProperty({description: 'In-progress task count'})
  inProgress: number;
}

export class TaskMemberDto {
  @ApiProperty({description: 'TaskUser ID (uuid)'})
  id: string;

  @ApiPropertyOptional({description: 'Display name', type: String})
  name?: string | null;

  @ApiPropertyOptional({description: 'Avatar URL', type: String})
  avatarUrl?: string | null;

  @ApiPropertyOptional({description: 'Nightwatch account email, null when unlinked', type: String})
  email?: string | null;

  @ApiPropertyOptional({description: 'Nightwatch display name/username, null when unlinked', type: String})
  systemUsername?: string | null;

  @ApiProperty({type: TaskMemberStatsDto})
  taskStats: TaskMemberStatsDto;

  @ApiProperty({type: Date})
  createdAt: Date;
}

export class WeeklyReportDto {
  @ApiProperty({description: 'Weekly report ID (uuid)'})
  id: string;

  @ApiProperty({description: 'Year, e.g. 2026'})
  year: number;

  @ApiProperty({description: 'ISO week number'})
  week: number;

  @ApiProperty({description: 'Weekly report content'})
  content: string;

  @ApiProperty({type: Date})
  createdAt: Date;

  @ApiProperty({type: Date})
  updatedAt: Date;

  @ApiProperty({description: 'TaskGroup ID (uuid)'})
  groupId: string;

  @ApiProperty({description: 'Author TaskUser ID (uuid)'})
  userId: string;
}

export class WeeklyReportWithUserDto extends WeeklyReportDto {
  @ApiProperty({type: TaskUserDto, description: 'Report author'})
  user: TaskUserDto;
}

export class MonthlyReportDto {
  @ApiProperty({description: 'Monthly report ID (uuid)'})
  id: string;

  @ApiProperty({description: 'Year, e.g. 2026'})
  year: number;

  @ApiProperty({description: 'Month, 1-12'})
  month: number;

  @ApiProperty({description: 'Monthly report content'})
  content: string;

  @ApiProperty({type: Date})
  createdAt: Date;

  @ApiProperty({type: Date})
  updatedAt: Date;

  @ApiProperty({description: 'TaskProject ID (uuid)'})
  projectId: string;
}

// ── Envelope responses ({success, data?[, message]}) ──

export class TaskUsersListResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({type: [TaskUserListItemDto]})
  data: TaskUserListItemDto[];
}

export class TaskUserDataResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiPropertyOptional({type: TaskUserDto, description: 'Linked TaskUser, null when not linked'})
  data?: TaskUserDto | null;
}

export class LinkTaskUserResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiPropertyOptional({type: TaskUserDto, description: 'Present on success'})
  data?: TaskUserDto;

  @ApiPropertyOptional({type: String, description: 'Error message, present when success is false'})
  message?: string;
}

export class TaskProjectsListResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({type: [TaskProjectListItemDto]})
  data: TaskProjectListItemDto[];
}

export class TaskProjectDataResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiPropertyOptional({type: TaskProjectDto, description: 'Linked TaskProject, null when not linked'})
  data?: TaskProjectDto | null;
}

export class LinkTaskProjectResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiPropertyOptional({type: TaskProjectDto, description: 'Present on success'})
  data?: TaskProjectDto;

  @ApiPropertyOptional({type: String, description: 'Error message, present when success is false'})
  message?: string;
}

export class MembersResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({type: [TaskMemberDto]})
  data: TaskMemberDto[];
}

export class PaginatedTasksDto {
  @ApiProperty({type: [TaskWithRelationsDto]})
  records: TaskWithRelationsDto[];

  @ApiProperty({description: 'Total record count'})
  total: number;

  @ApiProperty({description: 'Current page, 0-based'})
  page: number;

  @ApiProperty({description: 'Page size'})
  pageSize: number;
}

export class TasksResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({type: PaginatedTasksDto})
  data: PaginatedTasksDto;
}

export class CreateTaskResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({type: TaskDto})
  data: TaskDto;
}

export class PaginatedWeeklyReportsDto {
  @ApiProperty({type: [WeeklyReportWithUserDto]})
  records: WeeklyReportWithUserDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;
}

export class WeeklyReportsResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({type: PaginatedWeeklyReportsDto})
  data: PaginatedWeeklyReportsDto;
}

export class PaginatedMonthlyReportsDto {
  @ApiProperty({type: [MonthlyReportDto]})
  records: MonthlyReportDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;
}

export class MonthlyReportsResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({type: PaginatedMonthlyReportsDto})
  data: PaginatedMonthlyReportsDto;
}

export class UpdateMonthlyReportResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({type: MonthlyReportDto})
  data: MonthlyReportDto;
}

export class GenerateMonthlyReportResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiPropertyOptional({type: String, description: 'Success message'})
  message?: string;

  @ApiPropertyOptional({type: Number, description: 'Report year'})
  year?: number;

  @ApiPropertyOptional({type: Number, description: 'Report month'})
  month?: number;

  @ApiPropertyOptional({type: String, description: 'Error message when generation fails'})
  error?: string;
}
