import prisma from "../../db.server";
import {
  frequencyName,
  frequencyOption,
  validateSubscriptionPlan,
  type SubscriptionPlanInput,
} from "../../lib/subscription-plans";
import { NotFoundError, ValidationError } from "../errors";
import { logger } from "../logger";
import type { AdminGraphqlClient } from "../shopify/graphql";
import { fetchProductsByIds } from "../shopify/products";
import {
  addSellingPlanGroupProducts,
  createSellingPlanGroup,
  fetchSellingPlanGroupState,
  deleteSellingPlanGroup,
  removeSellingPlanGroupProducts,
  updateSellingPlanGroup,
  type SellingPlanGroupSpec,
} from "../shopify/subscription-plans";
import { recordAudit } from "./audit.service";

/**
 * Subscription plans (Shopify selling plan groups) created in BundleBoost.
 * The database is written first; Shopify is then reconciled. A Shopify
 * failure is stored as syncStatus=ERROR with the message, and can be retried.
 */

export type PlanContext = { shopId: string; actorId: string | null; admin: AdminGraphqlClient };

const include = {
  frequencies: { orderBy: { position: "asc" } },
  products: { orderBy: { title: "asc" } },
} as const;

export async function listSubscriptionPlans(shopId: string) {
  return prisma.subscriptionPlan.findMany({ where: { shopId }, orderBy: { createdAt: "asc" }, include });
}

/** Products offered on a subscription plan that's live in Shopify (for the campaign editor). */
export async function productsWithSubscriptionPlans(shopId: string) {
  const rows = await prisma.subscriptionPlanProduct.findMany({
    where: { shopId, plan: { syncStatus: "SYNCED" } },
    select: { productGid: true },
    distinct: ["productGid"],
  });
  return rows.map((r) => r.productGid);
}

export async function getSubscriptionPlan(shopId: string, id: string) {
  const plan = await prisma.subscriptionPlan.findFirst({ where: { id, shopId }, include });
  if (!plan) throw new NotFoundError("Subscription plan");
  return plan;
}

type PlanDetail = Awaited<ReturnType<typeof getSubscriptionPlan>>;

function parseOrThrow(raw: unknown): SubscriptionPlanInput {
  const result = validateSubscriptionPlan(raw);
  if (!result.success) throw new ValidationError(result.fieldErrors);
  return result.data;
}

/** Products must exist in the store; their titles are kept for display. */
async function resolveProducts(admin: AdminGraphqlClient, gids: string[]) {
  const found = await fetchProductsByIds(admin, gids);
  const fieldErrors: Record<string, string> = {};
  const products = gids.flatMap((gid, i) => {
    const p = found.get(gid);
    if (!p) {
      fieldErrors[`productGids.${i}`] = "This product no longer exists in your store";
      return [];
    }
    return [{ productGid: gid, title: p.title, imageUrl: p.imageUrl }];
  });
  if (Object.keys(fieldErrors).length) throw new ValidationError(fieldErrors);
  return products;
}

function frequencyRows(input: SubscriptionPlanInput, existing: PlanDetail["frequencies"] = []) {
  return input.frequencies.map((f, position) => {
    // Keep the Shopify selling plan of an unchanged frequency, so existing
    // subscribers stay on the same plan.
    const match = existing.find((e) => e.interval === f.interval && e.intervalCount === f.intervalCount);
    return {
      interval: f.interval,
      intervalCount: f.intervalCount,
      discountPercent: f.discountPercent.toFixed(2),
      label: f.label ?? null,
      position,
      shopifySellingPlanId: match?.shopifySellingPlanId ?? null,
    };
  });
}

export async function createSubscriptionPlan(ctx: PlanContext, raw: unknown) {
  const input = parseOrThrow(raw);
  const products = await resolveProducts(ctx.admin, input.productGids);
  const plan = await prisma.$transaction(async (tx) => {
    const created = await tx.subscriptionPlan.create({
      data: { shopId: ctx.shopId, name: input.name, optionName: input.optionName },
      select: { id: true },
    });
    await tx.subscriptionFrequency.createMany({
      data: frequencyRows(input).map((f) => ({ ...f, planId: created.id })),
    });
    await tx.subscriptionPlanProduct.createMany({
      data: products.map((p) => ({ ...p, planId: created.id, shopId: ctx.shopId })),
    });
    await recordAudit(
      { shopId: ctx.shopId, actorId: ctx.actorId, action: "subscription_plan.created", entityType: "SubscriptionPlan", entityId: created.id },
      tx,
    );
    return created;
  });
  const sync = await syncSubscriptionPlan(ctx.admin, ctx.shopId, plan.id);
  return { id: plan.id, sync };
}

