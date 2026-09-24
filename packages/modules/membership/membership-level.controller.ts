import {Body, Controller, Delete, Get, Param, Patch, Post} from '@nestjs/common';
import {ApiBearerAuth, ApiOperation, ApiTags} from '@nestjs/swagger';
import {Prisma} from '@generated/prisma/client';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {
  CreateMembershipLevelRequestDto,
  GetMembershipLevelRequestDto,
  UpdateMembershipLevelRequestDto,
} from './membership.dto';

@ApiTags('Membership / Level')
@ApiBearerAuth()
@Controller('memberships/levels')
export class MembershipLevelController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({summary: 'List all membership levels'})
  async listMembershipLevels() {
    return await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.MembershipLevel,
      pagination: {page: 0, pageSize: 1000},
    });
  }

  @Post()
  @ApiOperation({summary: 'Create a new membership level'})
  async createMembershipLevel(@Body() body: CreateMembershipLevelRequestDto) {
    return await this.prisma.membershipLevel.create({data: body});
  }

  @Patch(':id')
  @ApiOperation({summary: 'Update an existing membership level'})
  async updateMembershipLevel(
    @Param() params: GetMembershipLevelRequestDto,
    @Body() body: UpdateMembershipLevelRequestDto
  ) {
    return await this.prisma.membershipLevel.update({
      where: {id: params.id},
      data: body,
    });
  }

  @Delete(':id')
  @ApiOperation({summary: 'Delete a membership level'})
  async deleteMembershipLevel(@Param() params: GetMembershipLevelRequestDto) {
    return await this.prisma.membershipLevel.delete({where: {id: params.id}});
  }
}
