import { Controller, Delete, Get, Param, ParseIntPipe, Post, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import Stripe from "stripe";
import { CursorPipe } from "@devbie/newbie/pipes/cursor.pipe";
import { OptionalIntPipe } from "@devbie/newbie/pipes/optional-int.pipe";
import { AuditLog } from "../audit-logs/audit-log.decorator";
import { Scopes } from "../auth/scope.decorator";
import { StripeService } from "./stripe.service";

@ApiTags("Teams Subscriptions")
@Controller("teams/:teamId/subscriptions")
export class StripeSubscriptionController {
  constructor(private stripeService: StripeService) {}

  /** Create a subscription for a team */
  @Post(":plan")
  @ApiCreatedResponse()
  @AuditLog("create-subscription")
  @Scopes("team-{teamId}:write-subscription-*")
  async create(
    @Param("teamId", ParseIntPipe) teamId: number,
    @Param("plan") plan: string,
  ): Promise<Stripe.Checkout.Session> {
    return this.stripeService.createSession(teamId, "subscription", plan);
  }

  /** Get subscriptions for a team */
  @Get()
  @ApiOkResponse()
  @Scopes("team-{teamId}:read-subscription-*")
  async getAll(
    @Param("teamId", ParseIntPipe) teamId: number,
    @Query("take", OptionalIntPipe) take?: number,
    @Query("cursor", CursorPipe) cursor?: { id: string },
  ): Promise<Stripe.Subscription[]> {
    return this.stripeService.getSubscriptions(teamId, { take, cursor });
  }

  /** Get a subscription for a team */
  @Get(":id")
  @ApiOkResponse()
  @Scopes("team-{teamId}:read-subscription-{id}")
  async get(@Param("teamId", ParseIntPipe) teamId: number, @Param("id") id: string): Promise<Stripe.Subscription> {
    return this.stripeService.getSubscription(teamId, id);
  }

  /** Cancel a subscription for a team */
  @Delete(":id")
  @ApiOkResponse()
  @AuditLog("delete-subscription")
  @Scopes("team-{teamId}:delete-subscription-{id}")
  async remove(@Param("teamId", ParseIntPipe) teamId: number, @Param("id") id: string): Promise<Stripe.Subscription> {
    return this.stripeService.cancelSubscription(teamId, id);
  }

  /** Get subscription plans for a team */
  @Get("plans")
  @ApiOkResponse()
  @Scopes("team-{teamId}:write-subscription-*")
  async getPlans(
    @Param("teamId", ParseIntPipe) teamId: number,
    @Query("product") product?: string,
  ): Promise<Stripe.Plan[]> {
    return this.stripeService.plans(teamId, product);
  }
}
