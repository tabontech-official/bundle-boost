import prisma from "../../db.server";
import { serializeFunctionConfig } from "../../lib/discount-config";
import { AppError } from "../errors";
import { logger } from "../logger";
import {
  activateAutomaticDiscount,
  createAutomaticDiscount,
  deactivateAutomaticDiscount,
  deleteAutomaticDiscount,
  DiscountUserError,
  updateAutomaticDiscount,
  type DiscountInput,
} from "../shopify/discounts";
import type { AdminGraphqlClient } from "../shopify/graphql";
import { findCampaign, type CampaignDetail } from "../repositories/campaign.repository";

/**
 * Keeps each campaign's Shopify automatic app discount in line with the
 * campaign's status in BundleBoost:
 *
 *   ACTIVE          → discount exists, active, configuration current
 *   PAUSED          → discount exists, deactivated
 *   DRAFT/ARCHIVED  → no discount
 *
 * BundleBoost's database is written first; Shopify is then reconciled. A
 * Shopify failure never rolls back the merchant's change — it is recorded as
 * syncStatus=ERROR with the message, and can be retried.
 */

export type SyncOutcome = { ok: true } | { ok: false; error: string };

/** The text shoppers see at checkout (the Function's message). */
export function discountTitle(campaign: Pick<CampaignDetail, "discountLabel" | "name">, defaultLabel: string) {
  return campaign.discountLabel || defaultLabel || campaign.name;
}

const MAX_TITLE_LENGTH = 255;

/**
 * The discount's title in Shopify, which must be unique among the store's
 * automatic discounts: the shopper-facing label plus the campaign name, e.g.
 * "Volume discount · Socks bundle" (several campaigns share the default
 * label). `unique` adds the campaign id for the rare name clash.
 */
export function shopifyDiscountTitle(
  campaign: Pick<CampaignDetail, "id" | "discountLabel" | "name">,
  defaultLabel: string,
  { unique = false }: { unique?: boolean } = {},
) {
  const label = discountTitle(campaign, defaultLabel);
  const name = campaign.name.trim();
  const base = name && name !== label ? `${label} · ${name}` : label;
  const suffix = unique ? ` (${campaign.id.slice(-6)})` : "";
  return base.slice(0, MAX_TITLE_LENGTH - suffix.length) + suffix;
}

export function buildDiscountInput(
  campaign: CampaignDetail,
  settings: {
    defaultDiscountLabel: string;
    combineWithProductDiscounts: boolean;
    combineWithOrderDiscounts: boolean;
    combineWithShippingDiscounts: boolean;
  },
  now = new Date(),
): DiscountInput {
  const label = discountTitle(campaign, settings.defaultDiscountLabel);
  const { json } = serializeFunctionConfig({
    discountType: campaign.discountType,
    message: label,
    products: campaign.products.map((p) => ({
      productGid: p.productGid,
      variantGids: p.variants.map((v) => v.variantGid),
    })),
    tiers: campaign.tiers.map((t) => ({ minQuantity: t.minQuantity, value: t.value.toString() })),
    purchaseType: campaign.purchaseType,
  });
  return {
    title: shopifyDiscountTitle(campaign, settings.defaultDiscountLabel),
    startsAt: campaign.startsAt && campaign.startsAt > now ? campaign.startsAt : now,
    endsAt: campaign.endsAt,
    combinesWith: {
      productDiscounts: settings.combineWithProductDiscounts,
      orderDiscounts: settings.combineWithOrderDiscounts,
      shippingDiscounts: settings.combineWithShippingDiscounts,
    },
    configJson: json,
    appliesOnOneTimePurchase: campaign.purchaseType !== "SUBSCRIPTION",
    appliesOnSubscription: campaign.purchaseType !== "ONE_TIME",
    recurringCycleLimit: campaign.recurringCycleLimit,
  };
}

