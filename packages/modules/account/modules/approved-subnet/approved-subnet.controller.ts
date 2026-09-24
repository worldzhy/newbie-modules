import {Controller, Delete, Get, Param, Query} from '@nestjs/common';
import {ApiBearerAuth, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {ApprovedSubnet, Prisma} from '@generated/prisma/client';
import {CursorPipe} from '@devbie/newbie/pipes/cursor.pipe';
import {OrderByPipe} from '@devbie/newbie/pipes/order-by.pipe';
import {WherePipe} from '@devbie/newbie/pipes/where.pipe';
import {Expose} from '../../helpers/expose';
import {ApprovedSubnetResponseDto} from './approved-subnet.dto';
import {ApprovedSubnetService} from './approved-subnet.service';

@ApiTags('Account / Approved Subnet')
@ApiBearerAuth()
@Controller('users/:userId/approved-subnets')
export class ApprovedSubnetController {
  constructor(private approvedSubnetsService: ApprovedSubnetService) {}

  /** Get approved subnets for a user */
  @Get()
  @ApiOperation({summary: 'Get approved subnets for a user'})
  @ApiResponse({type: ApprovedSubnetResponseDto, isArray: true})
  async getAll(
    @Param('userId') userId: string,
    @Query('skip') skip?: number,
    @Query('take') take?: number,
    @Query('cursor', CursorPipe) cursor?: Prisma.ApprovedSubnetWhereUniqueInput,
    @Query('where', WherePipe) where?: Record<string, number | string>,
    @Query('orderBy', OrderByPipe) orderBy?: Record<string, 'asc' | 'desc'>
  ): Promise<Expose<ApprovedSubnet>[]> {
    return await this.approvedSubnetsService.getApprovedSubnets(userId, {
      skip,
      take,
      orderBy,
      cursor,
      where,
    });
  }

  /** Get an approved subnet for a user */
  @Get(':id')
  @ApiOperation({summary: 'Get an approved subnet by id'})
  @ApiResponse({type: ApprovedSubnetResponseDto})
  async get(@Param('userId') userId: string, @Param('id') id: number): Promise<Expose<ApprovedSubnet>> {
    return await this.approvedSubnetsService.getApprovedSubnet(userId, id);
  }

  /** Delete an approved subnet for a user */
  @Delete(':id')
  @ApiOperation({summary: 'Delete an approved subnet'})
  @ApiResponse({type: ApprovedSubnetResponseDto})
  async remove(@Param('userId') userId: string, @Param('id') id: number): Promise<Expose<ApprovedSubnet>> {
    return await this.approvedSubnetsService.deleteApprovedSubnet(userId, id);
  }
}
