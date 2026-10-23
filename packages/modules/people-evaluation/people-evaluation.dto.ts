import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from "class-validator";
import { EvidenceSourceType, PeriodType } from "@generated/prisma/client";

// --- Rubric versions ---------------------------------------------------

export class CreatePeopleEvaluationRubricVersionRequestDto {
  @ApiProperty({ description: 'Semantic version string, e.g. "v0.1"' })
  @IsString()
  @IsNotEmpty()
  version!: string;

  @ApiProperty({ description: "Per-dimension anchor config JSON" })
  @IsObject()
  @IsNotEmpty()
  dimensionConfig!: object;

  @ApiProperty({ description: "Per-dimension full-load baseline ref JSON" })
  @IsObject()
  @IsNotEmpty()
  fullLoadBaselines!: object;

  @ApiProperty({ description: "Floor rule thresholds JSON" })
  @IsObject()
  @IsNotEmpty()
  floorRules!: object;

  @ApiProperty({ description: "Company direction statement — anchor text for AI qualitative judgment" })
  @IsString()
  @IsNotEmpty()
  companyDirectionStatement!: string;

  @ApiPropertyOptional({ description: "Override rubric publish time — defaults to now" })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  publishedAt?: Date;

  @ApiPropertyOptional({ description: "Whether this version is active immediately — defaults to true" })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreatePeopleEvaluationRubricVersionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() version!: string;
  @ApiProperty() publishedAt!: Date;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() companyDirectionStatement!: string;
  @ApiProperty() createdAt!: Date;
}

// --- Evaluation periods ------------------------------------------------

export class CreatePeopleEvaluationPeriodRequestDto {
  @ApiProperty({ description: "Rubric version this period scores against" })
  @IsUUID()
  @IsNotEmpty()
  rubricVersionId!: string;

  @ApiProperty({ enum: PeriodType })
  @ValidateIf(() => true)
  @IsEnum(PeriodType)
  type!: PeriodType;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  periodStart!: Date;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  periodEnd!: Date;

  @ApiPropertyOptional({ description: 'Status hint — defaults to "upcoming"' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class ListPeopleEvaluationPeriodsRequestDto {
  @ApiPropertyOptional({ enum: PeriodType, description: "Filter by period type" })
  @IsOptional()
  @IsEnum(PeriodType)
  type?: PeriodType;
}

export class CreatePeopleEvaluationPeriodResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() rubricVersionId!: string;
  @ApiProperty() type!: PeriodType;
  @ApiProperty() periodStart!: Date;
  @ApiProperty() periodEnd!: Date;
  @ApiProperty() status!: string;
}

// --- Evidence ----------------------------------------------------------

export class RecordPeopleEvaluationEvidenceRequestDto {
  @ApiProperty({ description: "Who this evidence belongs to (evaluatee userId)" })
  @IsUUID()
  @IsNotEmpty()
  evaluateeUserId!: string;

  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  collectionPeriodId!: string;

  @ApiProperty({ enum: EvidenceSourceType })
  @ValidateIf(() => true)
  @IsEnum(EvidenceSourceType)
  sourceType!: EvidenceSourceType;

  @ApiPropertyOptional({ description: 'Source reference, e.g. "git:nw-backend"' })
  @IsOptional()
  @IsString()
  sourceRef?: string;

  @ApiPropertyOptional({ description: "Which evaluation dimension this feeds" })
  @IsOptional()
  @IsString()
  dimensionKey?: string;

  @ApiProperty({ description: "Source payload JSON" })
  @IsObject()
  @IsNotEmpty()
  payload!: object;

  @ApiPropertyOptional({ description: "Source event timestamp — defaults to now" })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  eventAt?: Date;
}
