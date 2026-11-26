import { useEffect } from "react";
import {
  data,
  useFetcher,
  useLoaderData,
  useSearchParams,
  type ActionFunctionArgs,
  type HeadersFunction,
  type LoaderFunctionArgs,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { z } from "zod";
import { toCampaignDto } from "../.server/campaign-dto";
import { requireAdmin } from "../.server/context";
import { NotFoundError, toActionFailure, ValidationError } from "../.server/errors";
import { readJsonBody } from "../.server/request";
import {
  changeCampaignStatus,
  deleteCampaign,
  getCampaign,
  updateCampaign,
} from "../.server/services/campaign.service";
import { getShopSettings } from "../.server/services/settings.service";
import { getShopPlan } from "../.server/services/billing.service";
import { productsWithSubscriptionPlans } from "../.server/services/subscription-plan.service";
import { syncCampaignDiscount } from "../.server/services/discount-sync.service";
import { syncStorefrontConfig } from "../.server/services/storefront-sync.service";
import { CampaignForm } from "../components/CampaignForm";
import { RouteError } from "../components/RouteError";
import { allowedTransitions, CAMPAIGN_STATUSES, type CampaignStatusValue } from "../lib/campaign-validation";
import { campaignState } from "../lib/campaign-state";
import { on } from "../components/bool-attrs";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  try {
    const [campaign, settings, { plan }, planProductGids] = await Promise.all([
      getCampaign(shop.id, params.id ?? ""),
      getShopSettings(shop.id),
      getShopPlan(shop.id, admin),
      productsWithSubscriptionPlans(shop.id),
    ]);
    return {
      campaign: toCampaignDto(campaign),
      currencyCode: shop.currencyCode,
      defaultLabel: settings.defaultDiscountLabel,
      maxTiers: plan.tiersPerCampaign,
      planName: plan.name,
      planProductGids,
    };
  } catch (error) {
    if (error instanceof NotFoundError) throw data(null, { status: 404 });
    throw error;
  }
};

const intentSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("save"), campaign: z.unknown() }),
  z.object({ intent: z.literal("status"), status: z.enum(CAMPAIGN_STATUSES) }),
  z.object({ intent: z.literal("delete") }),
  z.object({ intent: z.literal("sync") }),
]);

type SyncSummary = {
  discount: { ok: boolean; error?: string } | null;
  storefront: { ok: boolean; error?: string } | null;
};

/** Toast text that never claims checkout is updated when the sync failed. */
function withSyncMessage(base: string, sync: SyncSummary) {
  if (sync.discount && !sync.discount.ok) {
    return { ok: true as const, message: `${base}, but Shopify checkout couldn't be updated` };
  }
  if (sync.storefront && !sync.storefront.ok) {
    return { ok: true as const, message: `${base}, but the storefront widget couldn't be updated` };
  }
  return { ok: true as const, message: base };
}

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, shop, actorId, redirect } = await requireAdmin(request);
  const ctx = { shopId: shop.id, actorId, admin };
  const id = params.id ?? "";
  try {
    const parsed = intentSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new ValidationError({ form: "Unknown action" });
    const body = parsed.data;

    switch (body.intent) {
      case "save": {
        const { sync } = await updateCampaign(ctx, id, body.campaign);
        return withSyncMessage("Campaign saved", sync);
      }
      case "status": {
        const { sync } = await changeCampaignStatus(ctx, id, body.status);
        return withSyncMessage(STATUS_MESSAGES[body.status], sync);
      }
      case "sync": {
        const discount = await syncCampaignDiscount(admin, shop.id, id);
        const storefront = await syncStorefrontConfig(admin, shop.id);
        return discount.ok
          ? withSyncMessage("Synced with Shopify", { discount, storefront })
          : { ok: false as const, message: "Sync failed again" };
      }
      case "delete":
        await deleteCampaign(ctx, id);
        return redirect("/app/campaigns");
    }
  } catch (error) {
    return toActionFailure(error, { shop: shop.domain, route: "campaigns.$id" });
  }
};

const STATUS_MESSAGES: Record<CampaignStatusValue, string> = {
  DRAFT: "Campaign restored as a draft",
  ACTIVE: "Campaign activated",
  PAUSED: "Campaign paused",
  ARCHIVED: "Campaign archived",
};

const TRANSITIONS: Record<CampaignStatusValue, { label: string; busyLabel: string; hint: string }> = {
  ACTIVE: { label: "Activate", busyLabel: "Activating…", hint: "Starts applying the discount at checkout." },
  PAUSED: { label: "Pause", busyLabel: "Pausing…", hint: "Stops the discount; you can resume any time." },
  ARCHIVED: { label: "Archive", busyLabel: "Archiving…", hint: "Removes it from checkout and your active list." },
  DRAFT: { label: "Restore as draft", busyLabel: "Restoring…", hint: "Brings it back for editing." },
};

const STATUS_NOTES: Record<string, string> = {
  live: "Customers get this discount automatically at checkout. It also appears in Shopify under Discounts.",
  paused: "Not applied at checkout right now.",
  draft: "Drafts aren’t applied at checkout. Activate when it’s ready.",
  archived: "Archived campaigns are read-only. Restore it as a draft to edit.",
  alert: "Shopify couldn’t be updated, so checkout may not match what you see here.",
};

