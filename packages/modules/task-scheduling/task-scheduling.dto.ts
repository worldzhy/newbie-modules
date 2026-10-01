import { ApiProperty } from "@nestjs/swagger";

export class ScheduledJobDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ description: "Unique job key, e.g. daily-aws-audit-scan" })
  key: string;

  @ApiProperty({ description: "Key of the in-process handler that executes the job" })
  handlerKey: string;

  @ApiProperty({ description: "Cron expression, e.g. 0 3 * * *" })
  cronExpr: string;

  @ApiProperty()
  timezone: string;

  @ApiProperty()
  enabled: boolean;

  @ApiProperty({ type: Object, required: false, nullable: true })
  payload?: unknown;

  @ApiProperty({ description: "How the job was created", example: "declaration" })
  createdVia: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class ScheduledJobRunDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  jobId: number;

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

export class UpdateScheduledJobDto {
  @ApiProperty({ required: false, description: "Enable or pause the job" })
  enabled?: boolean;

  @ApiProperty({ required: false, description: "Cron expression, e.g. 0 3 * * *" })
  cronExpr?: string;

  @ApiProperty({ required: false, description: "IANA timezone, e.g. Asia/Shanghai" })
  timezone?: string;
}

export class ListScheduledJobRunsDto {
  @ApiProperty({ required: false, default: 50, description: "Maximum runs to return (1-200)" })
  limit?: string;
}
