import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString } from "class-validator";

export class JobScheduleDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ description: "Unique schedule key, e.g. aws-audit" })
  key: string;

  @ApiProperty({ description: "Human-readable display name declared by the job", example: "AWS Audit Scan" })
  name: string;

  @ApiProperty({ description: "Key of the in-process job handler that executes the schedule" })
  handlerKey: string;

  @ApiProperty({ description: "Cron expression, e.g. 0 3 * * *" })
  cronExpr: string;

  @ApiProperty()
  timezone: string;

  @ApiProperty()
  enabled: boolean;

  @ApiProperty({ type: Object, required: false, nullable: true })
  payload?: unknown;

  @ApiProperty({ description: "How the schedule was created", example: "declaration" })
  createdVia: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class JobRunDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  scheduleId: number;

  @ApiProperty({ enum: ["schedule", "manual"] })
  trigger: string;

  @ApiProperty({ enum: ["running", "success", "failed", "skipped"] })
  status: string;

  @ApiProperty()
  startedAt: Date;

  @ApiProperty({ nullable: true, type: String, format: "date-time" })
  finishedAt: Date | null;

  @ApiProperty({ nullable: true, type: Number })
  durationMs: number | null;

  @ApiProperty({ nullable: true, type: String })
  error: string | null;
}

export class UpdateJobScheduleDto {
  @ApiProperty({ required: false, description: "Enable or pause the schedule" })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ required: false, description: "Cron expression, e.g. 0 3 * * *" })
  @IsOptional()
  @IsString()
  cronExpr?: string;

  @ApiProperty({ required: false, description: "IANA timezone, e.g. Asia/Shanghai" })
  @IsOptional()
  @IsString()
  timezone?: string;
}

export class ListJobRunsDto {
  @ApiProperty({ required: false, default: 50, description: "Maximum runs to return (1-200)" })
  limit?: string;
}
