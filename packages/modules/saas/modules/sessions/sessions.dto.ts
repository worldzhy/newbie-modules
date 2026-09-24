import {ApiProperty} from '@nestjs/swagger';
import {Session} from '@prisma/client';
import {Expose} from '../../helpers/interfaces';
import {expose} from '../../helpers/expose';
import {
  CommonPaginationReqDto,
  CommonPaginationResDto,
} from '@devbie/newbie/common.dto';

export class SessionsListReqDto extends CommonPaginationReqDto {}

export class SessionsListResDto {
  @ApiProperty({
    type: expose<Session>,
    isArray: true,
  })
  records: Expose<Session>[];

  @ApiProperty({
    type: CommonPaginationResDto,
  })
  pagination: CommonPaginationResDto;
}
