import { beforeEach, describe, expect, it } from "vitest";
import {
  changeContract,
  handleBillingAttemptWebhook,
  redactSubscriptionCustomer,
  runRenewals,
  shopsWithDueRenewals,
  syncContractFromShopify,
} from "../../app/.server/services/subscription-contract.service";
import { createAdminDouble } from "../support/admin-graphql-double";
import { createShop, prisma, resetDatabase } from "../support/db";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-12-01T12:00:00Z");
const CONTRACT = "gid://shopify/SubscriptionContract/1";
const DOMAIN = "renewals.myshopify.com";

let store: ReturnType<typeof createAdminDouble>;
let shopId: string;

beforeEach(async () => {
  await resetDatabase();
  shopId = (await createShop(DOMAIN)).id;
  store = createAdminDouble([]);
});

/** A subscription bought at checkout whose first renewal (cycle 1) is due `dueInDays` from NOW. */
async function subscribe(dueInDays = -1) {
  store.addContract(CONTRACT, new Date(NOW.getTime() + dueInDays * DAY), 30);
  return syncContractFromShopify(store.client, shopId, CONTRACT);
}

const contract = () => prisma.subscriptionContract.findUniqueOrThrow({ where: { shopifyContractId: CONTRACT } });
const attempts = () => prisma.subscriptionBillingAttempt.findMany({ orderBy: { createdAt: "asc" } });
const webhook = (kind: "success" | "failure" | "challenged", extra: Record<string, string> = {}) =>
  handleBillingAttemptWebhook(store.client, shopId, kind, { admin_graphql_api_subscription_contract_id: CONTRACT, ...extra }, NOW);

describe("subscription contracts", () => {
  it("keeps the customer's name and first order when the app isn't approved for email", async () => {
    store.failNext("BundleBoostSubscriptionContract", "This app is not approved to use the emailAddress field.");
    await subscribe(10);
    expect(await contract()).toMatchObject({
      customerName: "Ayesha Khan",
      customerEmail: null,
      originOrderName: "#1001",
      customerGid: "gid://shopify/Customer/7",
    });
  });

  it("stores the subscription with its customer, items, amount and next renewal", async () => {
    await subscribe(10);
    expect(await contract()).toMatchObject({
      status: "ACTIVE",
      customerName: "Ayesha Khan",
      customerEmail: "ayesha@example.com",
      originOrderName: "#1001",
      interval: "DAY",
      intervalCount: 30,
      currencyCode: "USD",
      nextBillingDate: new Date(NOW.getTime() + 10 * DAY),
    });
    expect(Number((await contract()).amount)).toBe(18);
  });
});

describe("renewals", () => {
  it("charges a due renewal once, even if the job runs again", async () => {
    await subscribe(-1);
    expect(await shopsWithDueRenewals(NOW)).toEqual([{ shopId, domain: DOMAIN }]);
    expect(await runRenewals(store.client, shopId, NOW)).toEqual({ charged: 1, advanced: 0, failed: 0 });
    expect(await runRenewals(store.client, shopId, NOW)).toEqual({ charged: 0, advanced: 0, failed: 0 });
    expect(store.contracts.get(CONTRACT)!.charges).toEqual([1]);
    expect(await attempts()).toMatchObject([{ cycleIndex: 1, status: "PENDING" }]);
  });

  it("leaves subscriptions alone until they're due", async () => {
    await subscribe(5);
    expect(await shopsWithDueRenewals(NOW)).toEqual([]);
    expect(await runRenewals(store.client, shopId, NOW)).toEqual({ charged: 0, advanced: 0, failed: 0 });
  });

  it("moves to the next renewal after a successful charge", async () => {
    await subscribe(-1);
    await runRenewals(store.client, shopId, NOW);
    const [attempt] = await attempts();
    store.billCycle(CONTRACT, 1);
    await webhook("success", { admin_graphql_api_id: attempt.shopifyAttemptId!, admin_graphql_api_order_id: "gid://shopify/Order/55" });

    expect(await attempts()).toMatchObject([{ status: "SUCCEEDED", orderGid: "gid://shopify/Order/55" }]);
    const c = await contract();
    expect(c.nextBillingDate).toEqual(new Date(NOW.getTime() - DAY + 30 * DAY));
    expect(c).toMatchObject({ failedAttempts: 0, lastBilledAt: NOW });
  });

  it("retries failed payments after 1 and 3 days, then pauses the subscription", async () => {
    await subscribe(-1);
    await runRenewals(store.client, shopId, NOW);
    await webhook("failure", { error_code: "card_declined", error_message: "Card declined" });
    expect(await contract()).toMatchObject({ failedAttempts: 1, nextRetryAt: new Date(NOW.getTime() + DAY), status: "ACTIVE" });

    // Not retried before the retry date; retried on it.
    expect((await runRenewals(store.client, shopId, NOW)).charged).toBe(0);
    expect((await runRenewals(store.client, shopId, new Date(NOW.getTime() + DAY))).charged).toBe(1);
    await webhook("failure", { error_code: "card_declined" });
    expect(await contract()).toMatchObject({ failedAttempts: 2, nextRetryAt: new Date(NOW.getTime() + 3 * DAY) });

    await runRenewals(store.client, shopId, new Date(NOW.getTime() + 3 * DAY));
    await webhook("failure", { error_code: "card_declined" });
    expect(await contract()).toMatchObject({ failedAttempts: 3, status: "PAUSED", nextRetryAt: null });
    expect(store.contracts.get(CONTRACT)!.status).toBe("PAUSED");
    expect(store.contracts.get(CONTRACT)!.charges).toEqual([1, 1, 1]);
  });

  it("schedules a retry when Shopify refuses to start the charge", async () => {
    await subscribe(-1);
    store.failNext("BundleBoostBillingCycleCharge", "Payment method is invalid");
    expect(await runRenewals(store.client, shopId, NOW)).toEqual({ charged: 0, advanced: 0, failed: 1 });
    expect(await contract()).toMatchObject({ failedAttempts: 1, nextRetryAt: new Date(NOW.getTime() + DAY) });
  });

  it("moves past a cycle that was already billed or skipped instead of charging it", async () => {
    await subscribe(-1);
    store.billCycle(CONTRACT, 1);
    expect(await runRenewals(store.client, shopId, NOW)).toEqual({ charged: 0, advanced: 1, failed: 0 });
    expect((await contract()).nextBillingDate).toEqual(new Date(NOW.getTime() + 29 * DAY));
  });
});

