import { test } from "node:test";
import { strict as assert } from "node:assert";
import { resolveOrderItems, UnknownSkuError } from "./order-pricing";

const catalog = [
  { skuId: "sku-a", name: "Widget", priceInCents: 1000, priceInCentsDiscounted: null },
  { skuId: "sku-b", name: "Gadget", priceInCents: 2000, priceInCentsDiscounted: 1500 },
];

test("prices come from the catalog, not the request", () => {
  const { items, totalInCents } = resolveOrderItems(catalog, [
    // Client claims 1 cent per unit for sku-a — ignored.
    { skuId: "sku-a", quantity: 2 },
  ]);
  assert.equal(items[0].priceInCents, 1000);
  assert.equal(items[0].subTotalInCents, 2000);
  assert.equal(totalInCents, 2000);
});

test("discounted price wins when present", () => {
  const { items, totalInCents } = resolveOrderItems(catalog, [{ skuId: "sku-b", quantity: 3 }]);
  assert.equal(items[0].priceInCents, 1500);
  assert.equal(items[0].subTotalInCents, 4500);
  assert.equal(totalInCents, 4500);
});

test("missing quantity defaults to one", () => {
  const { items, totalInCents } = resolveOrderItems(catalog, [{ skuId: "sku-a" }]);
  assert.equal(items[0].quantity, 1);
  assert.equal(totalInCents, 1000);
});

test("unknown sku aborts the order", () => {
  assert.throws(() => resolveOrderItems(catalog, [{ skuId: "sku-x" }]), UnknownSkuError);
});

test("invalid quantities are rejected", () => {
  assert.throws(() => resolveOrderItems(catalog, [{ skuId: "sku-a", quantity: 0 }]));
  assert.throws(() => resolveOrderItems(catalog, [{ skuId: "sku-a", quantity: 1.5 }]));
});

test("an empty order is rejected", () => {
  assert.throws(() => resolveOrderItems(catalog, []));
});
