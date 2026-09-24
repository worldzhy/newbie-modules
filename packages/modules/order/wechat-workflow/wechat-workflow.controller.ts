import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {Body, Controller, Get, Param, Patch, Post} from '@nestjs/common';
import {ApiTags, ApiBearerAuth, ApiResponse, ApiOperation} from '@nestjs/swagger';
import {GuardByApiKey} from '@microservices/account/security/passport/api-key/api-key.decorator';
import {OrderService} from '../order.service';
import {CreateOrderResponseDto, UpdateOrderResponseDto} from '../order.dto';
import {WechatWorkflowCreateOrderRequestDto, WechatWorkflowUpdateOrderPaidRequestDto} from './wechat-workflow.dto';
import {OrderStatus, PaymentMethod} from '@generated/prisma/client';

@ApiTags('Order Management / Wechat Workflow Order')
@ApiBearerAuth()
@GuardByApiKey()
@Controller('wechat-workflow-orders')
export class WechatWorkflowOrderController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService
  ) {}

  @Get(':id')
  @ApiOperation({summary: '[Auth by API key] Get order details'})
  async getOrder(@Param('id') id: string) {
    return await this.prisma.order.findUnique({where: {id}});
  }

  @Post('')
  @ApiOperation({
    summary: '[Auth by API key] Call from Tencent cloudbase workflow',
  })
  @ApiResponse({type: CreateOrderResponseDto})
  async createOrder(@Body() body: WechatWorkflowCreateOrderRequestDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: {wechatOpenId: body.wechatOpenId},
    });

    // [step 2] Check if there's an existing pending order
    const existingOrders = await this.prisma.order.findMany({
      where: {userId: user.id, status: 'PENDING'},
      include: {items: true},
    });

    // Compare items of existing orders with the new order
    for (const order of existingOrders) {
      const existingItems = order.items;

      if (
        existingItems.length === body.items.length &&
        existingItems.every((existingItem, index) => {
          const newItem = body.items[index];
          return existingItem.skuId === newItem.skuId && existingItem.quantity === newItem.quantity;
        })
      ) {
        // ! Do not return the existing order, because the order id might be invalid.
        await this.prisma.order.delete({where: {id: order.id}});
        break;
      }
    }

    return await this.orderService.create({
      paymentMethod: PaymentMethod.WECHAT_PAY,
      items: body.items,
      note: body.note,
      userId: user.id,
    });
  }

  @Patch(':id/paid')
  @ApiResponse({type: UpdateOrderResponseDto})
  async paid(@Param('id') id: string, @Body() body: WechatWorkflowUpdateOrderPaidRequestDto) {
    return await this.prisma.order.update({
      where: {id},
      data: {
        status: OrderStatus.PAID,
        wechatTransactionId: body.wechatTransactionId,
        paidAt: new Date(),
      },
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
