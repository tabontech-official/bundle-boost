import { useEffect, useState } from "react";
import {
  Link,
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type HeadersFunction,
  type LoaderFunctionArgs,
} from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { requireAdmin } from "../.server/context";
import { toActionFailure } from "../.server/errors";
import { readJsonBody } from "../.server/request";
import { getShopSettings, updateShopSettings } from "../.server/services/settings.service";
import { syncPendingCampaigns } from "../.server/services/discount-sync.service";
import { EditorCard } from "../components/EditorCard";
import { TextField } from "../components/Fields";
import { RouteError } from "../components/RouteError";
import { Toggle } from "../components/Toggle";
import { shopSettingsSchema, type ShopSettingsInput } from "../lib/settings-validation";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, session } = await requireAdmin(request);
  const [s, affected] = await Promise.all([
    getShopSettings(shop.id),
    prisma.campaign.count({ where: { shopId: shop.id, status: { in: ["ACTIVE", "PAUSED"] } } }),
  ]);
  const settings: ShopSettingsInput = {
    defaultDiscountLabel: s.defaultDiscountLabel,
    combineWithProductDiscounts: s.combineWithProductDiscounts,
    combineWithOrderDiscounts: s.combineWithOrderDiscounts,
    combineWithShippingDiscounts: s.combineWithShippingDiscounts,
  };
  return {
    settings,
    affected,
    shopDomain: shop.domain,
    shopName: shop.name,
    currencyCode: shop.currencyCode,
    scopes: session.scope?.split(",").filter(Boolean) ?? [],
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, actorId } = await requireAdmin(request);
  try {
    await updateShopSettings({ shopId: shop.id, actorId }, await readJsonBody(request));
    // Labels and combination rules live on each Shopify discount.
    const results = await syncPendingCampaigns(admin, shop.id, { includeSynced: true });
    return { ok: true as const, failedSyncs: results.filter((r) => !r.ok).length };
  } catch (error) {
    return toActionFailure(error, { shop: shop.domain, route: "settings" });
  }
};

type Result =
  | { ok: true; failedSyncs: number }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

