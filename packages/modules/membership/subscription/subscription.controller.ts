import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { PERMISSION_AUTHORIZER, PermissionAuthorizer } from "@modules/security/ports/permission.authorizer";
import { UserRequest } from "@modules/security/security.interface";
import { MembershipService } from "../membership.service";
import { SubscriptionService } from "./subscription.service";
import {
  CreateSubscriptionRequestDto,
  GetSubscriptionRequestDto,
  ListSubscriptionsRequestDto,
  ListSubscriptionsResponseDto,
  SubscriptionResponseDto,
} from "./subscription.dto";

@ApiTags("Membership / Subscription")
@ApiBearerAuth()
@Controller("subscriptions")
export class SubscriptionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membershipService: MembershipService,
    private readonly subscriptionService: SubscriptionService,
    @Optional() @Inject(PERMISSION_AUTHORIZER) private readonly authorizer?: PermissionAuthorizer,
  ) {}

  @Get()
  @ApiOperation({ summary: "List subscriptions — own by default, all for managers" })
  @ApiOkResponse({ type: ListSubscriptionsResponseDto })
  async listSubscriptions(@Query() query: ListSubscriptionsRequestDto, @Req() request: UserRequest) {
    const callerUserId = request.user.userId;
    // Managers hold List on Subscription and see the global ledger; everyone
    // else is pinned to their own membership so the member directory
    // (names/phones) never leaks across accounts.
    const canReadAll = await this.isAuthorized(callerUserId, PermissionAction.List);
    const result = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.Subscription,
      pagination: { page: query.page, pageSize: query.pageSize },
      ...(canReadAll ? {} : { findManyArgs: { where: { membership: { userId: callerUserId } } } }),
    });

    // Collect membership IDs
    const membershipIds = result.records.map((subscription) => subscription.membershipId);
    const memberships = await this.prisma.membership.findMany({
      where: { id: { in: membershipIds } },
      select: { id: true, cardNumber: true, userId: true },
    });

    // Map membershipId to cardNumber
    const membershipIdToCardNumber = new Map<string, string | null>();
    for (const membership of memberships) {
      membershipIdToCardNumber.set(membership.id, membership.cardNumber);
    }

    // Collect user IDs
    const userIds = memberships.map((membership) => membership.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, phone: true },
    });

    // Map membershipId to cardNumber, user name and phone
    const membershipIdToUserInfo = new Map<string, { name: string; phone: string; cardNumber: string | null }>();
    for (const membership of memberships) {
      const user = users.find((u) => u.id === membership.userId);
      membershipIdToUserInfo.set(membership.id, {
        cardNumber: membershipIdToCardNumber.get(membership.id) || null,
        name: user?.name || "Unknown",
        phone: user?.phone || "Unknown",
      });
    }

    // Attach user name and phone to each subscription record
    for (const subscription of result.records) {
      const userInfo = membershipIdToUserInfo.get(subscription.membershipId) || {
        cardNumber: null,
        name: "Unknown",
        phone: "Unknown",
      };

      (subscription as any).cardNumber = userInfo.cardNumber;
      (subscription as any).userName = userInfo.name;
      (subscription as any).userPhone = userInfo.phone;
    }

    return result;
  }

  @Post()
  @ApiOperation({ summary: "Create a new subscription" })
  @ApiCreatedResponse({ type: SubscriptionResponseDto })
  async createSubscription(@Body() body: CreateSubscriptionRequestDto, @Req() request: UserRequest) {
    const callerUserId = request.user.userId;
    if (body.userId !== callerUserId && !(await this.isAuthorized(callerUserId, PermissionAction.Create))) {
      throw new ForbiddenException("Creating a subscription for another member requires manager permission.");
    }

    // [step 1] Find or create the membership for the user
    let membership = await this.prisma.membership.findUnique({
      where: { userId: body.userId },
      select: { id: true },
    });
    if (!membership) {
      membership = await this.membershipService.createMembership({
        userId: body.userId,
      });
    }

    // [step 2] Create the subscription — always PENDING_PAYMENT; only the
    // payment callback (wechat-subscriptions) may move the status forward.
    return await this.subscriptionService.createSubscription({
      membershipId: membership.id,
      planId: body.planId,
    });
  }

  @Delete(":id")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.Subscription)
  @ApiOperation({ summary: "Delete a subscription" })
  @ApiOkResponse({ type: SubscriptionResponseDto })
  async deleteSubscriptionPlan(@Param() params: GetSubscriptionRequestDto) {
    return await this.prisma.subscription.delete({ where: { id: params.id } });
  }

  private async isAuthorized(userId: string, action: PermissionAction): Promise<boolean> {
    if (!this.authorizer) return false;
    return this.authorizer.authorize(userId, { resource: Prisma.ModelName.Subscription, action });
  }

  /* End */
}
