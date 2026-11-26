import prisma from "../../db.server";
import { planFromHandle, PLAN_ORDER, PLANS, type Plan, type PlanHandle } from "../../lib/plans";
import { env } from "../env";
import { logger } from "../logger";
import type { AdminGraphqlClient } from "../shopify/graphql";
import { usesTestCharges } from "../shopify/shop-info";
import {
  fetchActiveSubscription as fetchAdminSubscription,
  cancelSubscription as cancelAdminSubscription,
} from "../shopify/billing";
import {
  fetchActiveSubscription as fetchPartnerSubscription,
  partnerApiConfigured,
} from "../shopify/partner";

/**
 * Billing supports native Shopify App Billing via the Admin API
 * (appSubscriptionCreate / currentAppInstallation.activeSubscriptions), with
 * optional fallback to Shopify Partner API managed pricing if configured.
 *
 * The merchant's plan is read from Shopify and cached on BillingSubscription
 * for a few minutes. No active subscription means Free.
 */

const CACHE_MS = 5 * 60 * 1000;

export type ShopPlan = {
  plan: Plan;
  /** false when the plan couldn't be confirmed with Shopify (then it's the last known plan, or Free). */
  verified: boolean;
  configured: boolean;
  renewsAt: string | null;
  trialEndsAt: string | null;
  cancelAtEndOfCycle: boolean;
  pendingPlan: Plan | null;
  checkedAt: string | null;
};

const handleOf = (items: { handle: string | null }[] | undefined): PlanHandle | null => {
  const handles = (items ?? []).map((i) => i.handle).filter(Boolean) as string[];
  // Highest matching plan wins if more than one item is present.
  return [...PLAN_ORDER].reverse().find((h) => handles.includes(h)) ?? null;
};

/** The last known plan, without calling Shopify (for background work). */
export async function cachedPlan(shopId: string): Promise<Plan> {
  const row = await prisma.billingSubscription.findUnique({ where: { shopId } });
  return planFromHandle(row?.status === "ACTIVE" ? row.planName : "free");
}

export async function getShopPlan(
  shopId: string,
  admin: AdminGraphqlClient,
  options: { fresh?: boolean } = {},
): Promise<ShopPlan> {
  const row = await prisma.billingSubscription.findUnique({ where: { shopId } });
  const cached = (): ShopPlan => ({
    plan: planFromHandle(row?.status === "ACTIVE" ? row.planName : "free"),
    verified: false,
    configured: true,
    renewsAt: row?.currentPeriodEnd?.toISOString() ?? null,
    trialEndsAt: null,
    cancelAtEndOfCycle: false,
    pendingPlan: null,
    checkedAt: row?.lastCheckedAt?.toISOString() ?? null,
  });

  // Use the cached plan for a few minutes on every plan, Free included, so page
  // navigation doesn't wait on Shopify each time. New charges still apply right
  // away: merchants return to the billing page, which passes { fresh: true },
  // and app_subscriptions/update clears lastCheckedAt.
  const fresh = row?.lastCheckedAt && Date.now() - row.lastCheckedAt.getTime() < CACHE_MS;
  if (fresh && !options.fresh) return { ...cached(), verified: true };

  try {
    // 1. Primary check: Shopify Admin API (native App Billing API)
    const subscription = await fetchAdminSubscription(admin);
    if (subscription && subscription.status === "ACTIVE") {
      const plan = planFromHandle(subscription.name);
      const renewsAt = subscription.currentPeriodEnd ?? null;
      const data = {
        planName: plan.handle,
        status: "ACTIVE",
        shopifySubscriptionId: subscription.id,
        test: subscription.test,
        trialDays: subscription.trialDays,
        currentPeriodEnd: renewsAt ? new Date(renewsAt) : null,
        lastCheckedAt: new Date(),
      };
      await prisma.billingSubscription.upsert({
        where: { shopId },
        create: { shopId, ...data },
        update: data,
      });
      return {
        plan,
        verified: true,
        configured: true,
        renewsAt,
        trialEndsAt: null,
        cancelAtEndOfCycle: false,
        pendingPlan: null,
        checkedAt: data.lastCheckedAt.toISOString(),
      };
    }

    // 2. Fallback check: Partner API if configured (e.g. for managed pricing in Partner Dashboard)
    if (partnerApiConfigured()) {
      try {
        const partnerSub = await fetchPartnerSubscription(admin);
        if (partnerSub) {
          const handle = handleOf(partnerSub.items) ?? "free";
          const renewsAt = partnerSub.currentBillingCycle?.endTime ?? null;
          const data = {
            planName: handle,
            status: "ACTIVE",
            currentPeriodEnd: renewsAt ? new Date(renewsAt) : null,
            lastCheckedAt: new Date(),
          };
          await prisma.billingSubscription.upsert({
            where: { shopId },
            create: { shopId, ...data },
            update: data,
          });
          const pending = handleOf(partnerSub.pendingUpdate?.items);
          return {
            plan: planFromHandle(handle),
            verified: true,
            configured: true,
            renewsAt,
            trialEndsAt: partnerSub.trialEndsAt ?? null,
            cancelAtEndOfCycle: partnerSub.cancelAtEndOfCycle ?? false,
            pendingPlan: pending ? planFromHandle(pending) : null,
            checkedAt: data.lastCheckedAt.toISOString(),
          };
        }
      } catch (partnerError) {
        logger.warn("Partner API plan check failed; falling back to Admin API status", { error: partnerError });
      }
    }

    // No active subscription -> store is on Free plan
    const data = {
      planName: "free",
      status: "NONE",
      shopifySubscriptionId: null,
      currentPeriodEnd: null,
      lastCheckedAt: new Date(),
    };
    await prisma.billingSubscription.upsert({
      where: { shopId },
      create: { shopId, ...data },
      update: data,
    });
    return {
      plan: PLANS.free,
      verified: true,
      configured: true,
      renewsAt: null,
      trialEndsAt: null,
      cancelAtEndOfCycle: false,
      pendingPlan: null,
      checkedAt: data.lastCheckedAt.toISOString(),
    };
  } catch (error) {
    if (error instanceof Response) throw error;
    logger.warn("Plan check failed; using last known plan", { shopId, error });
    return cached();
  }
}

