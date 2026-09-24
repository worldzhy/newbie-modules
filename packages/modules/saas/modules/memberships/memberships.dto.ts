import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import {ApiProperty} from '@nestjs/swagger';
import {Membership} from '@prisma/client';
import {Expose} from '../../helpers/interfaces';
import {expose} from '../../helpers/expose';
import {
  CommonPaginationReqDto,
  CommonPaginationResDto,
} from '@devbie/newbie/common.dto';

export class MembershipsListReqDto extends CommonPaginationReqDto {}

export class MembershipsListResDto {
  @ApiProperty({
    type: expose<Membership>,
    isArray: true,
  })
  records: Expose<Membership>[];

  @ApiProperty({
    type: CommonPaginationResDto,
  })
  pagination: CommonPaginationResDto;
}

export class UpdateMembershipDto {
  @IsString()
  @IsIn(['OWNER', 'ADMIN', 'MEMBER'])
  @IsOptional()
  role?: 'OWNER' | 'ADMIN' | 'MEMBER';
}

export class CreateTeamMembershipDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsOptional()
  @MinLength(3)
  name?: string;

  @IsString()
  @IsIn(['OWNER', 'ADMIN', 'MEMBER'])
  @IsOptional()
  role?: 'OWNER' | 'ADMIN' | 'MEMBER';
}
