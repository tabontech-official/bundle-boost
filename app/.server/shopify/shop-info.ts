import { adminQuery, type AdminGraphqlClient } from "./graphql";

const SHOP_INFO_QUERY = `#graphql
  query BundleBoostShopInfo {
    shop {
      name
      currencyCode
    }
  }`;

export type ShopInfo = { name: string; currencyCode: string };

export async function fetchShopInfo(admin: AdminGraphqlClient): Promise<ShopInfo> {
  const data = await adminQuery<{ shop: ShopInfo }>(admin, SHOP_INFO_QUERY);
  return data.shop;
}

const BILLING_MODE_QUERY = `#graphql
  query BundleBoostShopBillingMode {
    shop {
      plan {
        partnerDevelopment
      }
    }
  }`;

/**
 * Whether app charges for this store must be test charges. Development stores
 * only accept test charges ("The shop cannot accept the provided charge"),
 * and real stores must get real ones, so it depends on the store, not on
 * where the app runs. BILLING_TEST=true forces test charges everywhere.
 */
export async function usesTestCharges(admin: AdminGraphqlClient): Promise<boolean> {
  if (process.env.BILLING_TEST === "true") return true;
  try {
    const data = await adminQuery<{ shop: { plan: { partnerDevelopment: boolean } | null } }>(
      admin,
      BILLING_MODE_QUERY,
    );
    return Boolean(data.shop.plan?.partnerDevelopment);
  } catch {
    // Unknown: a test charge can't bill a real merchant by mistake.
    return true;
  }
}
