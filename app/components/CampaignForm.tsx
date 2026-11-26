import { useEffect, useState, type ReactNode } from "react";
import { Link, useFetcher } from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import {
  CAMPAIGN_LIMITS,
  minTierQuantity,
  validateCampaignInput,
  type DiscountTypeValue,
  type PurchaseTypeValue,
} from "../lib/campaign-validation";
import { EditorCard } from "./EditorCard";
import { NumberField, TextField } from "./Fields";
import { QuantityPreview } from "./home/QuantityPreview";
import { ProductTargets, type SelectedProduct } from "./ProductTargets";
import { TierEditor, type TierDraft } from "./TierEditor";

export type CampaignFormState = {
  name: string;
  discountType: DiscountTypeValue;
  discountLabel: string;
  products: SelectedProduct[];
  tiers: TierDraft[];
  purchaseType: PurchaseTypeValue;
  /** Subscription orders that get the discount: "1" first only, "0" every order. */
  recurringCycleLimit: string;
};

export const EMPTY_CAMPAIGN: CampaignFormState = {
  name: "",
  discountType: "PERCENTAGE",
  discountLabel: "",
  products: [],
  tiers: [
    { minQuantity: "2", value: "5", label: "" },
    { minQuantity: "3", value: "10", label: "" },
  ],
  purchaseType: "BOTH",
  // Subscribers get the volume discount on every order (renewals too).
  recurringCycleLimit: "0",
};

type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

