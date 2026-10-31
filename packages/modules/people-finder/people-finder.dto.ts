import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsString, IsOptional, IsArray, IsBoolean, IsUrl, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class ContactSearchPeopleBase {
  @ApiProperty({
    type: String,
  })
  @IsString()
  userId!: string;

  @ApiProperty({
    type: String,
  })
  @IsString()
  userSource!: string;

  @ApiPropertyOptional({
    type: String,
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    type: String,
  })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional({
    type: String,
  })
  @IsString()
  @IsOptional()
  middleName?: string;

  @ApiPropertyOptional({
    type: String,
  })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiPropertyOptional({
    type: String,
  })
  @IsString()
  @IsOptional()
  companyDomain?: string;

  @ApiPropertyOptional({
    type: String,
  })
  @IsString()
  @IsOptional()
  linkedin?: string;
}
export class PeopleFinderCallThirdPartyDto extends ContactSearchPeopleBase {}

export class ContactSearchPeopleTaskDto extends ContactSearchPeopleBase {
  // @ApiProperty({
  //   type: Boolean,
  //   required: false,
  // })
  // @IsBoolean()
  // @IsOptional()
  // findPhone?: boolean;
  // @ApiProperty({
  //   type: Boolean,
  //   required: false,
  // })
  // @IsBoolean()
  // @IsOptional()
  // findEmail?: boolean;
}

export class CreateContactSearchTaskBatchReqDto {
  @ApiProperty({
    type: ContactSearchPeopleTaskDto,
    isArray: true,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactSearchPeopleTaskDto)
  peoples!: ContactSearchPeopleTaskDto[];

  @ApiPropertyOptional({
    type: Boolean,
  })
  @IsBoolean()
  @IsOptional()
  findPhone?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
  })
  @IsBoolean()
  @IsOptional()
  findEmail?: boolean;

  @ApiProperty({
    type: String,
  })
  @IsString()
  batchId!: string;

  @ApiPropertyOptional({
    type: String,
  })
  @IsUrl({ protocols: ["http", "https"], require_protocol: true })
  @IsOptional()
  callbackUrl?: string;
}
