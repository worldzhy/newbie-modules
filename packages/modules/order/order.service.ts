import {Injectable} from '@nestjs/common';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {PaymentMethod} from '@generated/prisma/client';
import {OrderItemRequestEntity} from './order.entity';

@Injectable()
export class OrderService {
  constructor(private readonly prisma: PrismaService) {}

  async create(params: {paymentMethod: PaymentMethod; items: OrderItemRequestEntity[]; note?: string; userId: string}) {
    let totalInCents = 0;
    for (const item of params.items) {
      totalInCents += item.priceInCents * (item.quantity || 1);
    }

    const orderItems = params.items.map(item => {
      return {
        skuId: item.skuId,
        name: item.name,
        priceInCents: item.priceInCents,
        quantity: item.quantity || 1,
        subTotalInCents: item.priceInCents * (item.quantity || 1),
      };
    });

    return await this.prisma.order.create({
      data: {
        totalInCents: totalInCents,
        paymentMethod: params.paymentMethod,
        items: {createMany: {data: orderItems}},
        note: params.note,
        userId: params.userId,
      },
    });
  }
}
