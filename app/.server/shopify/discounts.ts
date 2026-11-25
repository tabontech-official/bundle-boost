import { ShopifyApiError } from "../errors";
import { adminQuery, type AdminGraphqlClient } from "./graphql";

/**
 * Admin API operations for the automatic app discounts that run the
 * BundleBoost Discount Function (extensions/bundleboost-quantity-breaks).
 * All operations validated against Admin API 2026-07.
 */

export const FUNCTION_HANDLE = "bundleboost-quantity-breaks";
export const CONFIG_NAMESPACE = "$app";
export const CONFIG_KEY = "function-configuration";

type UserError = { field?: string[] | null; message: string; code?: string | null };

export class DiscountUserError extends ShopifyApiError {
  constructor(public readonly userErrors: UserError[]) {
    super(userErrors.map((e) => e.message).join("; "));
  }
  /** Another automatic discount in the store already has this title. */
  get isDuplicateTitle() {
    return this.userErrors.some(
      (e) => e.field?.includes("title") || /title must be unique/i.test(e.message),
    );
  }
  /** Shopify reports a missing discount as a userError on the `id` field. */
  get isNotFound() {
    return this.userErrors.some((e) => e.field?.includes("id"));
  }
}

function assertNoUserErrors(errors: UserError[] | undefined) {
  if (errors?.length) throw new DiscountUserError(errors);
}

export type DiscountInput = {
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  combinesWith: {
    productDiscounts: boolean;
    orderDiscounts: boolean;
    shippingDiscounts: boolean;
  };
  configJson: string;
  /** Subscriptions (selling plans): which purchases, and for how many orders (0 = all). */
  appliesOnOneTimePurchase: boolean;
  appliesOnSubscription: boolean;
  recurringCycleLimit: number;
};

const CREATE = `#graphql
  mutation BundleBoostDiscountCreate($discount: DiscountAutomaticAppInput!) {
    discountAutomaticAppCreate(automaticAppDiscount: $discount) {
      automaticAppDiscount {
        discountId
        status
      }
      userErrors {
        field
        message
        code
      }
    }
  }`;

const UPDATE = `#graphql
  mutation BundleBoostDiscountUpdate($id: ID!, $discount: DiscountAutomaticAppInput!) {
    discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $discount) {
      automaticAppDiscount {
        discountId
        status
      }
      userErrors {
        field
        message
        code
      }
    }
  }`;

const ACTIVATE = `#graphql
  mutation BundleBoostDiscountActivate($id: ID!) {
    discountAutomaticActivate(id: $id) {
      automaticDiscountNode {
        id
      }
      userErrors {
        field
        message
      }
    }
  }`;

const DEACTIVATE = `#graphql
  mutation BundleBoostDiscountDeactivate($id: ID!) {
    discountAutomaticDeactivate(id: $id) {
      automaticDiscountNode {
        id
      }
      userErrors {
        field
        message
      }
    }
  }`;

const DELETE = `#graphql
  mutation BundleBoostDiscountDelete($id: ID!) {
    discountAutomaticDelete(id: $id) {
      deletedAutomaticDiscountId
      userErrors {
        field
        message
      }
    }
  }`;

const METAFIELDS_SET = `#graphql
  mutation BundleBoostMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }`;

type AppDiscountPayload = {
  automaticAppDiscount: { discountId: string; status: string } | null;
  userErrors: UserError[];
};

function discountFields(input: DiscountInput) {
  return {
    title: input.title,
    startsAt: input.startsAt.toISOString(),
    endsAt: input.endsAt ? input.endsAt.toISOString() : null,
    combinesWith: input.combinesWith,
    appliesOnOneTimePurchase: input.appliesOnOneTimePurchase,
    appliesOnSubscription: input.appliesOnSubscription,
    // Only valid when the discount applies to subscriptions.
    ...(input.appliesOnSubscription ? { recurringCycleLimit: input.recurringCycleLimit } : {}),
  };
}

export async function createAutomaticDiscount(
  admin: AdminGraphqlClient,
  input: DiscountInput,
) {
  const data = await adminQuery<{ discountAutomaticAppCreate: AppDiscountPayload }>(
    admin,
    CREATE,
    {
      discount: {
        ...discountFields(input),
        functionHandle: FUNCTION_HANDLE,
        discountClasses: ["PRODUCT"],
        metafields: [
          {
            namespace: CONFIG_NAMESPACE,
            key: CONFIG_KEY,
            type: "json",
            value: input.configJson,
          },
        ],
      },
    },
  );
  const payload = data.discountAutomaticAppCreate;
  assertNoUserErrors(payload.userErrors);
  if (!payload.automaticAppDiscount) throw new ShopifyApiError("Shopify did not return the discount.");
  return payload.automaticAppDiscount;
}

/** Updates title, dates, combinations and configuration of an existing discount. */
export async function updateAutomaticDiscount(
  admin: AdminGraphqlClient,
  id: string,
  input: DiscountInput,
) {
  const data = await adminQuery<{ discountAutomaticAppUpdate: AppDiscountPayload }>(
    admin,
    UPDATE,
    { id, discount: discountFields(input) },
  );
  const payload = data.discountAutomaticAppUpdate;
  assertNoUserErrors(payload.userErrors);

  const metafields = await adminQuery<{ metafieldsSet: { userErrors: UserError[] } }>(
    admin,
    METAFIELDS_SET,
    {
      metafields: [
        {
          ownerId: id,
          namespace: CONFIG_NAMESPACE,
          key: CONFIG_KEY,
          type: "json",
          value: input.configJson,
        },
      ],
    },
  );
  assertNoUserErrors(metafields.metafieldsSet.userErrors);
  return payload.automaticAppDiscount;
}

export async function activateAutomaticDiscount(admin: AdminGraphqlClient, id: string) {
  const data = await adminQuery<{ discountAutomaticActivate: { userErrors: UserError[] } }>(
    admin,
    ACTIVATE,
    { id },
  );
  assertNoUserErrors(data.discountAutomaticActivate.userErrors);
}

export async function deactivateAutomaticDiscount(admin: AdminGraphqlClient, id: string) {
  const data = await adminQuery<{ discountAutomaticDeactivate: { userErrors: UserError[] } }>(
    admin,
    DEACTIVATE,
    { id },
  );
  assertNoUserErrors(data.discountAutomaticDeactivate.userErrors);
}

export async function deleteAutomaticDiscount(admin: AdminGraphqlClient, id: string) {
  const data = await adminQuery<{ discountAutomaticDelete: { userErrors: UserError[] } }>(
    admin,
    DELETE,
    { id },
  );
  assertNoUserErrors(data.discountAutomaticDelete.userErrors);
}

export { METAFIELDS_SET };
