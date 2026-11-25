import { beforeEach, describe, expect, it } from "vitest";
import {
  changeCampaignStatus,
  createDraftCampaign,
  deleteCampaign,
  getCampaign,
  updateCampaign,
  type TenantContext,
} from "../../app/.server/services/campaign.service";
import { syncCampaignDiscount, syncPendingCampaigns } from "../../app/.server/services/discount-sync.service";
import { buildStorefrontConfig } from "../../app/.server/services/storefront-sync.service";
import { markShopUninstalled, onShopAuthenticated } from "../../app/.server/services/shop.service";
import { ValidationError } from "../../app/.server/errors";
import { createAdminDouble, fakeProduct, productGid, variantGid } from "../support/admin-graphql-double";
import { createShop, prisma, resetDatabase } from "../support/db";
import { PLANS } from "../../app/lib/plans";

const catalog = [fakeProduct(1, 3), fakeProduct(2, 2)];
const DOMAIN = "shop-a.myshopify.com";

function input(overrides: Record<string, unknown> = {}) {
  return {
    name: "Bulk socks",
    discountType: "PERCENTAGE",
    discountLabel: "Socks bundle",
    products: [{ productGid: productGid(1), variantGids: [] }],
    tiers: [
      { minQuantity: 2, value: "5" },
      { minQuantity: 4, value: "10" },
    ],
    ...overrides,
  };
}

let store: ReturnType<typeof createAdminDouble>;
let ctx: TenantContext;

beforeEach(async () => {
  await resetDatabase();
  const shop = await createShop(DOMAIN);
  store = createAdminDouble(catalog);
  ctx = { shopId: shop.id, actorId: "1", admin: store.client, plan: PLANS.pro };
});

async function activeCampaign(overrides: Record<string, unknown> = {}) {
  const draft = await createDraftCampaign(ctx, input(overrides));
  const result = await changeCampaignStatus(ctx, draft.id, "ACTIVE");
  return { id: draft.id, result };
}

describe("subscription options", () => {
  it("keeps Shopify's defaults for existing campaigns: both purchase types, first order", async () => {
    const { id } = await activeCampaign();
    const campaign = await getCampaign(ctx.shopId, id);
    expect(campaign).toMatchObject({ purchaseType: "BOTH", recurringCycleLimit: 1 });
    expect(store.discounts.get(campaign.shopifyDiscountId!)).toMatchObject({
      appliesOnOneTimePurchase: true,
      appliesOnSubscription: true,
      recurringCycleLimit: 1,
    });
  });

  it("sends subscription-only discounts with their order limit", async () => {
    const { id } = await activeCampaign({ purchaseType: "SUBSCRIPTION", recurringCycleLimit: 3 });
    const campaign = await getCampaign(ctx.shopId, id);
    expect(store.discounts.get(campaign.shopifyDiscountId!)).toMatchObject({
      appliesOnOneTimePurchase: false,
      appliesOnSubscription: true,
      recurringCycleLimit: 3,
    });
  });

  it("omits the order limit for one-time-only discounts and updates live discounts", async () => {
    const { id } = await activeCampaign({ purchaseType: "BOTH", recurringCycleLimit: 0 });
    const campaign = await getCampaign(ctx.shopId, id);
    expect(store.discounts.get(campaign.shopifyDiscountId!)).toMatchObject({ recurringCycleLimit: 0 });

    await updateCampaign(ctx, id, input({ purchaseType: "ONE_TIME", recurringCycleLimit: 5 }));
    const updated = await getCampaign(ctx.shopId, id);
    expect(updated).toMatchObject({ purchaseType: "ONE_TIME", recurringCycleLimit: 1 });
    const discount = store.discounts.get(updated.shopifyDiscountId!);
    expect(discount).toMatchObject({ appliesOnOneTimePurchase: true, appliesOnSubscription: false });
    expect(discount?.recurringCycleLimit).toBeUndefined();
  });
});

