import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { EvidenceSourceType, PeriodStatus, PeriodType } from "@generated/prisma/client";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";

// --- Rubric versions ---------------------------------------------------

export class CreatePeopleEvaluationDimensionRequestDto {
  @ApiProperty({ description: 'Unique dimension key inside the rubric, e.g. "architecture-design"' })
  @IsString()
  @IsNotEmpty()
  dimensionKey!: string;

  @ApiProperty({ description: "Human-readable dimension name" })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ description: "Lower anchor of the expected score band" })
  @IsOptional()
  @IsNumber()
  anchorLow?: number;

  @ApiPropertyOptional({ description: "Upper anchor of the expected score band" })
  @IsOptional()
  @IsNumber()
  anchorHigh?: number;

  @ApiPropertyOptional({ description: "Full-load reference baseline, published ex ante" })
  @IsOptional()
  @IsString()
  fullLoadBaseRef?: string;

  @ApiPropertyOptional({ description: "Dimension description" })
  @IsOptional()
  @IsString()
  description?: string;
}

export class CreatePeopleEvaluationRubricVersionRequestDto {
  @ApiProperty({ description: 'Semantic version string, e.g. "v0.1"' })
  @IsString()
  @IsNotEmpty()
  version!: string;

  @ApiProperty({
    type: [CreatePeopleEvaluationDimensionRequestDto],
    isArray: true,
    description: "Dimensions of this rubric version — the single source of truth for scoring",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePeopleEvaluationDimensionRequestDto)
  dimensions!: CreatePeopleEvaluationDimensionRequestDto[];

  @ApiProperty({ description: "Floor rule thresholds JSON" })
  @IsObject()
  @IsNotEmpty()
  floorRules!: object;

  @ApiProperty({ description: "Company direction statement — anchor text for AI qualitative judgment" })
  @IsString()
  @IsNotEmpty()
  companyDirectionStatement!: string;

  @ApiPropertyOptional({ description: "Host calibration for machine scoring JSON (evidenceCap, scoreFloor)" })
  @IsOptional()
  @IsObject()
  scoringConfig?: object;

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

export class PeopleEvaluationDimensionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() dimensionKey!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() anchorLow?: number | null;
  @ApiPropertyOptional() anchorHigh?: number | null;
  @ApiPropertyOptional() fullLoadBaseRef?: string | null;
  @ApiPropertyOptional() description?: string | null;
}

export class CreatePeopleEvaluationRubricVersionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() version!: string;
  @ApiProperty() publishedAt!: Date;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() companyDirectionStatement!: string;
  @ApiPropertyOptional({ type: [PeopleEvaluationDimensionResponseDto], isArray: true })
  dimensions?: PeopleEvaluationDimensionResponseDto[];
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

  @ApiPropertyOptional({ enum: PeriodStatus, description: "Initial status — defaults to UPCOMING" })
  @IsOptional()
  @IsEnum(PeriodStatus)
  status?: PeriodStatus;

  @ApiPropertyOptional({
    type: [String],
    isArray: true,
    description: "COLLECTION period ids rolled up by this REVIEW period",
  })
  @IsOptional()
  @IsArray()
  @IsUUID("4", { each: true })
  collectionPeriodIds?: string[];
}

export class UpdatePeopleEvaluationPeriodStatusRequestDto {
  @ApiProperty({ enum: PeriodStatus })
  @ValidateIf(() => true)
  @IsEnum(PeriodStatus)
  status!: PeriodStatus;
}

export class ListPeopleEvaluationPeriodsRequestDto extends CommonListRequestDto {
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
  @ApiProperty({ enum: PeriodStatus }) status!: PeriodStatus;
  @ApiPropertyOptional({ type: [String], isArray: true }) collectionPeriodIds?: string[];
}

export class ListPeopleEvaluationPeriodsResponseDto extends CommonListResponseDto<CreatePeopleEvaluationPeriodResponseDto> {}

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