async function reconcile(admin: AdminGraphqlClient, campaign: CampaignDetail) {
  const id = campaign.shopifyDiscountId;

  if (campaign.status === "DRAFT" || campaign.status === "ARCHIVED") {
    if (id) {
      try {
        await deleteAutomaticDiscount(admin, id);
      } catch (error) {
        // Already gone (deleted in Shopify admin or on uninstall) is success.
        if (!(error instanceof DiscountUserError && error.isNotFound)) throw error;
      }
    }
    return null;
  }

  if (campaign.status === "PAUSED") {
    if (id) {
      try {
        await deactivateAutomaticDiscount(admin, id);
      } catch (error) {
        if (!(error instanceof DiscountUserError && error.isNotFound)) throw error;
        return null;
      }
    }
    return id;
  }

  // ACTIVE
  const settings = await prisma.shopSettings.findUniqueOrThrow({
    where: { shopId: campaign.shopId },
  });
  let input = buildDiscountInput(campaign, settings);
  // Retried once with the campaign id in the title if another discount has it.
  const withUniqueTitle = () => ({
    ...input,
    title: shopifyDiscountTitle(campaign, settings.defaultDiscountLabel, { unique: true }),
  });
  const isDuplicateTitle = (error: unknown) => error instanceof DiscountUserError && error.isDuplicateTitle;

  if (id) {
    try {
      let updated;
      try {
        updated = await updateAutomaticDiscount(admin, id, input);
      } catch (error) {
        if (!isDuplicateTitle(error)) throw error;
        input = withUniqueTitle();
        updated = await updateAutomaticDiscount(admin, id, input);
      }
      // Pausing sets an end date in Shopify (status EXPIRED); clearing it on
      // update usually restores ACTIVE, but activate explicitly if not.
      if (updated?.status === "EXPIRED" && (!input.endsAt || input.endsAt > new Date())) {
        await activateAutomaticDiscount(admin, id);
      }
      return id;
    } catch (error) {
      if (!(error instanceof DiscountUserError && error.isNotFound)) throw error;
      logger.warn("Shopify discount missing; recreating", { campaignId: campaign.id });
    }
  }
  try {
    return (await createAutomaticDiscount(admin, input)).discountId;
  } catch (error) {
    if (!isDuplicateTitle(error)) throw error;
    return (await createAutomaticDiscount(admin, withUniqueTitle())).discountId;
  }
}

export async function syncCampaignDiscount(
  admin: AdminGraphqlClient,
  shopId: string,
  campaignId: string,
): Promise<SyncOutcome> {
  const campaign = await findCampaign(shopId, campaignId);
  if (!campaign) return { ok: true }; // deleted campaigns are handled by deleteCampaign

  try {
    const discountId = await reconcile(admin, campaign);
    await prisma.campaign.update({
      where: { id: campaign.id, shopId },
      data: {
        shopifyDiscountId: discountId,
        syncStatus: discountId ? "SYNCED" : "NOT_SYNCED",
        syncError: null,
        lastSyncedAt: new Date(),
      },
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof Response) throw error; // re-authentication
    const message =
      error instanceof AppError ? error.message : "Shopify couldn't be reached. Try again.";
    logger.error("Discount sync failed", { shopId, campaignId, error });
    await prisma.campaign.update({
      where: { id: campaign.id, shopId },
      data: { syncStatus: "ERROR", syncError: message.slice(0, 500) },
    });
    return { ok: false, error: message };
  }
}

/** Removes a campaign's discount from Shopify before the campaign is deleted. */
export async function removeCampaignDiscount(admin: AdminGraphqlClient, discountId: string) {
  try {
    await deleteAutomaticDiscount(admin, discountId);
  } catch (error) {
    if (!(error instanceof DiscountUserError && error.isNotFound)) throw error;
  }
}

/**
 * Re-syncs every campaign whose Shopify state is unknown or failed — used
 * after reinstall (Shopify removes an app's discounts on uninstall) and when
 * shop-level combination settings change.
 */
export async function syncPendingCampaigns(
  admin: AdminGraphqlClient,
  shopId: string,
  options: { includeSynced?: boolean } = {},
) {
  const campaigns = await prisma.campaign.findMany({
    where: {
      shopId,
      status: { in: ["ACTIVE", "PAUSED"] },
      ...(options.includeSynced ? {} : { syncStatus: { not: "SYNCED" } }),
    },
    select: { id: true },
  });
  const results: SyncOutcome[] = [];
  for (const { id } of campaigns) {
    results.push(await syncCampaignDiscount(admin, shopId, id));
  }
  return results;
}
