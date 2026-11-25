/**
 * Data for the "My subscriptions" page.
 *
 * - BundleBoost's backend (with Shopify's session token): the customer's
 *   subscriptions and changes to them.
 * - Shopify's Customer Account API: the delivery address, so shipping is
 *   recalculated for the new address.
 */

export type Address = {
  firstName: string | null;
  lastName: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  provinceCode: string | null;
  country: string | null;
  countryCode: string | null;
  zip: string | null;
};

export type Subscription = {
  id: string;
  status: "ACTIVE" | "PAUSED" | "CANCELLED" | "EXPIRED" | "FAILED";
  createdAt: string;
  currencyCode: string;
  amount: string;
  deliveryPrice: string | null;
  frequency: string;
  nextBillingDate: string | null;
  skippedDate: string | null;
  lines: { title: string; variantTitle: string | null; quantity: number; price: string; imageUrl: string | null; imageAlt: string | null }[];
  payment: { id: string; description: string; expires: string | null } | null;
  address: Address | null;
  frequencies: { id: string; label: string; discountPercent: number; current: boolean }[];
  orders: { id: string; name: string; createdAt: string; total: string; currencyCode: string; fulfillment: string }[];
  failedCharges: { date: string; message: string }[];
};

export type Action =
  | { action: "skip" | "unskip" | "pause" | "resume" | "cancel" | "payment" }
  | { action: "frequency"; frequencyId: string };

// This module is shared by the page, so it isn't in the typings Shopify CLI
// generates (shopify.d.ts); give it the page's \`shopify\` global type here.
declare const shopify: import("@shopify/ui-extensions/customer-account.page.render").Api;

// BundleBoost's backend. Shopify CLI replaces process.env.APP_URL with the
// dev tunnel during `shopify app dev` only; a released version (shopify app
// deploy) uses the production URL. Keep it in sync with application_url in
// shopify.app.production.toml.
declare const process: { env: { APP_URL?: string } } | undefined;
const PRODUCTION_APP_URL = "https://bundle-boost-theta.vercel.app";

function appUrl() {
  try {
    // In dev this expression is replaced with the tunnel URL; in a released
    // build `process` doesn't exist and it throws, so the catch applies.
    return process!.env.APP_URL || PRODUCTION_APP_URL;
  } catch {
    return PRODUCTION_APP_URL;
  }
}

const APP_URL = appUrl().replace(/\/$/, "");
const ENDPOINT = `${APP_URL}/api/portal/subscriptions`;

export class PortalError extends Error {}

async function backend<T>(init: RequestInit = {}): Promise<T> {
  const token = await shopify.sessionToken.get();
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
  } catch {
    throw new PortalError(shopify.i18n.translate("errors.network"));
  }
  const body = (await response.json().catch(() => null)) as ({ ok: boolean; message?: string } & T) | null;
  if (!response.ok || !body?.ok) {
    throw new PortalError(body?.message || shopify.i18n.translate("errors.generic"));
  }
  return body;
}

/** The customer's subscriptions, with each one's delivery address. */
export async function loadSubscriptions() {
  const [body, addresses] = await Promise.all([
    backend<{ subscriptions: Omit<Subscription, "address">[] }>(),
    // The address isn't essential to the page: show it when it loads.
    loadAddresses().catch(() => new Map<string, Address>()),
  ]);
  return body.subscriptions.map((s) => ({ ...s, address: addresses.get(s.id) ?? null }));
}

/** Applies the change and returns the updated subscription (address unchanged). */
export async function changeSubscription(contractId: string, action: Action, address: Address | null) {
  const body = await backend<{ subscription: Omit<Subscription, "address"> }>({
    method: "POST",
    body: JSON.stringify({ contractId, ...action }),
  });
  return { ...body.subscription, address };
}

// ---------------------------------------------------------------------------
// Delivery address (Customer Account API)
// ---------------------------------------------------------------------------

const CUSTOMER_API = "shopify://customer-account/api/2026-10/graphql.json";

export type AddressInput = {
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string;
  city: string;
  zoneCode?: string;
  countryCode: string;
  zip: string;
};

async function customerApi<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(CUSTOMER_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new PortalError(shopify.i18n.translate("errors.network"));
  }
  const body = (await response.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null;
  if (!body?.data || body.errors?.length) throw new PortalError(shopify.i18n.translate("errors.generic"));
  return body.data;
}