describe("merchant actions", () => {
  const ctx = () => ({ shopId, actorId: "1", admin: store.client });

  it("skips the next order", async () => {
    await subscribe(2);
    await changeContract(ctx(), (await contract()).id, "skip", NOW);
    expect(store.contracts.get(CONTRACT)!.skipped.has(1)).toBe(true);
    expect((await contract()).nextBillingDate).toEqual(new Date(NOW.getTime() + 32 * DAY));
  });

  it("remembers a skip so it can be undone, and skips further orders one at a time", async () => {
    await subscribe(2);
    const id = (await contract()).id;
    const first = new Date(NOW.getTime() + 2 * DAY);

    await changeContract(ctx(), id, "skip", NOW);
    expect(await contract()).toMatchObject({
      skippedCycleIndex: 1,
      skippedCycleDate: first,
      nextBillingDate: new Date(NOW.getTime() + 32 * DAY),
    });

    // "Skip another order" skips the following one and becomes the one to undo.
    await changeContract(ctx(), id, "skip", NOW);
    expect(await contract()).toMatchObject({ skippedCycleIndex: 2, nextBillingDate: new Date(NOW.getTime() + 62 * DAY) });
    expect([...store.contracts.get(CONTRACT)!.skipped].sort()).toEqual([1, 2]);

    // Undo brings the latest skipped order back as the next renewal.
    await changeContract(ctx(), id, "unskip", NOW);
    expect(await contract()).toMatchObject({
      skippedCycleIndex: null,
      skippedCycleDate: null,
      nextBillingDate: new Date(NOW.getTime() + 32 * DAY),
    });
    expect([...store.contracts.get(CONTRACT)!.skipped]).toEqual([1]);
    await expect(changeContract(ctx(), id, "unskip", NOW)).rejects.toThrow(/no skipped order/);
  });

  it("pauses, resumes and cancels in Shopify", async () => {
    await subscribe(2);
    const id = (await contract()).id;
    await changeContract(ctx(), id, "pause", NOW);
    expect((await contract()).status).toBe("PAUSED");
    expect(await runRenewals(store.client, shopId, new Date(NOW.getTime() + 5 * DAY))).toEqual({ charged: 0, advanced: 0, failed: 0 });
    await changeContract(ctx(), id, "resume", new Date(NOW.getTime() + 5 * DAY));
    // The overdue renewal is charged on the next run.
    expect(await contract()).toMatchObject({ status: "ACTIVE", nextBillingDate: new Date(NOW.getTime() + 5 * DAY) });
    await changeContract(ctx(), id, "cancel", NOW);
    expect(store.contracts.get(CONTRACT)!.status).toBe("CANCELLED");
    expect((await contract()).status).toBe("CANCELLED");
  });
});

describe("privacy", () => {
  it("erases the customer's details on customers/redact", async () => {
    await subscribe(2);
    expect(await redactSubscriptionCustomer(DOMAIN, "gid://shopify/Customer/7")).toBe(1);
    expect(await contract()).toMatchObject({ customerGid: null, customerName: null, customerEmail: null, originOrderName: null });
  });
});
