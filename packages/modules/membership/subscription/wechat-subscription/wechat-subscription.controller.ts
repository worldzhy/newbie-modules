import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {Body, Controller, Param, Patch, Post} from '@nestjs/common';
import {ApiBearerAuth, ApiOperation, ApiTags} from '@nestjs/swagger';
import {GuardByApiKey} from '@microservices/account/security/passport/api-key/api-key.decorator';
import {MembershipService} from '@microservices/membership/membership.service';
import {SubscriptionService} from '@microservices/membership/subscription/subscription.service';
import {SubscriptionStatus} from '@generated/prisma/client';
import {
  CreateWechatSubscriptionRequestDto,
  GetWechatSubscriptionRequestDto,
  UpdateWechatSubscriptionRequestDto,
} from './wechat-subscription.dto';

@ApiTags('Membership / Subscription')
@ApiBearerAuth()
@Controller('wechat-subscriptions')
export class WechatSubscriptionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membershipService: MembershipService,
    private readonly subscriptionService: SubscriptionService
  ) {}

  @GuardByApiKey()
  @Post()
  @ApiOperation({summary: 'Create a new subscription'})
  async createSubscription(@Body() body: CreateWechatSubscriptionRequestDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: {wechatOpenId: body.wechatOpenId},
    });

    // [step 1] Find or create the membership for the user
    let membership = await this.prisma.membership.findUnique({
      where: {userId: user.id},
      select: {id: true},
    });
    if (!membership) {
      membership = await this.membershipService.createMembership({
        userId: user.id,
      });
    }

    // [step 2] Check if there's an existing active subscription for the plan
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        membershipId: membership.id,
        planId: body.planId,
        status: SubscriptionStatus.PENDING_PAYMENT,
      },
    });
    if (subscription) {
      return subscription;
    }

    // [step 3] Create the subscription
    return await this.subscriptionService.createSubscription({
      membershipId: membership.id,
      planId: body.planId,
    });
  }

  @GuardByApiKey()
  @Patch(':id')
  @ApiOperation({summary: 'Update an existing subscription'})
  async updateSubscription(
    @Param() params: GetWechatSubscriptionRequestDto,
    @Body() body: UpdateWechatSubscriptionRequestDto
  ) {
    return await this.prisma.subscription.update({
      where: {id: params.id},
      data: body,
    });
  }

  /* End */
}
