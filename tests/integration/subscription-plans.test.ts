import { beforeEach, describe, expect, it } from "vitest";
import {
  createSubscriptionPlan,
  deleteSubscriptionPlan,
  getSubscriptionPlan,
  productsWithSubscriptionPlans,
  syncSubscriptionPlan,
  updateSubscriptionPlan,
  type PlanContext,
} from "../../app/.server/services/subscription-plan.service";
import { ValidationError } from "../../app/.server/errors";
import { createAdminDouble, fakeProduct, productGid } from "../support/admin-graphql-double";
import { createShop, prisma, resetDatabase } from "../support/db";

const catalog = [fakeProduct(1, 2), fakeProduct(2, 1)];
let store: ReturnType<typeof createAdminDouble>;
let ctx: PlanContext;

const input = (overrides: Record<string, unknown> = {}) => ({
  name: "Subscribe & save",
  frequencies: [
    { interval: "MONTH", intervalCount: 1, discountPercent: 10 },
    { interval: "MONTH", intervalCount: 3, discountPercent: 15, label: "Quarterly" },
  ],
  productGids: [productGid(1)],
  ...overrides,
});

beforeEach(async () => {
  await resetDatabase();
  const shop = await createShop("subs.myshopify.com");
  store = createAdminDouble(catalog);
  ctx = { shopId: shop.id, actorId: "1", admin: store.client };
});

describe("subscription plans", () => {
  it("creates a selling plan group with one plan per frequency", async () => {
    const { id, sync } = await createSubscriptionPlan(ctx, input());
    expect(sync).toEqual({ ok: true });
    const plan = await getSubscriptionPlan(ctx.shopId, id);
    expect(plan.syncStatus).toBe("SYNCED");
    const group = store.sellingPlanGroups.get(plan.shopifyGroupId!)!;
    expect(group.name).toBe("Subscribe & save");
    // Tagged as BundleBoost's own, so the app and widget never use other apps' plans.
    const create = store.calls.find((c) => c.query.includes("BundleBoostSellingPlanGroupCreate"));
    expect((create?.variables as { input: { appId: string } }).input.appId).toBe("bundleboost");
    expect([...group.products]).toEqual([productGid(1)]);
    const quarterly = group.plans.get("3 months")!;
    expect(quarterly.input).toMatchObject({
      name: "Quarterly",
      category: "SUBSCRIPTION",
      billingPolicy: { recurring: { interval: "MONTH", intervalCount: 3 } },
      pricingPolicies: [{ fixed: { adjustmentType: "PERCENTAGE", adjustmentValue: { percentage: 15 } } }],
    });
    expect(plan.frequencies.map((f) => f.shopifySellingPlanId)).toEqual([
      group.plans.get("1 month")!.id,
      quarterly.id,
    ]);
  });

  it("updates in place: keeps unchanged plans, adds and removes the rest", async () => {
    const { id } = await createSubscriptionPlan(ctx, input());
    const before = await getSubscriptionPlan(ctx.shopId, id);
    const monthlyId = before.frequencies[0].shopifySellingPlanId;

    await updateSubscriptionPlan(
      ctx,
      id,
      input({
        frequencies: [
          { interval: "MONTH", intervalCount: 1, discountPercent: 12 },
          { interval: "WEEK", intervalCount: 2, discountPercent: 5 },
        ],
        productGids: [productGid(2)],
      }),
    );
    const after = await getSubscriptionPlan(ctx.shopId, id);
    const group = store.sellingPlanGroups.get(after.shopifyGroupId!)!;
    expect(after.frequencies[0].shopifySellingPlanId).toBe(monthlyId);
    expect([...group.plans.keys()].sort()).toEqual(["1 month", "2 weeks"]);
    expect([...group.products]).toEqual([productGid(2)]);
  });

  it("syncs again without re-adding products or leaving removed frequencies behind", async () => {
    const { id } = await createSubscriptionPlan(ctx, input());
    // "Sync with Shopify" on an unchanged plan: Shopify would reject re-adding products.
    expect(await syncSubscriptionPlan(store.client, ctx.shopId, id)).toEqual({ ok: true });

    // A frequency removed in Shopify-side drift is cleaned up on the next sync.
    const plan = await getSubscriptionPlan(ctx.shopId, id);
    const group = store.sellingPlanGroups.get(plan.shopifyGroupId!)!;
    group.plans.set("2 weeks", { id: "gid://shopify/SellingPlan/777", input: {} });
    group.products.delete(productGid(1));
    expect(await syncSubscriptionPlan(store.client, ctx.shopId, id)).toEqual({ ok: true });
    expect([...group.plans.keys()].sort()).toEqual(["1 month", "3 months"]);
    expect([...group.products]).toEqual([productGid(1)]);
  });

  it("records a Shopify failure so it can be retried", async () => {
    store.failNext("BundleBoostSellingPlanGroupCreate", "Selling plans aren't available");
    const { id, sync } = await createSubscriptionPlan(ctx, input());
    expect(sync.ok).toBe(false);
    expect(await getSubscriptionPlan(ctx.shopId, id)).toMatchObject({
      syncStatus: "ERROR",
      syncError: "Selling plans aren't available",
    });
  });

  it("rejects products that aren't in the store", async () => {
    const error = await createSubscriptionPlan(ctx, input({ productGids: [productGid(99)] })).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(await prisma.subscriptionPlan.count()).toBe(0);
  });

  it("deletes the plan from Shopify and the database", async () => {
    const { id } = await createSubscriptionPlan(ctx, input());
    const plan = await getSubscriptionPlan(ctx.shopId, id);
    await deleteSubscriptionPlan(ctx, id);
    expect(store.sellingPlanGroups.has(plan.shopifyGroupId!)).toBe(false);
    expect(await prisma.subscriptionPlan.count()).toBe(0);
  });
});

describe("products with subscription plans (campaign editor)", () => {
  it("lists products on plans that are live in Shopify, once each", async () => {
    await createSubscriptionPlan(ctx, input());
    await createSubscriptionPlan(ctx, input({ name: "Weekly", productGids: [productGid(1), productGid(2)] }));
    expect((await productsWithSubscriptionPlans(ctx.shopId)).sort()).toEqual([productGid(1), productGid(2)].sort());
  });

  it("leaves out plans that aren't saved to Shopify", async () => {
    store.failNext("BundleBoostSellingPlanGroupCreate", "Shopify is down");
    const { sync } = await createSubscriptionPlan(ctx, input());
    expect(sync.ok).toBe(false);
    expect(await productsWithSubscriptionPlans(ctx.shopId)).toEqual([]);
  });
});
