import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiCreatedResponse, ApiOkResponse } from "@nestjs/swagger";
import {
  CreateOrderRequestDto,
  CreateOrderResponseDto,
  ListOrdersRequestDto,
  ListOrdersResponseDto,
} from "./order.dto";
import { OrderEntity } from "./order.entity";
import { OrderService } from "./order.service";
import { TokenService } from "@modules/security/token/token.service";
import { Request } from "express";
import { Prisma } from "@generated/prisma/client";

@ApiTags("Order Management")
@ApiBearerAuth()
@Controller("orders")
export class OrderController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService,
    private readonly tokenService: TokenService,
  ) {}

  @Post("")
  @ApiCreatedResponse({ type: CreateOrderResponseDto })
  async createOrder(@Req() request: Request, @Body() body: CreateOrderRequestDto) {
    const userId = this.requireUserId(request);

    return await this.orderService.create({
      paymentMethod: body.paymentMethod,
      items: body.items,
      note: body.note,
      userId,
    });
  }

  @Get(":id")
  @ApiOkResponse({ type: OrderEntity })
  async getOrder(@Req() request: Request, @Param("id") id: string) {
    const userId = this.requireUserId(request);
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) {
      throw new NotFoundException("Order not found");
    }
    // Orders are private to their owner; the id in the path is not a capability.
    if (order.userId !== userId) {
      throw new ForbiddenException("You cannot access another user's order.");
    }

    // Attach imageFileId to each order item
    for (const item of order.items) {
      const product = await this.prisma.product.findUnique({
        where: { skuId: item.skuId },
        select: { imageFileId: true },
      });
      item["imageFileId"] = product ? product.imageFileId : null;
    }

    return order;
  }

  @Get("")
  @ApiOkResponse({ type: ListOrdersResponseDto })
  async list(@Req() request: Request, @Query() query: ListOrdersRequestDto) {
    const userId = this.requireUserId(request);
    // `userId` is never read from the query: a caller may only list their own
    // orders (the previous `?userId=` parameter was an IDOR).
    const result = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.Order,
      pagination: query,
      findManyArgs: {
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { items: true },
      },
    });

    // Fetch user information for each order
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: result.records.map((order) => order.userId) },
      },
      select: {
        id: true,
        name: true,
      },
    });

    // Attach user information to each order
    result.records.forEach((order) => {
      const user = users.find((u) => u.id === order.userId);
      order.userName = user ? user.name : "Unknown User";
    });

    return result;
  }

  @Delete(":id")
  @ApiOkResponse({ type: OrderEntity })
  async deleteOrder(@Req() request: Request, @Param("id") id: string) {
    const userId = this.requireUserId(request);
    const order = await this.prisma.order.findUnique({ where: { id }, select: { id: true, userId: true } });
    if (!order) {
      throw new NotFoundException("Order not found");
    }
    if (order.userId !== userId) {
      throw new ForbiddenException("You cannot delete another user's order.");
    }

    return await this.prisma.order.delete({
      where: { id },
    });
  }

  /**
   * Order status (paid / refund*) is intentionally NOT settable over HTTP here.
   * Payment state may only be advanced by a verified payment callback — the
   * API-key-guarded wechat-workflow controller — never by the order owner.
   */
  private requireUserId(request: Request): string {
    const accessToken = this.tokenService.getTokenFromHttpRequest(request);
    if (!accessToken) {
      throw new UnauthorizedException("Access token is required.");
    }
    return this.tokenService.verifyUserAccessToken(accessToken).userId;
  }

  /* End */
}
