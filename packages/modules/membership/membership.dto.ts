import {IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID} from 'class-validator';
import {ApiProperty} from '@nestjs/swagger';
import {CommonListRequestDto} from '@devbie/newbie/common.dto';

// Membership Level Dtos
export class ListMembershipLevelsRequestDto extends CommonListRequestDto {}

export class CreateMembershipLevelRequestDto {
  @ApiProperty({type: String, required: true})
  @IsString()
  name: string;

  @ApiProperty({type: Number, required: true})
  @IsNumber()
  requiredPoints: number;

  @ApiProperty({type: Number, required: true})
  @IsNumber()
  discountRate: number;
}

export class UpdateMembershipLevelRequestDto {
  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  name: string;

  @ApiProperty({type: Number, required: false})
  @IsNumber()
  @IsOptional()
  requiredPoints: number;

  @ApiProperty({type: Number, required: false})
  @IsNumber()
  @IsOptional()
  discountRate: number;
}

export class GetMembershipLevelRequestDto {
  @ApiProperty({type: Number, required: true})
  @IsNumber()
  id: number;
}

// Membership Dtos
export class ListMembershipsRequestDto extends CommonListRequestDto {}

export class CreateMembershipRequestDto {
  @ApiProperty({type: String, required: true})
  @IsUUID()
  @IsNotEmpty()
  userId: string;
}

export class UpdateMembershipRequestDto {
  @ApiProperty({type: Number, required: false})
  @IsNumber()
  @IsOptional()
  points?: number;

  @ApiProperty({type: Number, required: false})
  @IsNumber()
  @IsOptional()
  levelId?: number;
}

export class GetMembershipRequestDto {
  @ApiProperty({type: String, required: true})
  @IsString()
  id: string;
}
