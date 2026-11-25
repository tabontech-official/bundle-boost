import { useState, type CSSProperties } from "react";
import type { WidgetSettingsInput } from "../lib/settings-validation";

/**
 * Admin preview of the theme block. Uses the block's own markup and its real
 * stylesheet (extensions/bundleboost-widget/assets/quantity-breaks.css,
 * linked by the widget route), so what you see here is what shoppers see.
 * The product and price are a labelled sample.
 */
export type PreviewTier = { qty: number; value: number; label: string };

// Sample selling plans for the purchase-options preview. On the storefront
// these come from the product's BundleBoost subscription plans.
export type PreviewPlan = { id: string; name: string; discount: string; percent: number | null };
const SAMPLE_PLANS: PreviewPlan[] = [
  { id: "1", name: "Delivery every month", discount: "10%", percent: 10 },
  { id: "2", name: "Delivery every 2 months", discount: "10%", percent: 10 },
  { id: "3", name: "Delivery every 3 months", discount: "15%", percent: 15 },
];

const SAMPLE_PRICE_CENTS = 2400;
export const SAMPLE_TIERS: PreviewTier[] = [
  { qty: 2, value: 5, label: "" },
  { qty: 3, value: 10, label: "Most popular" },
  { qty: 4, value: 15, label: "" },
];

function money(cents: number, currencyCode: string | null) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode ?? "USD" }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

export function WidgetPreview({
  settings,
  plans: shopPlans,
  tiers,
  type,
  currencyCode,
}: {
  settings: WidgetSettingsInput;
  /** The shop's visible subscription plans (renamed); samples when undefined. */
  plans?: PreviewPlan[];
  tiers: PreviewTier[];
  type: "percentage" | "fixed";
  currencyCode: string | null;
}) {
  const [picked, setPicked] = useState(1);
  const [subscribe, setSubscribe] = useState(false);
  const plans = shopPlans ?? SAMPLE_PLANS;
  const [planId, setPlanId] = useState<string | null>(null);
  const plan = plans.find((p) => p.id === planId) ?? plans[0];
  const subscribeLabel = settings.subscribeLabel.split("{discount}");
  const selected = Math.min(picked, tiers.length - 1);
  const best = tiers[tiers.length - 1]?.qty;
  // Same variables and classes the theme block sets, so the stylesheet
  // renders this exactly as the storefront will.
  const vars = {
    "--bb-accent": settings.accentColor,
    "--bb-text": settings.textColor,
    "--bb-bg": settings.backgroundColor,
    "--bb-radius": `${settings.borderRadius}px`,
    "--bb-heading-size": `${settings.headingSize}px`,
    "--bb-text-size": `${settings.textSize}px`,
    "--bb-tier-border": settings.tierBorderColor,
    "--bb-selected-bg": settings.selectedBackgroundColor,
    "--bb-save": settings.savingsColor,
    "--bb-badge-bg": settings.badgeColor,
    "--bb-badge-fg": settings.badgeTextColor,
    "--bb-container-border": settings.containerBorderColor,
    margin: 0,
  } as CSSProperties;
  const className = [
    "bb-breaks",
    `bb-breaks--${settings.layout === "GRID" ? "grid" : "stacked"}`,
    `bb-breaks--${settings.spacing.toLowerCase()}`,
    !settings.showContainerBorder && "bb-breaks--borderless",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} style={vars}>
      <p className="bb-breaks__heading">{settings.heading}</p>
      {settings.subheading && <p className="bb-breaks__subheading">{settings.subheading}</p>}
      <ul className="bb-breaks__tiers">
        {tiers.map((tier, i) => {
          const offCents = type === "percentage" ? Math.round((SAMPLE_PRICE_CENTS * tier.value) / 100) : tier.value * 100;
          const each = Math.max(SAMPLE_PRICE_CENTS - offCents, 0);
          const isBest = settings.highlightBestDeal && tier.qty === best;
          return (
            <li key={tier.qty}>
              <button
                type="button"
                className={`bb-breaks__tier${isBest ? " bb-breaks__tier--best" : ""}`}
                aria-pressed={i === selected}
                onClick={() => setPicked(i)}
              >
                {isBest && <span className="bb-breaks__badge">{settings.badgeText}</span>}
                <span className="bb-breaks__qty">
                  {settings.buyLabel.replaceAll("{quantity}", String(tier.qty))}
                  {tier.label && ` · ${tier.label}`}
                </span>
                {settings.showPricePerItem && (
                  <span className="bb-breaks__price">{money(each, currencyCode)} each</span>
                )}
                {settings.showSavings && (
                  <span className="bb-breaks__save">
                    {type === "percentage" ? `Save ${tier.value}%` : `Save ${money(tier.value * 100, currencyCode)} each`}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {settings.showPurchaseOptions && plan && (
        <div className="bb-purchase">
          <label className={`bb-purchase__option${subscribe ? "" : " bb-purchase__option--active"}`}>
            <input
              type="radio"
              className="bb-purchase__radio"
              name="bb-preview-purchase"
              checked={!subscribe}
              onChange={() => setSubscribe(false)}
            />
            <span className="bb-purchase__label">{settings.oneTimeLabel}</span>
            <span className="bb-purchase__price">{money(SAMPLE_PRICE_CENTS, currencyCode)}</span>
          </label>
          <label className={`bb-purchase__option${subscribe ? " bb-purchase__option--active" : ""}`}>
            <input
              type="radio"
              className="bb-purchase__radio"
              name="bb-preview-purchase"
              checked={subscribe}
              onChange={() => setSubscribe(true)}
            />
            <span className="bb-purchase__label">
              {subscribeLabel.map((part, i) => (
                <span key={i}>
                  {i > 0 && <span className="bb-purchase__discount">{plan.discount}</span>}
                  {part}
                </span>
              ))}
            </span>
            <span className="bb-purchase__price">
              {money(Math.round((SAMPLE_PRICE_CENTS * (100 - (plan.percent ?? 0))) / 100), currencyCode)}
            </span>
          </label>
          <div className="bb-purchase__frequency" hidden={!subscribe}>
            <label className="bb-purchase__frequency-label" htmlFor="bb-preview-frequency">
              {settings.frequencyLabel}
            </label>
            <select
              id="bb-preview-frequency"
              className="bb-purchase__select"
              value={plan.id}
              onChange={(e) => setPlanId(e.currentTarget.value)}
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <p className="bb-purchase__terms">
              {money(Math.round((SAMPLE_PRICE_CENTS * (100 - (plan.percent ?? 0))) / 100), currencyCode)} charged today, then
              with every delivery.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
