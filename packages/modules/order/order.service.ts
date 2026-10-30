import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { PaymentMethod } from "@generated/prisma/client";
import { OrderItemRequestEntity } from "./order.entity";
import { resolveOrderItems, UnknownSkuError } from "./order-pricing";

@Injectable()
export class OrderService {
  constructor(private readonly prisma: PrismaService) {}

  async create(params: {
    paymentMethod: PaymentMethod;
    items: OrderItemRequestEntity[];
    note?: string;
    userId: string;
  }) {
    // Price and product name are authoritative from the catalog. Client fields
    // cannot influence the amount charged.
    const products = await this.prisma.product.findMany({
      where: { skuId: { in: params.items.map((item) => item.skuId) } },
      select: { skuId: true, name: true, priceInCents: true, priceInCentsDiscounted: true },
    });

    let resolved: ReturnType<typeof resolveOrderItems>;
    try {
      resolved = resolveOrderItems(products, params.items);
    } catch (error) {
      if (error instanceof UnknownSkuError) throw new BadRequestException(error.message);
      throw new BadRequestException((error as Error).message);
    }

    const orderItems = resolved.items.map((item) => ({
      skuId: item.skuId,
      name: item.name,
      priceInCents: item.priceInCents,
      quantity: item.quantity,
      subTotalInCents: item.subTotalInCents,
    }));

    return await this.prisma.order.create({
      data: {
        totalInCents: resolved.totalInCents,
        paymentMethod: params.paymentMethod,
        items: { createMany: { data: orderItems } },
        note: params.note,
        userId: params.userId,
      },
    });
  }
}
