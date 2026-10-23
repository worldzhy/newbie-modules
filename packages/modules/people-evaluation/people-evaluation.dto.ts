import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDate, IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, ValidateIf } from "class-validator";
import { PeopleEvidenceSourceType, PeoplePeriodType } from "@generated/prisma/client";

// --- Rubric versions ---------------------------------------------------

export class CreateRubricVersionDto {
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
}

export class RubricVersionDto {
  @ApiProperty() id!: string;
  @ApiProperty() version!: string;
  @ApiProperty() publishedAt!: Date;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() companyDirectionStatement!: string;
  @ApiProperty() createdAt!: Date;
}

// --- Evaluation periods ------------------------------------------------

export class CreateEvaluationPeriodDto {
  @ApiProperty({ description: "Rubric version this period scores against" })
  @IsUUID()
  @IsNotEmpty()
  rubricVersionId!: string;

  @ApiProperty({ enum: PeoplePeriodType })
  @ValidateIf(() => true)
  @IsEnum(PeoplePeriodType)
  type!: PeoplePeriodType;

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

export class ListPeriodsQueryDto {
  @ApiPropertyOptional({ enum: PeoplePeriodType, description: "Filter by period type" })
  @IsOptional()
  @IsEnum(PeoplePeriodType)
  type?: PeoplePeriodType;
}

export class EvaluationPeriodDto {
  @ApiProperty() id!: string;
  @ApiProperty() rubricVersionId!: string;
  @ApiProperty() type!: PeoplePeriodType;
  @ApiProperty() periodStart!: Date;
  @ApiProperty() periodEnd!: Date;
  @ApiProperty() status!: string;
}

// --- Evidence ----------------------------------------------------------

export class RecordEvidenceDto {
  @ApiProperty({ description: "Who this evidence belongs to (evaluatee userId)" })
  @IsUUID()
  @IsNotEmpty()
  evaluateeUserId!: string;

  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  collectionPeriodId!: string;

  @ApiProperty({ enum: PeopleEvidenceSourceType })
  @ValidateIf(() => true)
  @IsEnum(PeopleEvidenceSourceType)
  sourceType!: PeopleEvidenceSourceType;

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
}
