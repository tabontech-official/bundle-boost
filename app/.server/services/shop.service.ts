import { Prisma, type Shop } from "@prisma/client";
import prisma from "../../db.server";
import { logger } from "../logger";
import { fetchShopInfo } from "../shopify/shop-info";
import type { AdminGraphqlClient } from "../shopify/graphql";
import { syncPendingCampaigns } from "./discount-sync.service";
import { syncStorefrontConfig } from "./storefront-sync.service";

/**
 * Creates or reactivates the tenant record for a shop and makes sure its
 * default settings rows exist. Called from the `afterAuth` hook (install and
 * reinstall) and lazily from the app layout if the hook never ran.
 */
export async function onShopAuthenticated(
  domain: string,
  admin: AdminGraphqlClient,
) {
  let info: { name: string; currencyCode: string } | null = null;
  try {
    info = await fetchShopInfo(admin);
  } catch (error) {
    if (error instanceof Response) throw error;
    // Shop metadata is cosmetic; never block installation on it.
    logger.warn("Could not fetch shop info", { shop: domain, error });
  }

  const previous = await prisma.shop.findUnique({
    where: { domain },
    select: { uninstalledAt: true },
  });

  let shop: Shop;
  try {
    shop = await prisma.shop.upsert({
      where: { domain },
      create: {
        domain,
        name: info?.name,
        currencyCode: info?.currencyCode,
        settings: { create: {} },
        widgetSettings: { create: {} },
        subscription: { create: {} },
      },
      update: {
        uninstalledAt: null,
        ...(info ? { name: info.name, currencyCode: info.currencyCode } : {}),
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      // Concurrently created by a parallel loader (e.g. app.tsx and app._index.tsx running at the exact same moment).
      const found = await prisma.shop.findUnique({ where: { domain } });
      if (!found) throw error;
      shop = found;
    } else {
      throw error;
    }
  }

  // Rows may be missing for shops created before a model was introduced.
  await Promise.allSettled([
    prisma.shopSettings.upsert({
      where: { shopId: shop.id },
      create: { shopId: shop.id },
      update: {},
    }),
    prisma.widgetSettings.upsert({
      where: { shopId: shop.id },
      create: { shopId: shop.id },
      update: {},
    }),
    prisma.billingSubscription.upsert({
      where: { shopId: shop.id },
      create: { shopId: shop.id },
      update: {},
    }),
  ]);

  // Reinstall: restore checkout discounts and storefront data for campaigns
  // that were active before the app was removed.
  if (previous?.uninstalledAt) {
    try {
      await syncPendingCampaigns(admin, shop.id);
      await syncStorefrontConfig(admin, shop.id);
    } catch (error) {
      if (error instanceof Response) throw error;
      logger.error("Post-reinstall sync failed", { shop: domain, error });
    }
  }

  logger.info("Shop authenticated", { shop: domain });
  return shop;
}

export async function findShopByDomain(domain: string) {
  return prisma.shop.findUnique({ where: { domain } });
}

/**
 * app/uninstalled: revoke access immediately by deleting sessions (and with
 * them the access tokens). Merchant configuration is kept so a reinstall
 * within the grace period restores it; shop/redact removes it for good.
 */
export async function markShopUninstalled(domain: string) {
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { shop: domain } }),
    prisma.shop.updateMany({
      where: { domain },
      data: { uninstalledAt: new Date(), storefrontSyncedAt: null },
    }),
    // Shopify state can't be trusted after uninstall; ids are kept so a
    // reinstall updates (or recreates) the same discounts without duplicates.
    prisma.campaign.updateMany({
      where: { shop: { domain }, shopifyDiscountId: { not: null } },
      data: { syncStatus: "NOT_SYNCED" },
    }),
  ]);
}

/**
 * shop/redact (sent 48h after uninstall): permanently delete everything the
 * app stores for the shop. Child rows cascade from Shop.
 */
export async function redactShop(domain: string) {
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { shop: domain } }),
    prisma.shop.deleteMany({ where: { domain } }),
  ]);
}
