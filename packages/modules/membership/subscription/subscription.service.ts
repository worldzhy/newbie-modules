import {Injectable} from '@nestjs/common';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {BillingCycle} from '@generated/prisma/client';

@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  async createSubscription(params: {membershipId: string; planId: number}) {
    // [step 1] Find the subscription plan
    const plan = await this.prisma.subscriptionPlan.findUniqueOrThrow({
      where: {id: params.planId},
    });

    // [step 2] Create the subscription
    const dateOfStart = new Date();
    let dateOfEnd: Date;
    if (plan.billingCycle === BillingCycle.MONTHLY) {
      dateOfEnd = new Date(dateOfStart);
      dateOfEnd.setMonth(dateOfStart.getMonth() + 1);
    } else if (plan.billingCycle === BillingCycle.QUARTERLY) {
      dateOfEnd = new Date(dateOfStart);
      dateOfEnd.setMonth(dateOfStart.getMonth() + 3);
    } else if (plan.billingCycle === BillingCycle.ANNUALLY) {
      dateOfEnd = new Date(dateOfStart);
      dateOfEnd.setFullYear(dateOfStart.getFullYear() + 1);
    } else if (plan.billingCycle === BillingCycle.LIFETIME) {
      dateOfEnd = new Date(dateOfStart);
      dateOfEnd.setFullYear(dateOfStart.getFullYear() + 20);
    } else {
      throw new Error('Unsupported billing cycle');
    }

    return await this.prisma.subscription.create({
      data: {
        dateOfStart,
        dateOfEnd,
        paymentAmountInCents: plan.priceInCents,
        membershipId: params.membershipId,
        planId: plan.id,
      },
    });
  }

  /* End */
}
