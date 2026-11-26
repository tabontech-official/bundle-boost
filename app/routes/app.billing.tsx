import { useLoaderData, type ActionFunctionArgs, type HeadersFunction, type LoaderFunctionArgs } from "react-router";
import { boundary, BillingReplacementBehavior } from "@shopify/shopify-app-react-router/server";
import { requireAdmin } from "../.server/context";
import { getShopPlan, getUsage, planSelectionUrl, cancelCurrentSubscription } from "../.server/services/billing.service";
import { BillingView } from "../components/billing/BillingView";
import { RouteError } from "../components/RouteError";
import { PLANS, type PlanHandle } from "../lib/plans";
import { PLAN_GROWTH, PLAN_PRO, type BillingPlanName } from "../shopify.server";
import { env } from "../.server/env";
import { usesTestCharges } from "../.server/shopify/shop-info";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  // Always confirm with Shopify here (this is also where merchants land back
  // from the plan page or subscription approval with ?plan_handle=).
  const [shopPlan, usage] = await Promise.all([
    getShopPlan(shop.id, admin, { fresh: true }),
    getUsage(shop.id),
  ]);
  return {
    planHandle: shopPlan.plan.handle,
    verified: shopPlan.verified,
    configured: shopPlan.configured,
    renewsAt: shopPlan.renewsAt,
    trialEndsAt: shopPlan.trialEndsAt,
    cancelAtEndOfCycle: shopPlan.cancelAtEndOfCycle,
    pendingPlanHandle: shopPlan.pendingPlan?.handle ?? null,
    plansUrl: planSelectionUrl(shop.domain),
    usage,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, shop, billing } = await requireAdmin(request);
  const formData = await request.formData();
  const planHandle = String(formData.get("plan") ?? "").toLowerCase();

  if (planHandle === "free") {
    await cancelCurrentSubscription(shop.id, admin, billing);
    return { ok: true, plan: "free" };
  }

  const targetPlan = PLANS[planHandle as PlanHandle];
  if (!targetPlan || targetPlan.price === 0) {
    return { ok: false, error: "Invalid plan" };
  }

  // Development stores only accept test charges; real stores get real ones.
  const isTest = await usesTestCharges(admin);
  const planName: BillingPlanName = targetPlan.handle === "pro" ? PLAN_PRO : PLAN_GROWTH;
  const cleanShopName = session.shop.replace(/\.myshopify\.com$/, "");
  const apiKey = env().SHOPIFY_API_KEY;
  const returnUrl = `https://admin.shopify.com/store/${cleanShopName}/apps/${apiKey}/app/billing?plan_handle=${planHandle}`;

  return await billing.request({
    plan: planName,
    isTest,
    returnUrl,
    replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
  });
};

export default function Billing() {
  const data = useLoaderData<typeof loader>();
  return <BillingView data={data} />;
}

export const ErrorBoundary = RouteError;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