const SUBSCRIPTION_ADDRESSES = `
  query BundleBoostSubscriptionAddresses {
    customer {
      subscriptionContracts(first: 25, reverse: true) {
        nodes {
          id
          deliveryMethod {
            __typename
            ... on SubscriptionDeliveryMethodShipping {
              address {
                firstName
                lastName
                address1
                address2
                city
                province
                provinceCode
                country
                countryCode
                zip
              }
            }
          }
        }
      }
    }
  }`;

/**
 * Delivery addresses, read as the customer (their own data). BundleBoost's
 * backend doesn't read addresses: they're protected customer data.
 */
export async function loadAddresses() {
  const data = await customerApi<{
    customer: { subscriptionContracts: { nodes: { id: string; deliveryMethod: { address?: Address } | null }[] } };
  }>(SUBSCRIPTION_ADDRESSES, {});
  return new Map(
    data.customer.subscriptionContracts.nodes
      .filter((c) => c.deliveryMethod?.address)
      .map((c) => [c.id, c.deliveryMethod!.address!] as const),
  );
}

const FETCH_DELIVERY_OPTIONS = `
  mutation BundleBoostDeliveryOptions($id: ID!, $address: CustomerAddressInput!) {
    subscriptionContractFetchDeliveryOptions(subscriptionContractId: $id, address: $address) {
      deliveryOptionsResult {
        __typename
        ... on SubscriptionDeliveryOptionsResultSuccess {
          token
          deliveryOptions {
            __typename
            ... on SubscriptionShippingOption {
              title
              code
              presentmentTitle
              price {
                amount
                currencyCode
              }
            }
          }
        }
        ... on SubscriptionDeliveryOptionsResultFailure {
          message
        }
      }
      userErrors {
        field
        message
      }
    }
  }`;

const SELECT_DELIVERY_METHOD = `
  mutation BundleBoostSelectDelivery($id: ID!, $token: String!, $method: SubscriptionDeliveryMethodInput!) {
    subscriptionContractSelectDeliveryMethod(
      subscriptionContractId: $id
      subscriptionDeliveryOptionsResultToken: $token
      deliveryMethodInput: $method
    ) {
      contract {
        id
      }
      userErrors {
        field
        message
      }
    }
  }`;

type UserError = { field?: string[] | null; message: string };

export type ShippingQuote = { token: string; title: string; price: { amount: string; currencyCode: string } | null };

/** Checks Shopify can ship this subscription to the address, and at what price. */
export async function quoteAddress(contractId: string, address: AddressInput): Promise<ShippingQuote> {
  const data = await customerApi<{
    subscriptionContractFetchDeliveryOptions: {
      deliveryOptionsResult:
        | {
            __typename: "SubscriptionDeliveryOptionsResultSuccess";
            token: string;
            deliveryOptions: { __typename: string; title?: string; presentmentTitle?: string | null; price?: { amount: string; currencyCode: string } }[];
          }
        | { __typename: "SubscriptionDeliveryOptionsResultFailure"; message: string }
        | null;
      userErrors: UserError[];
    };
  }>(FETCH_DELIVERY_OPTIONS, { id: contractId, address });
  const payload = data.subscriptionContractFetchDeliveryOptions;
  if (payload.userErrors.length) throw new PortalError(payload.userErrors[0].message);
  const result = payload.deliveryOptionsResult;
  if (!result) throw new PortalError(shopify.i18n.translate("errors.generic"));
  if (result.__typename === "SubscriptionDeliveryOptionsResultFailure") throw new PortalError(result.message);
  const shipping = result.deliveryOptions.find((o) => o.__typename === "SubscriptionShippingOption");
  if (!shipping) throw new PortalError(shopify.i18n.translate("address.noShipping"));
  return {
    token: result.token,
    title: shipping.presentmentTitle || shipping.title || "",
    price: shipping.price ?? null,
  };
}

export async function saveAddress(contractId: string, token: string, address: AddressInput) {
  const data = await customerApi<{ subscriptionContractSelectDeliveryMethod: { userErrors: UserError[] } }>(
    SELECT_DELIVERY_METHOD,
    { id: contractId, token, method: { shipping: { shippingAddress: address } } },
  );
  const errors = data.subscriptionContractSelectDeliveryMethod.userErrors;
  if (errors.length) throw new PortalError(errors[0].message);
}