export async function updateSubscriptionPlan(ctx: PlanContext, id: string, raw: unknown) {
  const input = parseOrThrow(raw);
  const current = await getSubscriptionPlan(ctx.shopId, id);
  const products = await resolveProducts(ctx.admin, input.productGids);
  const rows = frequencyRows(input, current.frequencies);
  const keptPlanIds = new Set(rows.map((r) => r.shopifySellingPlanId).filter(Boolean));
  const removedPlanIds = current.frequencies
    .map((f) => f.shopifySellingPlanId)
    .filter((sid): sid is string => Boolean(sid) && !keptPlanIds.has(sid));

  await prisma.$transaction(async (tx) => {
    await tx.subscriptionPlan.update({
      where: { id, shopId: ctx.shopId },
      data: { name: input.name, optionName: input.optionName },
    });
    await tx.subscriptionFrequency.deleteMany({ where: { planId: id } });
    await tx.subscriptionFrequency.createMany({ data: rows.map((f) => ({ ...f, planId: id })) });
    await tx.subscriptionPlanProduct.deleteMany({ where: { planId: id } });
    await tx.subscriptionPlanProduct.createMany({
      data: products.map((p) => ({ ...p, planId: id, shopId: ctx.shopId })),
    });
    await recordAudit(
      { shopId: ctx.shopId, actorId: ctx.actorId, action: "subscription_plan.updated", entityType: "SubscriptionPlan", entityId: id },
      tx,
    );
  });
  const sync = await syncSubscriptionPlan(ctx.admin, ctx.shopId, id, { deletePlanIds: removedPlanIds });
  return { id, sync };
}

export async function deleteSubscriptionPlan(ctx: PlanContext, id: string) {
  const plan = await getSubscriptionPlan(ctx.shopId, id);
  // Remove it from Shopify first: a plan left behind would stay on sale.
  if (plan.shopifyGroupId) {
    try {
      await deleteSellingPlanGroup(ctx.admin, plan.shopifyGroupId);
    } catch (error) {
      logger.warn("Selling plan group delete failed", { shopId: ctx.shopId, planId: id, error });
      throw error;
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.subscriptionPlan.delete({ where: { id, shopId: ctx.shopId } });
    await recordAudit(
      { shopId: ctx.shopId, actorId: ctx.actorId, action: "subscription_plan.deleted", entityType: "SubscriptionPlan", entityId: id },
      tx,
    );
  });
}

function toSpec(plan: PlanDetail): SellingPlanGroupSpec {
  return {
    name: plan.name,
    merchantCode: `bundleboost-${plan.id}`,
    optionName: plan.optionName,
    plans: plan.frequencies.map((f) => ({
      shopifyId: f.shopifySellingPlanId,
      name: f.label || frequencyName(f.interval, f.intervalCount),
      option: frequencyOption(f.interval, f.intervalCount),
      interval: f.interval,
      intervalCount: f.intervalCount,
      discountPercent: Number(f.discountPercent),
      position: f.position + 1,
    })),
  };
}

export type PlanSyncOutcome = { ok: true } | { ok: false; error: string };

/** Creates or updates the plan's selling plan group in Shopify and records the result. */
export async function syncSubscriptionPlan(
  admin: AdminGraphqlClient,
  shopId: string,
  id: string,
  // Plans removed in this save (also found by comparing with Shopify below).
  changes: { deletePlanIds?: string[] } = {},
): Promise<PlanSyncOutcome> {
  const plan = await getSubscriptionPlan(shopId, id);
  const spec = toSpec(plan);
  try {
    let groupId = plan.shopifyGroupId;
    let planIds: Record<string, string>;
    // Reconcile with what Shopify holds now, so saving or retrying never
    // re-adds a product that's already in the group (Shopify rejects that).
    const state = groupId ? await fetchSellingPlanGroupState(admin, groupId) : null;
    if (groupId && !state) groupId = null; // deleted in Shopify: create it again
    if (groupId && state) {
      const wanted = new Set(spec.plans.map((p) => p.option));
      const byOption = new Map(state.plans.map((p) => [p.option, p.id]));
      // Match plans by their option too, in case a local id was lost.
      spec.plans = spec.plans.map((p) => ({ ...p, shopifyId: p.shopifyId ?? byOption.get(p.option) ?? null }));
      const stale = state.plans.filter((p) => !wanted.has(p.option)).map((p) => p.id);
      const deletePlanIds = [...new Set([...(changes.deletePlanIds ?? []), ...stale])].filter((sid) =>
        state.plans.some((p) => p.id === sid),
      );
      ({ planIds } = await updateSellingPlanGroup(admin, groupId, spec, deletePlanIds));

      const wantedProducts = plan.products.map((p) => p.productGid);
      await removeSellingPlanGroupProducts(
        admin,
        groupId,
        state.productIds.filter((gid) => !wantedProducts.includes(gid)),
      );
      await addSellingPlanGroupProducts(
        admin,
        groupId,
        wantedProducts.filter((gid) => !state.productIds.includes(gid)),
      );
    } else {
      const created = await createSellingPlanGroup(
        admin,
        spec,
        plan.products.map((p) => p.productGid),
      );
      groupId = created.id;
      planIds = created.planIds;
    }
    await prisma.$transaction([
      prisma.subscriptionPlan.update({
        where: { id },
        data: { shopifyGroupId: groupId, syncStatus: "SYNCED", syncError: null, lastSyncedAt: new Date() },
      }),
      ...plan.frequencies.map((f) =>
        prisma.subscriptionFrequency.update({
          where: { id: f.id },
          data: { shopifySellingPlanId: planIds[frequencyOption(f.interval, f.intervalCount)] ?? f.shopifySellingPlanId },
        }),
      ),
    ]);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shopify couldn't save the plan";
    logger.warn("Subscription plan sync failed", { shopId, planId: id, error });
    await prisma.subscriptionPlan.update({ where: { id }, data: { syncStatus: "ERROR", syncError: message } });
    return { ok: false, error: message };
  }
}
