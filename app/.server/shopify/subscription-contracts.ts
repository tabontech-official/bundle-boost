import { ShopifyApiError } from "../errors";
import { adminQuery, type AdminGraphqlClient } from "./graphql";

/**
 * Admin API operations for subscription contracts BundleBoost owns
 * (bought on its selling plans): reading them, charging renewals per billing
 * cycle, and pause / resume / cancel / skip. Requires the protected
 * Subscription API scopes. Validated against Admin API 2026-07.
 */

type UserError = { field?: string[] | null; message: string; code?: string | null };

export class ContractUserError extends ShopifyApiError {
  constructor(public readonly userErrors: UserError[]) {
    super(userErrors.map((e) => e.message).join("; "));
  }
}

function assertNoUserErrors(errors: UserError[] | undefined) {
  if (errors?.length) throw new ContractUserError(errors);
}

const CONTRACT_FIELDS = `
  id
  status
  nextBillingDate
  currencyCode
  billingPolicy {
    interval
    intervalCount
  }
  lines(first: 20) {
    nodes {
      title
      variantTitle
      quantity
      currentPrice {
        amount
      }
    }
  }`;

const CONTRACT_QUERY = `#graphql
  query BundleBoostSubscriptionContract($id: ID!) {
    subscriptionContract(id: $id) {${CONTRACT_FIELDS}
      customer {
        id
        displayName
        defaultEmailAddress {
          emailAddress
        }
      }
      originOrder {
        id
        name
      }
    }
  }`;

// Without the email: protected customer data is approved per field, and a
// field the app isn't approved for fails the whole query.
const CONTRACT_QUERY_NO_EMAIL = `#graphql
  query BundleBoostSubscriptionContractNoEmail($id: ID!) {
    subscriptionContract(id: $id) {${CONTRACT_FIELDS}
      customer {
        id
        displayName
      }
      originOrder {
        id
        name
      }
    }
  }`;

// Same contract without customer/order details, for stores where the app
// hasn't been granted protected customer data.
const CONTRACT_QUERY_MINIMAL = `#graphql
  query BundleBoostSubscriptionContractMinimal($id: ID!) {
    subscriptionContract(id: $id) {${CONTRACT_FIELDS}
    }
  }`;

export type ShopifyContract = {
  id: string;
  status: string;
  nextBillingDate: string | null;
  currencyCode: string;
  billingPolicy: { interval: string; intervalCount: number };
  lines: { nodes: { title: string; variantTitle: string | null; quantity: number; currentPrice: { amount: string } }[] };
  customer?: { id: string; displayName: string | null; defaultEmailAddress?: { emailAddress: string } | null } | null;
  originOrder?: { id: string; name: string } | null;
};

/** The contract with as much customer detail as the app is approved for. */
export async function fetchContract(admin: AdminGraphqlClient, id: string): Promise<ShopifyContract | null> {
  const queries = [CONTRACT_QUERY, CONTRACT_QUERY_NO_EMAIL, CONTRACT_QUERY_MINIMAL];
  for (const [i, query] of queries.entries()) {
    try {
      const data = await adminQuery<{ subscriptionContract: ShopifyContract | null }>(admin, query, { id });
      return data.subscriptionContract;
    } catch (error) {
      if (i === queries.length - 1) throw error;
    }
  }
  return null;
}

const BILLING_CYCLE = `#graphql
  query BundleBoostBillingCycle($contractId: ID!, $selector: SubscriptionBillingCycleSelector!) {
    subscriptionBillingCycle(billingCycleInput: { contractId: $contractId, selector: $selector }) {
      cycleIndex
      billingAttemptExpectedDate
      skipped
      status
    }
  }`;

export type BillingCycle = {
  cycleIndex: number;
  billingAttemptExpectedDate: string;
  skipped: boolean;
  /** BILLED or UNBILLED. */
  status: string;
};

export type CycleSelector = { index: number } | { date: string };

export async function fetchBillingCycle(admin: AdminGraphqlClient, contractId: string, selector: CycleSelector) {
  const data = await adminQuery<{ subscriptionBillingCycle: BillingCycle | null }>(admin, BILLING_CYCLE, {
    contractId,
    selector,
  });
  return data.subscriptionBillingCycle;
}