describe("discount sync on status changes", () => {
  it("drafts never create a Shopify discount", async () => {
    await createDraftCampaign(ctx, input());
    expect(store.discounts.size).toBe(0);
  });

  it("activation creates an automatic app discount running the function", async () => {
    const { id, result } = await activeCampaign();
    expect(result.sync.discount).toEqual({ ok: true });

    const campaign = await getCampaign(ctx.shopId, id);
    expect(campaign.syncStatus).toBe("SYNCED");
    expect(campaign.lastSyncedAt).toBeInstanceOf(Date);
    const discount = store.discounts.get(campaign.shopifyDiscountId!);
    expect(discount).toMatchObject({
      // Shopify title: label + campaign name (unique per store); shoppers see the label.
      title: "Socks bundle · Bulk socks",
      functionHandle: "bundleboost-quantity-breaks",
      discountClasses: ["PRODUCT"],
      endsAt: null,
      combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: true },
    });
    expect(JSON.parse(discount!.config)).toEqual({
      v: 1,
      t: "P",
      m: "Socks bundle",
      p: { "1": [] },
      tiers: [
        [2, "5.00"],
        [4, "10.00"],
      ],
    });
  });

  it("falls back to the shop's default label as the discount title", async () => {
    const { id } = await activeCampaign({ discountLabel: "" });
    const campaign = await getCampaign(ctx.shopId, id);
    const discount = store.discounts.get(campaign.shopifyDiscountId!)!;
    expect(discount.title).toBe("Volume discount · Bulk socks");
    expect(JSON.parse(discount.config).m).toBe("Volume discount");
  });

  it("syncs several campaigns that use the default label (titles must be unique in Shopify)", async () => {
    const first = await activeCampaign({ discountLabel: "" });
    const second = await activeCampaign({ discountLabel: "", name: "Mug deal", products: [{ productGid: productGid(2), variantGids: [] }] });
    expect(first.result.sync.discount).toEqual({ ok: true });
    expect(second.result.sync.discount).toEqual({ ok: true });
    const titles = [...store.discounts.values()].map((d) => d.title).sort();
    expect(titles).toEqual(["Volume discount · Bulk socks", "Volume discount · Mug deal"]);
  });

  it("adds the campaign id when another discount already has the same title", async () => {
    const first = await activeCampaign();
    const second = await activeCampaign({ products: [{ productGid: productGid(2), variantGids: [] }] });
    expect(first.result.sync.discount).toEqual({ ok: true });
    expect(second.result.sync.discount).toEqual({ ok: true });
    const campaign = await getCampaign(ctx.shopId, second.id);
    expect(campaign.syncStatus).toBe("SYNCED");
    expect(store.discounts.get(campaign.shopifyDiscountId!)!.title).toBe(`Socks bundle · Bulk socks (${second.id.slice(-6)})`);
  });

  it("pause deactivates, resume reactivates the same discount", async () => {
    const { id } = await activeCampaign();
    const discountId = (await getCampaign(ctx.shopId, id)).shopifyDiscountId!;

    await changeCampaignStatus(ctx, id, "PAUSED");
    expect(store.discounts.get(discountId)!.status).toBe("EXPIRED");
    expect((await getCampaign(ctx.shopId, id)).syncStatus).toBe("SYNCED");

    await changeCampaignStatus(ctx, id, "ACTIVE");
    expect(store.discounts.get(discountId)!.status).toBe("ACTIVE");
    expect(store.discounts.size).toBe(1);
  });

  it("archiving deletes the Shopify discount", async () => {
    const { id } = await activeCampaign();
    await changeCampaignStatus(ctx, id, "ARCHIVED");
    expect(store.discounts.size).toBe(0);
    const campaign = await getCampaign(ctx.shopId, id);
    expect(campaign.shopifyDiscountId).toBeNull();
    expect(campaign.syncStatus).toBe("NOT_SYNCED");
  });

  it("editing an active campaign updates the title and configuration", async () => {
    const { id } = await activeCampaign();
    await updateCampaign(
      ctx,
      id,
      input({ discountLabel: "New label", products: [{ productGid: productGid(2), variantGids: [variantGid(201)] }], tiers: [{ minQuantity: 3, value: "20" }] }),
    );
    const campaign = await getCampaign(ctx.shopId, id);
    const discount = store.discounts.get(campaign.shopifyDiscountId!)!;
    expect(discount.title).toBe("New label · Bulk socks");
    expect(JSON.parse(discount.config)).toMatchObject({ p: { "2": ["201"] }, tiers: [[3, "20.00"]] });
  });

  it("recreates a discount that was deleted in Shopify admin", async () => {
    const { id } = await activeCampaign();
    const oldId = (await getCampaign(ctx.shopId, id)).shopifyDiscountId!;
    store.discounts.delete(oldId);

    await updateCampaign(ctx, id, input({ name: "Renamed" }));
    const campaign = await getCampaign(ctx.shopId, id);
    expect(campaign.shopifyDiscountId).not.toBe(oldId);
    expect(store.discounts.has(campaign.shopifyDiscountId!)).toBe(true);
    expect(campaign.syncStatus).toBe("SYNCED");
  });
});

