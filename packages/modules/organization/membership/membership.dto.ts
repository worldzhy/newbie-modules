import {IsEmail, IsIn, IsNotEmpty, IsOptional, IsString} from 'class-validator';
import {OrgMembership, MembershipRole} from '@generated/prisma/client';
import {CommonListRequestDto, CommonListResponseDto} from '@devbie/newbie/common.dto';
import {ApiProperty} from '@nestjs/swagger';

export class ListMembershipsRequestDto extends CommonListRequestDto {}

export class ListMembershipsResponseDto extends CommonListResponseDto {
  @ApiProperty({
    type: Object,
    isArray: true,
  })
  declare records: OrgMembership[];
}

export class UpdateMembershipDto {
  @IsString()
  @IsIn(['OWNER', 'ADMIN', 'MEMBER'])
  @IsOptional()
  role?: 'OWNER' | 'ADMIN' | 'MEMBER';
}

export class CreateMembershipDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsIn(Object.keys(MembershipRole))
  @IsOptional()
  role?: MembershipRole;
}
