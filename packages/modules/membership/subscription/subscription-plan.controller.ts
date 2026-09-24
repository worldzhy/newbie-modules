import {Body, Controller, Delete, Get, Param, Patch, Post} from '@nestjs/common';
import {ApiBearerAuth, ApiOperation, ApiTags} from '@nestjs/swagger';
import {Prisma} from '@generated/prisma/client';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {
  CreateSubscriptionPlanRequestDto,
  GetSubscriptionPlanRequestDto,
  UpdateSubscriptionPlanRequestDto,
} from './subscription.dto';

@ApiTags('Membership / Subscription')
@ApiBearerAuth()
@Controller('subscriptions/plans')
export class SubscriptionPlanController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({summary: 'List all subscription plans'})
  async listSubscriptionPlans() {
    return await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.SubscriptionPlan,
      pagination: {page: 0, pageSize: 1000},
    });
  }

  @Post()
  @ApiOperation({summary: 'Create a new subscription plan'})
  async createSubscriptionPlan(@Body() body: CreateSubscriptionPlanRequestDto) {
    return await this.prisma.subscriptionPlan.create({data: body});
  }

  @Patch(':id')
  @ApiOperation({summary: 'Update an existing subscription plan'})
  async updateSubscriptionPlan(
    @Param() params: GetSubscriptionPlanRequestDto,
    @Body() body: UpdateSubscriptionPlanRequestDto
  ) {
    return await this.prisma.subscriptionPlan.update({
      where: {id: params.id},
      data: body,
    });
  }

  @Delete(':id')
  @ApiOperation({summary: 'Delete a subscription plan'})
  async deleteSubscriptionPlan(@Param() params: GetSubscriptionPlanRequestDto) {
    return await this.prisma.subscriptionPlan.delete({where: {id: params.id}});
  }
}
