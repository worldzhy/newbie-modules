import {Body, Controller, Delete, Get, Param, Patch, Query, Req} from '@nestjs/common';
import {ApiBearerAuth, ApiOperation, ApiTags} from '@nestjs/swagger';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {Prisma, SubscriptionStatus} from '@generated/prisma/client';
import {GetMembershipRequestDto, ListMembershipLevelsRequestDto, UpdateMembershipRequestDto} from './membership.dto';

@ApiTags('Membership')
@ApiBearerAuth()
@Controller('memberships')
export class MembershipController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  @ApiOperation({summary: 'Get membership information for the current user'})
  async getMembership(@Req() req) {
    // [step 1] Find membership by userId
    const membership = await this.prisma.membership.findUnique({
      where: {userId: req.user.id},
      select: {id: true},
    });
    if (!membership) {
      return null;
    }

    // [step 2] Expire old subscriptions
    await this.prisma.subscription.updateMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        dateOfEnd: {lt: new Date()},
        membershipId: membership.id,
      },
      data: {status: SubscriptionStatus.EXPIRED},
    });

    // [step 3] Get the membership with active subscriptions
    return await this.prisma.membership.findUniqueOrThrow({
      where: {id: membership.id},
      include: {subscriptions: {where: {status: SubscriptionStatus.ACTIVE}}},
    });
  }

  @Get()
  @ApiOperation({summary: 'List all memberships'})
  async listMemberships(@Query() query: ListMembershipLevelsRequestDto) {
    return await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.Membership,
      pagination: {page: query.page, pageSize: query.pageSize},
    });
  }

  @Patch(':id')
  @ApiOperation({summary: 'Update an existing membership'})
  async updateMembership(@Param() params: GetMembershipRequestDto, @Body() body: UpdateMembershipRequestDto) {
    return await this.prisma.membership.update({
      where: {id: params.id},
      data: body,
    });
  }

  @Delete(':id')
  @ApiOperation({summary: 'Delete a membership'})
  async deleteMembership(@Param() params: GetMembershipRequestDto) {
    return await this.prisma.membership.delete({where: {id: params.id}});
  }
}