type StatusResult = { ok: true; message: string } | { ok: false; message: string };

const updated = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
    new Date(iso),
  );

export default function CampaignDetailPage() {
  const { campaign, currencyCode, defaultLabel, maxTiers, planName, planProductGids } = useLoaderData<typeof loader>();
  const statusFetcher = useFetcher<StatusResult>();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();
  const busy = statusFetcher.state !== "idle";
  // What's being submitted, so only that button shows the loader.
  const pending = busy ? (statusFetcher.json as { intent?: string; status?: string } | undefined) : undefined;

  useEffect(() => {
    if (searchParams.get("created")) {
      shopify.toast.show("Draft saved");
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, shopify]);

  useEffect(() => {
    const result = statusFetcher.data;
    if (statusFetcher.state !== "idle" || !result) return;
    // The delete dialog stays open (with its loader) until the result is in.
    (document.getElementById("delete-campaign-modal") as (HTMLElement & { hideOverlay?: () => void }) | null)
      ?.hideOverlay?.();
    shopify.toast.show(result.message, { isError: !result.ok });
  }, [statusFetcher.state, statusFetcher.data, shopify]);

  const submitIntent = (body: Record<string, string>) =>
    statusFetcher.submit(body, { method: "post", encType: "application/json" });

  const state = campaignState(campaign.status, campaign.syncStatus);
  const transitions = allowedTransitions(campaign.status);
  const canDelete = campaign.status === "DRAFT" || campaign.status === "ARCHIVED";

  return (
    <s-page heading={campaign.name} inlineSize="large">
      <s-link slot="breadcrumb-actions" href="/app/campaigns">
        Campaigns
      </s-link>
      <CampaignForm
        mode="edit"
        initial={{
          name: campaign.name,
          discountType: campaign.discountType,
          discountLabel: campaign.discountLabel ?? "",
          products: campaign.products,
          tiers: campaign.tiers.map((t) => ({
            minQuantity: String(t.minQuantity),
            value: t.value,
            label: t.label ?? "",
          })),
          purchaseType: campaign.purchaseType,
          recurringCycleLimit: String(campaign.recurringCycleLimit),
        }}
        currencyCode={currencyCode}
        defaultLabel={defaultLabel}
        maxTiers={maxTiers}
        planName={planName}
        planProductGids={planProductGids}
        readOnly={campaign.status === "ARCHIVED"}
        head={
          <>
            <span className={`bb-state bb-state--${state.key}`}>{state.label}</span>
            <span>Updated {updated(campaign.updatedAt)}</span>
          </>
        }
        banners={
          campaign.syncStatus === "ERROR" && (
            <s-banner tone="critical" heading="Shopify checkout isn’t up to date">
              {campaign.syncError ?? "Shopify couldn’t be updated."} Your changes are saved in SaleLoop; checkout
              still reflects the last successful sync.
              <s-button
                slot="secondary-actions"
                {...on({ disabled: busy, loading: pending?.intent === "sync" })}
                onClick={() => submitIntent({ intent: "sync" })}
              >
                Retry sync
              </s-button>
            </s-banner>
          )
        }
        statusCard={
          <section className="bb-glass bb-editcard">
            <header className="bb-cardhead">
              <h2>Status</h2>
            </header>
            <div className="bb-statusline">
              <span className={`bb-state bb-state--${state.key}`}>{state.label}</span>
            </div>
            <p className="bb-statusnote">{STATUS_NOTES[state.key]}</p>
            <div className="bb-statusactions">
              {transitions.map((to, i) => {
                const working = pending?.intent === "status" && pending.status === to;
                return (
                  <button
                    key={to}
                    type="button"
                    className={i === 0 ? "bb-btn bb-btn--dark" : "bb-btn bb-btn--glass"}
                    title={TRANSITIONS[to].hint}
                    disabled={busy}
                    aria-busy={working || undefined}
                    onClick={() => submitIntent({ intent: "status", status: to })}
                  >
                    {working && <span className="bb-spinner" aria-hidden="true" />}
                    {working ? TRANSITIONS[to].busyLabel : TRANSITIONS[to].label}
                  </button>
                );
              })}
            </div>
          </section>
        }
        footer={
          canDelete && (
            <div className="bb-actions bb-actions--end">
              <s-button tone="critical" {...on({ disabled: busy })} commandFor="delete-campaign-modal" command="--show">
                Delete campaign
              </s-button>
            </div>
          )
        }
      />

      <s-modal id="delete-campaign-modal" heading="Delete campaign?">
        <s-paragraph>
          &quot;{campaign.name}&quot; will be permanently deleted. This can&apos;t be undone.
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          {...on({ loading: pending?.intent === "delete", disabled: busy })}
          onClick={() => submitIntent({ intent: "delete" })}
        >
          Delete campaign
        </s-button>
        <s-button
          slot="secondary-actions"
          commandFor="delete-campaign-modal"
          command="--hide"
          {...on({ disabled: pending?.intent === "delete" })}
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

export const ErrorBoundary = RouteError;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
