import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";
import { SubscriptionResponseDto } from "./subscription/subscription.dto";

// Membership Level Dtos
export class ListMembershipLevelsRequestDto extends CommonListRequestDto {}

export class CreateMembershipLevelRequestDto {
  @ApiProperty({ type: String })
  @IsString()
  name!: string;

  @ApiProperty({ type: Number })
  @IsNumber()
  requiredPoints!: number;

  @ApiProperty({ type: Number })
  @IsNumber()
  discountRate!: number;
}

export class UpdateMembershipLevelRequestDto {
  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ type: Number })
  @IsNumber()
  @IsOptional()
  requiredPoints?: number;

  @ApiPropertyOptional({ type: Number })
  @IsNumber()
  @IsOptional()
  discountRate?: number;
}

export class GetMembershipLevelRequestDto {
  @ApiProperty({ type: Number })
  @IsNumber()
  id!: number;
}

export class MembershipLevelResponseDto {
  @ApiProperty({ type: Number })
  id!: number;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: Number })
  requiredPoints!: number;

  @ApiProperty({ type: Number })
  discountRate!: number;

  @ApiProperty({ type: Date })
  createdAt!: Date;

  @ApiProperty({ type: Date })
  updatedAt!: Date;
}

export class ListMembershipLevelsResponseDto extends CommonListResponseDto {
  @ApiProperty({ type: MembershipLevelResponseDto, isArray: true })
  declare records: MembershipLevelResponseDto[];
}

// Membership Dtos
export class ListMembershipsRequestDto extends CommonListRequestDto {}

export class CreateMembershipRequestDto {
  @ApiProperty({ type: String })
  @IsUUID()
  @IsNotEmpty()
  userId!: string;
}

export class UpdateMembershipRequestDto {
  @ApiPropertyOptional({ type: Number })
  @IsNumber()
  @IsOptional()
  points?: number;

  @ApiPropertyOptional({ type: Number })
  @IsNumber()
  @IsOptional()
  levelId?: number;
}

export class GetMembershipRequestDto {
  @ApiProperty({ type: String })
  @IsString()
  id!: string;
}

export class MembershipResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiPropertyOptional({ type: String })
  cardNumber?: string | null;

  @ApiProperty({ type: Number })
  points!: number;

  @ApiProperty({ type: String })
  userId!: string;

  @ApiPropertyOptional({ type: Number })
  levelId?: number | null;

  @ApiProperty({ type: Date })
  createdAt!: Date;

  @ApiProperty({ type: Date })
  updatedAt!: Date;

  @ApiPropertyOptional({ type: SubscriptionResponseDto, isArray: true })
  subscriptions?: SubscriptionResponseDto[];
}

export class ListMembershipsResponseDto extends CommonListResponseDto {
  @ApiProperty({ type: MembershipResponseDto, isArray: true })
  declare records: MembershipResponseDto[];
}
