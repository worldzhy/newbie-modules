import {Global, Module} from '@nestjs/common';
import {MembershipLevelController} from './membership-level.controller';
import {MembershipController} from './membership.controller';
import {MembershipService} from './membership.service';
import {SubscriptionPlanController} from './subscription/subscription-plan.controller';
import {SubscriptionController} from './subscription/subscription.controller';
import {SubscriptionService} from './subscription/subscription.service';
import {WechatSubscriptionController} from './subscription/wechat-subscription/wechat-subscription.controller';

@Global()
@Module({
  controllers: [
    MembershipLevelController,
    MembershipController,
    SubscriptionPlanController,
    SubscriptionController,
    WechatSubscriptionController,
  ],
  providers: [MembershipService, SubscriptionService],
  exports: [MembershipService, SubscriptionService],
})
export class MembershipModule {}
