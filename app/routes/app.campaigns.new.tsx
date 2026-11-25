import { useLoaderData, type ActionFunctionArgs, type HeadersFunction, type LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAdmin } from "../.server/context";
import { toActionFailure } from "../.server/errors";
import { readJsonBody } from "../.server/request";
import { createDraftCampaign } from "../.server/services/campaign.service";
import { getShopSettings } from "../.server/services/settings.service";
import { getShopPlan } from "../.server/services/billing.service";
import { productsWithSubscriptionPlans } from "../.server/services/subscription-plan.service";
import { CampaignForm, EMPTY_CAMPAIGN } from "../components/CampaignForm";
import { RouteError } from "../components/RouteError";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  const [settings, { plan }, planProductGids] = await Promise.all([
    getShopSettings(shop.id),
    getShopPlan(shop.id, admin),
    productsWithSubscriptionPlans(shop.id),
  ]);
  return {
    currencyCode: shop.currencyCode,
    defaultLabel: settings.defaultDiscountLabel,
    maxTiers: plan.tiersPerCampaign,
    planName: plan.name,
    planProductGids,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, actorId, redirect } = await requireAdmin(request);
  try {
    const body = await readJsonBody(request);
    const campaign = await createDraftCampaign(
      { shopId: shop.id, actorId, admin },
      body.campaign,
    );
    return redirect(`/app/campaigns/${campaign.id}?created=1`);
  } catch (error) {
    return toActionFailure(error, { shop: shop.domain, route: "campaigns.new" });
  }
};

export default function NewCampaign() {
  const { currencyCode, defaultLabel, maxTiers, planName, planProductGids } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Create campaign" inlineSize="large">
      <s-link slot="breadcrumb-actions" href="/app/campaigns">
        Campaigns
      </s-link>
      <CampaignForm
        mode="create"
        initial={EMPTY_CAMPAIGN}
        currencyCode={currencyCode}
        defaultLabel={defaultLabel}
        maxTiers={maxTiers}
        planName={planName}
        planProductGids={planProductGids}
        head={<span className="bb-state bb-state--draft">Saved as a draft</span>}
        statusCard={
          <section className="bb-glass bb-editcard">
            <header className="bb-cardhead">
              <h2>Status</h2>
            </header>
            <div className="bb-statusline">
              <span className="bb-state bb-state--draft">Draft</span>
            </div>
            <p className="bb-statusnote" style={{ marginBlockEnd: 0 }}>
              New campaigns start as drafts and aren’t applied at checkout. Activate it after saving, when it’s
              ready.
            </p>
          </section>
        }
      />
    </s-page>
  );
}

export const ErrorBoundary = RouteError;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
