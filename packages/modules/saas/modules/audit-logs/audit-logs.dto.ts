import {ApiProperty} from '@nestjs/swagger';
import {
  CommonPaginationReqDto,
  CommonPaginationResDto,
} from '@devbie/newbie/common.dto';
import {AuditLog} from '@prisma/client';
import {Expose} from '../../helpers/interfaces';
import {expose} from '../../helpers/expose';

export class AuditLogsListReqDto extends CommonPaginationReqDto {}

export class AuditLogsListResDto {
  @ApiProperty({
    type: expose<AuditLog>,
    isArray: true,
  })
  records: Expose<AuditLog>[];

  @ApiProperty({
    type: CommonPaginationResDto,
  })
  pagination: CommonPaginationResDto;
}