const SCOPE_LABELS: Record<string, string> = {
  read_products: "Read products",
  write_products: "Manage products",
  read_discounts: "Read discounts",
  write_discounts: "Manage discounts",
  write_purchase_options: "Manage subscription plans",
  read_own_subscription_contracts: "Read subscriptions",
  write_own_subscription_contracts: "Manage subscriptions",
  read_customer_payment_methods: "Read customers’ saved payment methods",
  read_customers: "Read customers",
  write_customers: "Send payment update emails",
  read_orders: "Read orders",
  customer_read_customers: "Customer portal: read the customer",
  customer_read_own_subscription_contracts: "Customer portal: read subscriptions",
  customer_write_own_subscription_contracts: "Customer portal: change subscriptions",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function Settings() {
  const { settings: initial, affected, shopDomain, shopName, currencyCode, scopes } = useLoaderData<typeof loader>();
  const [settings, setSettings] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const fetcher = useFetcher<Result>();
  const shopify = useAppBridge();
  const saving = fetcher.state !== "idle";
  const parsed = shopSettingsSchema.safeParse(settings);
  const errors: Record<string, string> = fetcher.data && !fetcher.data.ok ? fetcher.data.fieldErrors ?? {} : {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors[issue.path.join(".")] ??= issue.message;
  }
  const dirty = JSON.stringify(settings) !== JSON.stringify(baseline);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const result = fetcher.data;
    if (!result.ok) {
      shopify.toast.show(result.message, { isError: true });
      return;
    }
    setBaseline(settings);
    shopify.toast.show(
      result.failedSyncs > 0
        ? `Saved, but ${plural(result.failedSyncs, "campaign")} couldn’t be updated in Shopify`
        : "Settings saved",
      { isError: result.failedSyncs > 0 },
    );
    // Only react to a finished save, not to edits made afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data, shopify]);

  const set = <K extends keyof ShopSettingsInput>(key: K, value: ShopSettingsInput[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));
  const save = () => {
    if (!parsed.success) {
      shopify.toast.show("Fix the highlighted fields", { isError: true });
      return;
    }
    fetcher.submit(settings, { method: "post", encType: "application/json" });
  };

  return (
    <s-page heading="Settings" inlineSize="large">
      <SaveBar id="settings-save-bar" open={dirty}>
        <button variant="primary" onClick={save} {...(saving ? { loading: "" } : {})}>
          Save
        </button>
        <button onClick={() => setSettings(baseline)} disabled={saving}>
          Discard
        </button>
      </SaveBar>

      <div className="bb-wrap">
        <header className="bb-pagehead">
          <span className="bb-kicker">Settings</span>
          <h1 className="bb-display">
            How your discounts <em>behave</em>
          </h1>
          <p className="bb-lede">
            Defaults for every campaign. Saving updates each active and paused campaign in Shopify, so checkout always
            matches these settings.
          </p>
        </header>

        <div className="bb-editor">
          <div className="bb-stack">
            <EditorCard num="01" title="Discount defaults">
              <div className="bb-fields">
                <TextField
                  label="Default discount label"
                  details="Used when a campaign doesn’t have a label of its own."
                  value={settings.defaultDiscountLabel}
                  maxLength={60}
                  error={errors.defaultDiscountLabel}
                  onChange={(v) => set("defaultDiscountLabel", v)}
                />
                <div className="bb-checkout-example" aria-label="How it looks at checkout">
                  <span className="bb-kicker">At checkout</span>
                  <div className="bb-checkout-example__line">
                    <span>Merino Crew Socks × 3</span>
                    <span className="bb-mono">$72.00</span>
                  </div>
                  <div className="bb-checkout-example__line bb-checkout-example__discount">
                    <span>
                      <s-icon type="discount" tone="neutral" size="small" /> {settings.defaultDiscountLabel.trim() || "—"}
                    </span>
                    <span className="bb-mono">−$7.20</span>
                  </div>
                </div>
              </div>
            </EditorCard>

            <EditorCard
              num="02"
              title="Combinations"
              hint="Choose which other Shopify discounts can apply together with BundleBoost’s."
              aside={affected > 0 && `updates ${plural(affected, "campaign")}`}
            >
              <div className="bb-toggles">
                <Toggle
                  label="Other product discounts"
                  hint="Off: when another product discount also applies, Shopify picks the better one for the customer."
                  checked={settings.combineWithProductDiscounts}
                  onChange={(v) => set("combineWithProductDiscounts", v)}
                />
                <Toggle
                  label="Order discounts"
                  hint="For example a code like WELCOME10 on the whole order."
                  checked={settings.combineWithOrderDiscounts}
                  onChange={(v) => set("combineWithOrderDiscounts", v)}
                />
                <Toggle
                  label="Shipping discounts"
                  hint="For example free shipping over a set amount."
                  checked={settings.combineWithShippingDiscounts}
                  onChange={(v) => set("combineWithShippingDiscounts", v)}
                />
              </div>
            </EditorCard>

            <EditorCard num="03" title="Data and privacy">
              <ul className="bb-facts">
                <li>
                  <strong>What we store</strong>
                  <span>Your campaigns, subscription plans, widget settings and an activity log.</span>
                </li>
                <li>
                  <strong>Subscribers</strong>
                  <span>
                    For each subscription: the customer’s name and email, the first order number, the items and the
                    renewal history, to show your subscriber list and charge renewals. Card details stay with Shopify
                    and delivery addresses aren’t stored.
                  </span>
                </li>
                <li>
                  <strong>Customer requests</strong>
                  <span>When a customer asks your store to erase their data, BundleBoost removes their details too.</span>
                </li>
                <li>
                  <strong>If you uninstall</strong>
                  <span>Access ends immediately. Your data is permanently deleted 48 hours later, when Shopify asks.</span>
                </li>
                <li>
                  <strong>Discounts in Shopify</strong>
                  <span>
                    Each campaign is a Shopify automatic discount, visible under Discounts in your admin. Subscription
                    plans are Shopify purchase options on your products.
                  </span>
                </li>
              </ul>
            </EditorCard>
          </div>

          <aside className="bb-stack bb-editor__aside">
            <EditorCard title="Store">
              <dl className="bb-dl">
                <div>
                  <dt>Name</dt>
                  <dd>{shopName ?? "—"}</dd>
                </div>
                <div>
                  <dt>Domain</dt>
                  <dd>{shopDomain}</dd>
                </div>
                <div>
                  <dt>Currency</dt>
                  <dd>{currencyCode ?? "Unknown"}</dd>
                </div>
              </dl>
            </EditorCard>
            <EditorCard title="Permissions" hint="What BundleBoost can access in your store.">
              <div className="bb-chips bb-chips--tight">
                {scopes.length ? (
                  scopes.map((scope) => (
                    <span key={scope} className="bb-chip">
                      {SCOPE_LABELS[scope] ?? scope}
                    </span>
                  ))
                ) : (
                  <span className="bb-chip">None granted yet</span>
                )}
              </div>
            </EditorCard>
            <EditorCard title="Plan">
              <p className="bb-statusnote">See your plan and billing details.</p>
              <Link className="bb-btn bb-btn--glass" to="/app/billing">
                Go to billing →
              </Link>
            </EditorCard>
          </aside>
        </div>
      </div>
    </s-page>
  );
}

export const ErrorBoundary = RouteError;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
