/**
 * Order line pricing.
 *
 * The order API used to trust `priceInCents` and `name` sent by the client, so a
 * caller could buy anything for a cent. Pricing is now resolved server-side from
 * the Product (by skuId); the client only chooses *what* and *how many*. Kept
 * dependency-free so it can be unit-tested without Prisma.
 */
export interface PricedProduct {
  skuId: string;
  name: string;
  priceInCents: number;
  priceInCentsDiscounted?: number | null;
}

export interface RequestedOrderItem {
  skuId: string;
  quantity?: number;
}

export interface ResolvedOrderItem {
  skuId: string;
  name: string;
  priceInCents: number;
  quantity: number;
  subTotalInCents: number;
}

export class UnknownSkuError extends Error {
  constructor(skuId: string) {
    super(`Unknown skuId: ${skuId}`);
    this.name = "UnknownSkuError";
  }
}

/** Effective unit price: the discounted price wins when present. */
export function effectiveUnitPriceInCents(product: PricedProduct): number {
  return product.priceInCentsDiscounted ?? product.priceInCents;
}

/**
 * Resolves authoritative order items and total from the catalog. Client-supplied
 * prices are ignored entirely; an unknown skuId aborts the whole order rather
 * than silently defaulting to zero.
 */
export function resolveOrderItems(
  products: PricedProduct[],
  items: RequestedOrderItem[],
): { items: ResolvedOrderItem[]; totalInCents: number } {
  if (items.length === 0) {
    throw new Error("An order must contain at least one item.");
  }

  const catalog = new Map(products.map((product) => [product.skuId, product]));
  const resolved: ResolvedOrderItem[] = [];
  let totalInCents = 0;

  for (const item of items) {
    const product = catalog.get(item.skuId);
    if (!product) throw new UnknownSkuError(item.skuId);

    const quantity = item.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error(`Invalid quantity for skuId ${item.skuId}.`);
    }

    const priceInCents = effectiveUnitPriceInCents(product);
    const subTotalInCents = priceInCents * quantity;
    totalInCents += subTotalInCents;
    resolved.push({
      skuId: product.skuId,
      name: product.name,
      priceInCents,
      quantity,
      subTotalInCents,
    });
  }

  return { items: resolved, totalInCents };
}