describe("sync failures", () => {
  it("keeps the merchant's change, records the error, and recovers on retry", async () => {
    const draft = await createDraftCampaign(ctx, input());
    store.failNext("BundleBoostDiscountCreate", "Shop has reached the limit of 25 active discount functions");

    const result = await changeCampaignStatus(ctx, draft.id, "ACTIVE");
    expect(result.sync.discount).toEqual({
      ok: false,
      error: "Shop has reached the limit of 25 active discount functions",
    });
    const failed = await getCampaign(ctx.shopId, draft.id);
    expect(failed).toMatchObject({ status: "ACTIVE", syncStatus: "ERROR", shopifyDiscountId: null });
    expect(failed.syncError).toContain("25 active discount functions");

    expect(await syncCampaignDiscount(ctx.admin, ctx.shopId, draft.id)).toEqual({ ok: true });
    const recovered = await getCampaign(ctx.shopId, draft.id);
    expect(recovered).toMatchObject({ syncStatus: "SYNCED", syncError: null });
    expect(store.discounts.size).toBe(1);
  });

  it("uses a generic message for transport errors", async () => {
    const draft = await createDraftCampaign(ctx, input());
    store.failNext("BundleBoostDiscountCreate", "NETWORK");
    const result = await changeCampaignStatus(ctx, draft.id, "ACTIVE");
    expect(result.sync.discount).toEqual({ ok: false, error: "Shopify couldn't be reached. Try again." });
  });

  it("does not hide storefront failures behind a successful discount sync", async () => {
    const draft = await createDraftCampaign(ctx, input());
    store.failNext("BundleBoostMetafieldsSet", "Value too large");
    const result = await changeCampaignStatus(ctx, draft.id, "ACTIVE");
    expect(result.sync.discount).toEqual({ ok: true });
    expect(result.sync.storefront).toEqual({ ok: false, error: "Value too large" });
  });

  it("rejects activating a campaign whose configuration exceeds Shopify's limit", async () => {
    const big = Array.from({ length: 100 }, (_, i) => fakeProduct(9000000000000 + i, 20));
    const bigStore = createAdminDouble(big);
    const bigCtx = { ...ctx, admin: bigStore.client };
    const draft = await createDraftCampaign(bigCtx, input({
      products: big.map((p) => ({ productGid: p.id, variantGids: p.variants.slice(0, 19).map((v) => v.id) })),
    }));
    await expect(changeCampaignStatus(bigCtx, draft.id, "ACTIVE")).rejects.toBeInstanceOf(ValidationError);
    expect((await getCampaign(ctx.shopId, draft.id)).status).toBe("DRAFT");
    expect(bigStore.discounts.size).toBe(0);
  });
});

describe("deletion", () => {
  it("cleans up a discount left behind by a failed sync", async () => {
    const { id } = await activeCampaign();
    const discountId = (await getCampaign(ctx.shopId, id)).shopifyDiscountId!;
    // Simulate archive whose Shopify delete failed.
    await prisma.campaign.update({ where: { id }, data: { status: "ARCHIVED", syncStatus: "ERROR" } });
    await deleteCampaign(ctx, id);
    expect(store.discounts.has(discountId)).toBe(false);
  });
});

describe("storefront configuration", () => {
  it("publishes only active, synced campaigns with widget settings", async () => {
    const { id } = await activeCampaign({ products: [{ productGid: productGid(1), variantGids: [variantGid(101)] }] });
    await createDraftCampaign(ctx, input({ name: "Draft", products: [{ productGid: productGid(2), variantGids: [] }] }));

    const published = JSON.parse(store.appMetafields.get("bundleboost.storefront")!);
    expect(published).toEqual(await buildStorefrontConfig(ctx.shopId));
    expect(Object.keys(published.products)).toEqual(["1"]);
    expect(published.products["1"]).toEqual([
      { type: "percentage", purchase: "both", variants: ["101"], tiers: [{ qty: 2, value: 5, label: "" }, { qty: 4, value: 10, label: "" }] },
    ]);
    expect(published.widget).toMatchObject({ heading: "Buy more, save more", layout: "stacked" });

    await changeCampaignStatus(ctx, id, "PAUSED");
    expect(JSON.parse(store.appMetafields.get("bundleboost.storefront")!).products).toEqual({});
  });

  it("omits active campaigns whose discount failed to sync", async () => {
    const draft = await createDraftCampaign(ctx, input());
    store.failNext("BundleBoostDiscountCreate", "boom");
    await changeCampaignStatus(ctx, draft.id, "ACTIVE");
    expect((await buildStorefrontConfig(ctx.shopId)).products).toEqual({});
  });
});

describe("uninstall and reinstall", () => {
  it("marks synced campaigns stale on uninstall and restores them on reinstall", async () => {
    const { id } = await activeCampaign();
    const discountId = (await getCampaign(ctx.shopId, id)).shopifyDiscountId!;

    await markShopUninstalled(DOMAIN);
    expect((await getCampaign(ctx.shopId, id)).syncStatus).toBe("NOT_SYNCED");

    // Shopify removed the app's discounts while it was uninstalled.
    store.discounts.clear();
    await onShopAuthenticated(DOMAIN, store.client);

    const campaign = await getCampaign(ctx.shopId, id);
    expect(campaign.syncStatus).toBe("SYNCED");
    expect(campaign.shopifyDiscountId).not.toBe(discountId);
    expect(store.discounts.size).toBe(1);
    expect(store.appMetafields.has("bundleboost.storefront")).toBe(true);
  });

  it("re-syncs every active and paused campaign when asked", async () => {
    await activeCampaign();
    const results = await syncPendingCampaigns(ctx.admin, ctx.shopId, { includeSynced: true });
    expect(results).toEqual([{ ok: true }]);
  });
});
