import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {Body, Controller, Delete, Get, Param, Patch, Post, Query, Req} from '@nestjs/common';
import {ApiTags, ApiBearerAuth, ApiResponse} from '@nestjs/swagger';
import {
  CreateOrderRequestDto,
  CreateOrderResponseDto,
  ListOrdersRequestDto,
  ListOrdersResponseDto,
  UpdateOrderResponseDto,
} from './order.dto';
import {OrderService} from './order.service';
import {TokenService} from '@modules/account/security/token/token.service';
import {Request} from 'express';
import {OrderStatus, Prisma} from '@generated/prisma/client';

@ApiTags('Order Management')
@ApiBearerAuth()
@Controller('orders')
export class OrderController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService,
    private readonly tokenService: TokenService
  ) {}

  @Post('')
  @ApiResponse({type: CreateOrderResponseDto})
  async createOrder(@Req() request: Request, @Body() body: CreateOrderRequestDto) {
    const accessToken = this.tokenService.getTokenFromHttpRequest(request);
    if (!accessToken) {
      throw new Error('Access token is required');
    }
    const userId = this.tokenService.verifyUserAccessToken(accessToken).userId;

    return await this.orderService.create({
      paymentMethod: body.paymentMethod,
      items: body.items,
      note: body.note,
      userId,
    });
  }

  @Get(':id')
  async getOrder(@Param('id') id: string) {
    const order = await this.prisma.order.findUnique({
      where: {id},
      include: {items: true},
    });
    if (!order) {
      throw new Error('Order not found');
    }

    // Attach imageFileId to each order item
    for (const item of order.items) {
      const product = await this.prisma.product.findUnique({
        where: {skuId: item.skuId},
        select: {imageFileId: true},
      });
      item['imageFileId'] = product ? product.imageFileId : null;
    }

    return order;
  }

  @Get('')
  @ApiResponse({type: ListOrdersResponseDto})
  async getOrders(@Query() query: ListOrdersRequestDto) {
    const result = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.Order,
      pagination: query,
      findManyArgs: {
        where: {userId: query.userId},
        orderBy: {createdAt: 'desc'},
        include: {items: true},
      },
    });

    // Fetch user information for each order
    const users = await this.prisma.user.findMany({
      where: {
        id: {in: result.records.map(order => order.userId)},
      },
      select: {
        id: true,
        name: true,
      },
    });

    // Attach user information to each order
    result.records.forEach(order => {
      const user = users.find(u => u.id === order.userId);
      order.userName = user ? user.name : 'Unknown User';
    });

    return result;
  }

  @Delete(':id')
  async deleteOrder(@Param('id') id: string) {
    return await this.prisma.order.delete({
      where: {id},
    });
  }

  //***********************************/
  //* Order pay and refund operations */
  //***********************************/

  @Patch(':id/paid')
  @ApiResponse({type: UpdateOrderResponseDto})
  async paid(@Param('id') id: string) {
    return await this.prisma.order.update({
      where: {id},
      data: {status: OrderStatus.PAID},
    });
  }

  @Patch(':id/refund-request')
  @ApiResponse({type: UpdateOrderResponseDto})
  async refundRequest(@Param('id') id: string) {
    return await this.prisma.order.update({
      where: {id},
      data: {status: OrderStatus.REFUND_REQUESTED},
    });
  }

  @Patch(':id/refund-approve')
  @ApiResponse({type: UpdateOrderResponseDto})
  async refundApproval(@Param('id') id: string) {
    return await this.prisma.order.update({
      where: {id},
      data: {status: OrderStatus.REFUND_APPROVED},
    });
  }

  @Patch(':id/refund-reject')
  @ApiResponse({type: UpdateOrderResponseDto})
  async refundReject(@Param('id') id: string) {
    return await this.prisma.order.update({
      where: {id},
      data: {status: OrderStatus.REFUND_REJECTED},
    });
  }

  @Patch(':id/refunded')
  @ApiResponse({type: UpdateOrderResponseDto})
  async refunded(@Param('id') id: string) {
    return await this.prisma.order.update({
      where: {id},
      data: {status: OrderStatus.REFUNDED},
    });
  }

  /* End */
}
