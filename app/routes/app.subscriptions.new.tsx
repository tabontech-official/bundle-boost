import { useLoaderData, type ActionFunctionArgs, type HeadersFunction, type LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAdmin } from "../.server/context";
import { toActionFailure } from "../.server/errors";
import { readJsonBody } from "../.server/request";
import { createSubscriptionPlan } from "../.server/services/subscription-plan.service";
import { fetchProductsByIds } from "../.server/shopify/products";
import { RouteError } from "../components/RouteError";
import { EMPTY_SUBSCRIPTION_PLAN, SubscriptionPlanForm } from "../components/SubscriptionPlanForm";

/** Most products a plan can be prefilled with from a link (e.g. from a campaign). */
const MAX_PREFILL_PRODUCTS = 50;

/**
 * `?products=123,456` (numeric product ids) prefills the plan's products,
 * e.g. from "Add subscription plan" in the campaign editor. Products that no
 * longer exist are left out.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await requireAdmin(request);
  const ids = (new URL(request.url).searchParams.get("products") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^\d+$/.test(id))
    .slice(0, MAX_PREFILL_PRODUCTS);
  if (!ids.length) return { products: [] };
  const gids = [...new Set(ids)].map((id) => `gid://shopify/Product/${id}`);
  const found = await fetchProductsByIds(admin, gids);
  return {
    products: gids.flatMap((gid) => {
      const p = found.get(gid);
      return p
        ? [
            {
              productGid: gid,
              title: p.title,
              imageUrl: p.imageUrl,
              variantGids: [] as string[],
              variantTitles: [] as string[],
              totalVariants: p.variants.length,
            },
          ]
        : [];
    }),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, actorId, redirect } = await requireAdmin(request);
  try {
    const body = (await readJsonBody(request)) as { plan?: unknown };
    const result = await createSubscriptionPlan({ shopId: shop.id, actorId, admin }, body.plan);
    return redirect(`/app/subscriptions/${result.id}?created=1`);
  } catch (error) {
    return toActionFailure(error, { shop: shop.domain, route: "subscriptions.new" });
  }
};

export default function NewSubscriptionPlan() {
  const { products } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Create subscription plan" inlineSize="large">
      <s-link slot="breadcrumb-actions" href="/app/subscriptions">
        Subscriptions
      </s-link>
      <SubscriptionPlanForm mode="create" initial={{ ...EMPTY_SUBSCRIPTION_PLAN, products }} />
    </s-page>
  );
}

export const ErrorBoundary = RouteError;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