export function toPayload(state: CampaignFormState) {
  return {
    name: state.name,
    discountType: state.discountType,
    discountLabel: state.discountLabel,
    products: state.products.map((p) => ({
      productGid: p.productGid,
      variantGids: p.variantGids,
    })),
    tiers: state.tiers.map((t) => ({
      minQuantity: t.minQuantity,
      value: t.value,
      label: t.label,
    })),
    purchaseType: state.purchaseType,
    recurringCycleLimit: state.recurringCycleLimit,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type CycleMode = "FIRST" | "LIMITED" | "ALL";
const cycleMode = (limit: string): CycleMode => (limit === "1" ? "FIRST" : limit === "0" ? "ALL" : "LIMITED");

/** Native radios styled as a segmented control. */
function Segment<V extends string>(props: {
  name: string;
  label: string;
  value: V;
  options: readonly (readonly [V, string])[];
  onChange: (v: V) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <span className="bb-fieldlabel" id={`${props.name}-label`}>
        {props.label}
      </span>
      <fieldset className="bb-segment" aria-labelledby={`${props.name}-label`}>
        {props.options.map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name={props.name}
              value={value}
              checked={props.value === value}
              disabled={props.disabled}
              onChange={() => props.onChange(value)}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      {props.hint && <span className="bb-fieldhint">{props.hint}</span>}
    </div>
  );
}

/**
 * Campaign editor (create and edit): numbered cards on the left, status and a
 * live preview on the right, and Shopify's save bar whenever there are unsaved
 * changes. Validates on the client for fast feedback; the route action
 * re-validates and verifies products with Shopify.
 */
export function CampaignForm({
  mode,
  initial,
  currencyCode,
  defaultLabel,
  readOnly,
  head,
  banners,
  statusCard,
  footer,
  maxTiers,
  planName,
  planProductGids = [],
}: {
  mode: "create" | "edit";
  initial: CampaignFormState;
  currencyCode: string | null;
  defaultLabel: string;
  readOnly?: boolean;
  /** Extra line under the title (status, last update). */
  head?: ReactNode;
  banners?: ReactNode;
  statusCard?: ReactNode;
  footer?: ReactNode;
  /** Tier allowance of the shop's plan, and the plan's name for the prompt. */
  maxTiers?: number;
  planName?: string;
  /** Products offered on a SaleLoop subscription plan. */
  planProductGids?: string[];
}) {
  const fetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();
  const [state, setState] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const saving = fetcher.state !== "idle";
  const dirty = JSON.stringify(state) !== JSON.stringify(baseline);

  const serverResult = fetcher.data;
  const serverErrors = serverResult && !serverResult.ok ? serverResult.fieldErrors ?? {} : {};
  const errors = { ...serverErrors, ...clientErrors };
  const issueCount = Object.keys(errors).length;

  useEffect(() => {
    if (fetcher.state !== "idle" || !serverResult) return;
    if (serverResult.ok) {
      setBaseline(state);
      shopify.toast.show(serverResult.message ?? "Campaign saved");
    } else if (!serverResult.fieldErrors) {
      shopify.toast.show(serverResult.message, { isError: true });
    }
    // Only react to a finished submission, not to edits made afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, serverResult, shopify]);

  const set = <K extends keyof CampaignFormState>(key: K, value: CampaignFormState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
    setClientErrors({});
  };

  // Subscription options only matter for products sold on a subscription plan
  // (or a campaign already set to something other than the default).
  const hasSubscriptionPlans = state.products.some((p) => planProductGids.includes(p.productGid));
  const showSubscriptionOptions = hasSubscriptionPlans || initial.purchaseType !== "BOTH";
  const newPlanHref = `/app/subscriptions/new?products=${encodeURIComponent(
    state.products.map((p) => p.productGid.slice(p.productGid.lastIndexOf("/") + 1)).join(","),
  )}`;

  function submit() {
    const payload = toPayload(state);
    const result = validateCampaignInput(payload);
    if (!result.success) {
      setClientErrors(result.fieldErrors);
      shopify.toast.show("Fix the highlighted fields", { isError: true });
      return;
    }
    fetcher.submit({ intent: "save", campaign: payload }, { method: "post", encType: "application/json" });
  }

  function discard() {
    setState(baseline);
    setClientErrors({});
  }

  const productItemErrors: Record<number, string> = {};
  for (const [key, message] of Object.entries(errors)) {
    const match = /^products\.(\d+)/.exec(key);
    if (match) productItemErrors[Number(match[1])] = message;
  }

  const previewTiers = state.tiers
    .filter((t) => Number(t.minQuantity) >= minTierQuantity(state.purchaseType) && Number(t.value) > 0)
    .map((t) => ({ minQuantity: Number(t.minQuantity), value: t.value, label: t.label || null }))
    .sort((a, b) => a.minQuantity - b.minQuantity);
  const title = state.name.trim() || (mode === "create" ? "New campaign" : "Untitled campaign");

  return (
    <>
      <SaveBar id="campaign-save-bar" open={dirty && !readOnly}>
        <button variant="primary" onClick={submit} {...(saving ? { loading: "" } : {})}>
          {mode === "create" ? "Save draft" : "Save"}
        </button>
        <button onClick={discard} disabled={saving}>
          Discard
        </button>
      </SaveBar>

      <div className="bb-wrap">
        <header className="bb-edithead">
          <h1 className="bb-heading">{title}</h1>
          {head && <div className="bb-edithead__meta">{head}</div>}
        </header>

        {issueCount > 0 && (
          <s-banner tone="critical" heading={`Fix ${plural(issueCount, "issue")} before saving`}>
            {serverResult && !serverResult.ok ? serverResult.message : "Check the highlighted fields below."}
          </s-banner>
        )}
        {banners}

        <div className="bb-editor">
          <div className="bb-stack">
            <EditorCard num="01" title="Details">
              <div className="bb-fields">
                <TextField
                  label="Campaign name"
                  details="Only you see this name."
                  value={state.name}
                  placeholder="e.g. Socks — buy more, save more"
                  maxLength={CAMPAIGN_LIMITS.nameMax}
                  error={errors.name}
                  disabled={readOnly}
                  onChange={(v) => set("name", v)}
                />
                <div>
                  <span className="bb-fieldlabel" id="discount-type-label">
                    Discount type
                  </span>
                  <fieldset className="bb-segment" aria-labelledby="discount-type-label">
                    {(
                      [
                        ["PERCENTAGE", "Percentage off"],
                        ["FIXED_AMOUNT", "Amount off each item"],
                      ] as const
                    ).map(([value, label]) => (
                      <label key={value}>
                        <input
                          type="radio"
                          name="discountType"
                          value={value}
                          checked={state.discountType === value}
                          disabled={readOnly}
                          onChange={() => set("discountType", value)}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </fieldset>
                </div>
                <TextField
                  label="Discount label (optional)"
                  details={`Shown to customers in the cart and at checkout. Defaults to "${defaultLabel}".`}
                  value={state.discountLabel}
                  placeholder={defaultLabel}
                  maxLength={CAMPAIGN_LIMITS.labelMax}
                  error={errors.discountLabel}
                  disabled={readOnly}
                  onChange={(v) => set("discountLabel", v)}
                />
              </div>
            </EditorCard>

            <ProductTargets
              num="02"
              value={state.products}
              onChange={(v) => set("products", v)}
              error={errors.products}
              itemErrors={productItemErrors}
              disabled={readOnly}
            />

            <TierEditor
              num="03"
              tiers={state.tiers}
              discountType={state.discountType}
              currencyCode={currencyCode}
              onChange={(v) => set("tiers", v)}
              errors={errors}
              disabled={readOnly}
              maxTiers={maxTiers}
              minQuantity={minTierQuantity(state.purchaseType)}
              limitNote={
                planName && (
                  <span className="bb-limitnote">
                    {planName} plan limit reached.{" "}
                    <Link className="bb-link" to="/app/billing">
                      See plans
                    </Link>
                  </span>
                )
              }
            />

            <EditorCard
              num="04"
              title="Subscriptions"
              hint={
                showSubscriptionOptions
                  ? "Choose whether the discount applies to one-time purchases, subscriptions, or both. Subscriptions are bought on your SaleLoop subscription plans."
                  : undefined
              }
            >
              {showSubscriptionOptions ? (
                <div className="bb-fields">
                  <Segment
                    name="purchaseType"
                    label="Applies to"
                    value={state.purchaseType}
                    options={[
                      ["BOTH", "Both"],
                      ["ONE_TIME", "One-time purchases"],
                      ["SUBSCRIPTION", "Subscriptions"],
                    ]}
                    disabled={readOnly}
                    onChange={(v) => set("purchaseType", v)}
                    hint={
                      errors.purchaseType ??
                      (state.purchaseType === "SUBSCRIPTION"
                        ? "Subscribers only. Tiers can start at 1 item, e.g. 10% off any subscription."
                        : undefined)
                    }
                  />
                  {state.purchaseType !== "ONE_TIME" && (
                    <>
                      <Segment
                        name="recurringMode"
                        label="Subscription orders that get the discount"
                        value={cycleMode(state.recurringCycleLimit)}
                        options={[
                          ["FIRST", "First order only"],
                          ["LIMITED", "A set number"],
                          ["ALL", "Every order"],
                        ]}
                        disabled={readOnly}
                        onChange={(m) => set("recurringCycleLimit", m === "FIRST" ? "1" : m === "ALL" ? "0" : "3")}
                        hint={
                          cycleMode(state.recurringCycleLimit) === "ALL"
                            ? "The first order and every renewal are discounted."
                            : cycleMode(state.recurringCycleLimit) === "FIRST"
                              ? "Only the first order is discounted; renewals are charged full price."
                              : undefined
                        }
                      />
                      {cycleMode(state.recurringCycleLimit) === "LIMITED" && (
                        <div className="bb-fieldnarrow">
                          <NumberField
                            label="Number of orders"
                            suffix="orders"
                            min={2}
                            max={CAMPAIGN_LIMITS.maxRecurringCycles}
                            step={1}
                            value={state.recurringCycleLimit}
                            details="Counts the first order. 3 = the first order and the next 2 renewals."
                            error={errors.recurringCycleLimit}
                            disabled={readOnly}
                            onChange={(v) => set("recurringCycleLimit", v)}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="bb-subnote">
                  <p className="bb-fieldhint">
                    {state.products.length === 0
                      ? "Choose products first. If they're sold on a subscription plan, you can set how subscribers get this discount here."
                      : "These products have no subscription plan, so the discount applies to every purchase. Want to sell them as a subscription too?"}
                  </p>
                  {state.products.length > 0 &&
                    (mode === "edit" && !dirty ? (
                      <Link className="bb-btn bb-btn--glass" to={newPlanHref}>
                        Add subscription plan
                      </Link>
                    ) : (
                      <p className="bb-fieldhint">
                        {mode === "create" ? "Save the campaign first, then add a subscription plan." : "Save your changes first, then add a subscription plan."}
                      </p>
                    ))}
                </div>
              )}
            </EditorCard>

            {mode === "create" && (
              <div className="bb-actions bb-actions--end">
                <Link className="bb-btn bb-btn--glass" to="/app/campaigns">
                  Cancel
                </Link>
                <button type="button" className="bb-btn bb-btn--dark" onClick={submit} disabled={saving}>
                  {saving && <span className="bb-spinner" aria-hidden="true" />}
                  {saving ? "Saving…" : "Save draft"}
                </button>
              </div>
            )}
            {footer}
          </div>

          <aside className="bb-stack bb-editor__aside">
            {statusCard}
            <EditorCard title="Preview" hint="How the tiers read on a product page. Sample product and price.">
              {previewTiers.length ? (
                <QuantityPreview
                  productName={state.products[0]?.title ?? "Your product"}
                  campaignName={state.discountLabel.trim() || defaultLabel}
                  units={["item", "items"]}
                  tiers={previewTiers}
                  discountType={state.discountType}
                  currencyCode={currencyCode}
                  onAddToCart={() => shopify.toast.show("This is a preview.")}
                />
              ) : (
                <div className="bb-empty bb-placeholder">Add a tier with a quantity and a discount to see it here.</div>
              )}
            </EditorCard>
          </aside>
        </div>
      </div>
    </>
  );
}