const CHARGE = `#graphql
  mutation BundleBoostBillingCycleCharge($contractId: ID!, $selector: SubscriptionBillingCycleSelector!) {
    subscriptionBillingCycleCharge(subscriptionContractId: $contractId, billingCycleSelector: $selector) {
      subscriptionBillingAttempt {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }`;

/** Starts the renewal charge for one billing cycle. The result arrives by webhook. */
export async function chargeBillingCycle(admin: AdminGraphqlClient, contractId: string, cycleIndex: number) {
  const data = await adminQuery<{
    subscriptionBillingCycleCharge: { subscriptionBillingAttempt: { id: string } | null; userErrors: UserError[] };
  }>(admin, CHARGE, { contractId, selector: { index: cycleIndex } });
  const payload = data.subscriptionBillingCycleCharge;
  assertNoUserErrors(payload.userErrors);
  if (!payload.subscriptionBillingAttempt) throw new ShopifyApiError("Shopify did not start the charge.");
  return payload.subscriptionBillingAttempt.id;
}

const SKIP = `#graphql
  mutation BundleBoostBillingCycleSkip($contractId: ID!, $selector: SubscriptionBillingCycleSelector!) {
    subscriptionBillingCycleSkip(billingCycleInput: { contractId: $contractId, selector: $selector }) {
      billingCycle {
        cycleIndex
        skipped
      }
      userErrors {
        field
        message
      }
    }
  }`;

export async function skipBillingCycle(admin: AdminGraphqlClient, contractId: string, cycleIndex: number) {
  const data = await adminQuery<{ subscriptionBillingCycleSkip: { userErrors: UserError[] } }>(admin, SKIP, {
    contractId,
    selector: { index: cycleIndex },
  });
  assertNoUserErrors(data.subscriptionBillingCycleSkip.userErrors);
}

const UNSKIP = `#graphql
  mutation BundleBoostBillingCycleUnskip($contractId: ID!, $selector: SubscriptionBillingCycleSelector!) {
    subscriptionBillingCycleUnskip(billingCycleInput: { contractId: $contractId, selector: $selector }) {
      billingCycle {
        cycleIndex
        skipped
        billingAttemptExpectedDate
      }
      userErrors {
        field
        message
      }
    }
  }`;

/** Brings a skipped order (billing cycle) back. */
export async function unskipBillingCycle(admin: AdminGraphqlClient, contractId: string, cycleIndex: number) {
  const data = await adminQuery<{ subscriptionBillingCycleUnskip: { userErrors: UserError[] } }>(admin, UNSKIP, {
    contractId,
    selector: { index: cycleIndex },
  });
  assertNoUserErrors(data.subscriptionBillingCycleUnskip.userErrors);
}

const STATUS_MUTATIONS = {
  pause: `#graphql
    mutation BundleBoostContractPause($id: ID!) {
      subscriptionContractPause(subscriptionContractId: $id) {
        contract {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }`,
  activate: `#graphql
    mutation BundleBoostContractActivate($id: ID!) {
      subscriptionContractActivate(subscriptionContractId: $id) {
        contract {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }`,
  cancel: `#graphql
    mutation BundleBoostContractCancel($id: ID!) {
      subscriptionContractCancel(subscriptionContractId: $id) {
        contract {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }`,
} as const;

const PAYLOAD_KEY = {
  pause: "subscriptionContractPause",
  activate: "subscriptionContractActivate",
  cancel: "subscriptionContractCancel",
} as const;

export async function setContractStatus(
  admin: AdminGraphqlClient,
  id: string,
  action: keyof typeof STATUS_MUTATIONS,
): Promise<string> {
  const data = await adminQuery<Record<string, { contract: { status: string } | null; userErrors: UserError[] }>>(
    admin,
    STATUS_MUTATIONS[action],
    { id },
  );
  const payload = data[PAYLOAD_KEY[action]];
  assertNoUserErrors(payload.userErrors);
  if (!payload.contract) throw new ShopifyApiError("Shopify did not return the subscription.");
  return payload.contract.status;
}