/** Cancel any active subscription and set shop to Free. */
export async function cancelCurrentSubscription(
  shopId: string,
  admin: AdminGraphqlClient,
  billing?: { cancel?: (opts: { subscriptionId: string; isTest?: boolean; prorate?: boolean }) => Promise<unknown> },
) {
  const row = await prisma.billingSubscription.findUnique({ where: { shopId } });
  let subscriptionId = row?.shopifySubscriptionId;

  if (!subscriptionId) {
    const active = await fetchAdminSubscription(admin);
    subscriptionId = active?.id ?? null;
  }

  if (subscriptionId) {
    let cancelled = false;
    if (billing?.cancel) {
      try {
        await billing.cancel({
          subscriptionId,
          isTest: await usesTestCharges(admin),
          prorate: true,
        });
        cancelled = true;
      } catch (e) {
        logger.warn("billing.cancel failed, trying admin GraphQL mutation", { error: e });
      }
    }
    if (!cancelled) {
      try {
        await cancelAdminSubscription(admin, subscriptionId);
      } catch (e) {
        logger.warn("cancelAdminSubscription failed", { error: e });
      }
    }
  }

  await prisma.billingSubscription.upsert({
    where: { shopId },
    create: {
      shopId,
      planName: "free",
      status: "CANCELLED",
      shopifySubscriptionId: null,
      lastCheckedAt: new Date(),
    },
    update: {
      planName: "free",
      status: "CANCELLED",
      shopifySubscriptionId: null,
      lastCheckedAt: new Date(),
    },
  });
}

/** What the shop uses today, compared with plan limits on the billing page. */
export async function getUsage(shopId: string) {
  const [activeCampaigns, liveProducts, tierCounts] = await Promise.all([
    prisma.campaign.count({ where: { shopId, status: "ACTIVE" } }),
    prisma.campaignProduct.findMany({
      where: { shopId, campaign: { status: "ACTIVE" } },
      distinct: ["productGid"],
      select: { productGid: true },
    }),
    prisma.quantityTier.groupBy({
      by: ["campaignId"],
      where: { campaign: { shopId, status: { not: "ARCHIVED" } } },
      _count: { _all: true },
    }),
  ]);
  return {
    activeCampaigns,
    liveProducts: liveProducts.length,
    mostTiers: tierCounts.reduce((max, t) => Math.max(max, t._count._all), 0),
  };
}

/** Shopify-hosted plan selection page. Null until SHOPIFY_APP_HANDLE is set. */
export function planSelectionUrl(domain: string): string | null {
  const appHandle = env().SHOPIFY_APP_HANDLE;
  if (!appHandle) return null;
  const storeHandle = domain.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}/charges/${encodeURIComponent(appHandle)}/pricing_plans`;
}

/**
 * app_subscriptions/update (sent for Billing API subscriptions): mark the
 * cached plan stale so the next request re-checks it with Shopify.
 */
export async function applySubscriptionWebhook(domain: string) {
  const shop = await prisma.shop.findUnique({ where: { domain } });
  if (!shop) return;
  await prisma.billingSubscription.updateMany({
    where: { shopId: shop.id },
    data: { lastCheckedAt: null },
  });
}
