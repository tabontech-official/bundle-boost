import { Form, useNavigation } from "react-router";
import { PLAN_FOOTNOTES, PLAN_ORDER, PLANS, type Plan, type PlanHandle } from "../../lib/plans";

export type BillingViewData = {
  planHandle: PlanHandle;
  verified: boolean;
  configured: boolean;
  renewsAt: string | null;
  trialEndsAt: string | null;
  cancelAtEndOfCycle: boolean;
  pendingPlanHandle: PlanHandle | null;
  plansUrl: string | null;
  usage: { activeCampaigns: number; liveProducts: number; mostTiers: number };
};

const date = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
const price = (n: number) => (n === 0 ? "$0" : `$${n.toFixed(2)}`);

/**
 * Billing: current plan and usage against its limits, the three plans side by
 * side, and Shopify's hosted page for any change. Shopify bills the merchant;
 * this page never handles payment details.
 */
export function BillingView({ data }: { data: BillingViewData }) {
  const plan = PLANS[data.planHandle];
  const pending = data.pendingPlanHandle ? PLANS[data.pendingPlanHandle] : null;
  const over = overLimits(plan, data.usage);

  return (
    <s-page heading="Billing" inlineSize="large">
      <div className="bb-wrap bb-animate">
        <header className="bb-pagehead">
          <span className="bb-kicker">Billing · {plan.name} plan</span>
          <h1 className="bb-display">
            Pick the plan that <em>fits</em>
          </h1>
          <p className="bb-lede">
            Plans are billed by Shopify and appear on your Shopify invoice, in USD. Upgrade, downgrade or cancel any
            time.
          </p>
        </header>

        {!data.configured && (
          <s-banner tone="info" heading="Paid plans aren’t available yet">
            Your store is on the Free plan for now. Plan changes open here once pricing is published.
          </s-banner>
        )}
        {data.configured && !data.verified && (
          <s-banner tone="warning" heading="We couldn’t confirm your plan with Shopify">
            Showing your last known plan. Reload in a minute to check again.
          </s-banner>
        )}
        {over.length > 0 && (
          <s-banner tone="warning" heading={`You’re over the ${plan.name} plan’s limits`}>
            {over.join(" ")} Live campaigns keep working, but you can’t activate more until you pause some or
            upgrade.
          </s-banner>
        )}

        <section className="bb-glass bb-usage">
          <div className="bb-usage__head">
            <div>
              <span className="bb-kicker">Current plan</span>
              <h2 className="bb-heading bb-heading--small">
                {plan.name} <em>{price(plan.price)}</em>
                <small className="bb-usage__per">/month</small>
              </h2>
            </div>
            <p className="bb-usage__note">{planNote(data, pending)}</p>
          </div>
          <div className="bb-meters">
            <Meter label="Active campaigns" used={data.usage.activeCampaigns} limit={plan.activeCampaigns} />
            <Meter label="Live products" used={data.usage.liveProducts} limit={plan.liveProducts} />
            <Meter label="Most tiers in a campaign" used={data.usage.mostTiers} limit={plan.tiersPerCampaign} />
          </div>
        </section>

        <div className="bb-plans">
          {PLAN_ORDER.map((handle) => (
            <PlanCard
              key={handle}
              plan={PLANS[handle]}
              current={handle === data.planHandle}
              currentPrice={plan.price}
              plansUrl={data.plansUrl}
            />
          ))}
        </div>

        <div className="bb-footnotes">
          {PLAN_FOOTNOTES.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>

        <section className="bb-glass bb-panel">
          <h3 className="bb-panel__title">How billing works</h3>
          <dl className="bb-faq">
            <div>
              <dt>Who charges me?</dt>
              <dd>Shopify. The plan is added to your regular Shopify invoice; SaleLoop never sees your payment details.</dd>
            </div>
            <div>
              <dt>What happens when I change plan?</dt>
              <dd>You approve the change on Shopify’s plan page. Upgrades apply right away; Shopify prorates the difference.</dd>
            </div>
            <div>
              <dt>What if I downgrade?</dt>
              <dd>Nothing is deleted. Campaigns above the new plan’s limits keep running until you pause them, but you can’t activate more.</dd>
            </div>
          </dl>
        </section>
      </div>
    </s-page>
  );
}

function planNote(data: BillingViewData, pending: Plan | null) {
  if (data.trialEndsAt) return `Free trial until ${date(data.trialEndsAt)}.`;
  if (data.cancelAtEndOfCycle && data.renewsAt) return `Ends on ${date(data.renewsAt)}; you’ll move to Free.`;
  if (pending && data.renewsAt) return `Changes to ${pending.name} on ${date(data.renewsAt)}.`;
  if (data.renewsAt) return `Renews on ${date(data.renewsAt)}.`;
  return "No charge. Upgrade any time for more campaigns, products and tiers.";
}

function overLimits(plan: Plan, usage: BillingViewData["usage"]) {
  const out: string[] = [];
  if (usage.activeCampaigns > plan.activeCampaigns)
    out.push(`${usage.activeCampaigns} active campaigns (limit ${plan.activeCampaigns}).`);
  if (plan.liveProducts !== null && usage.liveProducts > plan.liveProducts)
    out.push(`${usage.liveProducts} live products (limit ${plan.liveProducts}).`);
  return out;
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit === null ? 0 : Math.min(100, (used / Math.max(limit, 1)) * 100);
  const state = limit !== null && used > limit ? "over" : limit !== null && used >= limit ? "full" : "ok";
  return (
    <div className={`bb-usemeter bb-usemeter--${state}`}>
      <div className="bb-usemeter__top">
        <span>{label}</span>
        <span className="bb-mono">
          {used}
          <small>{limit === null ? " · unlimited" : ` of ${limit}`}</small>
        </span>
      </div>
      <span
        className="bb-usemeter__track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit ?? used}
        aria-valuenow={used}
      >
        <span className="bb-usemeter__fill" style={{ inlineSize: limit === null ? "100%" : `${pct}%` }} />
      </span>
    </div>
  );
}

function PlanCard({
  plan,
  current,
  currentPrice,
}: {
  plan: Plan;
  current: boolean;
  currentPrice: number;
  plansUrl?: string | null;
}) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle" && navigation.formData?.get("plan") === plan.handle;
  const isUpgrade = plan.price > currentPrice;
  const action = isUpgrade ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`;

  return (
    <article className={["bb-glass", "bb-plan", plan.badge && "bb-plan--top", current && "bb-plan--current"].filter(Boolean).join(" ")}>
      {plan.badge && <span className="bb-plan__badge">{plan.badge}</span>}
      <header>
        <h3 className="bb-plan__name">{plan.name}</h3>
        <p className="bb-plan__tagline">{plan.tagline}</p>
      </header>
      <div className="bb-plan__price">
        <span className="bb-mono">{price(plan.price)}</span>
        <small>/month</small>
      </div>
      <ul className="bb-plan__features">
        {plan.features.map((f) => (
          <li key={f}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3 7.3 5.7 10 11 4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {f}
          </li>
        ))}
      </ul>
      {current ? (
        <span className="bb-btn bb-btn--glass bb-plan__cta" aria-disabled="true">
          Current plan
        </span>
      ) : (
        <Form method="post" className="bb-plan__form">
          <input type="hidden" name="plan" value={plan.handle} />
          <button
            type="submit"
            className={`bb-btn ${isUpgrade ? "bb-btn--dark" : "bb-btn--glass"} bb-plan__cta`}
            disabled={navigation.state !== "idle"}
          >
            {isSubmitting ? "Processing..." : action}
          </button>
        </Form>
      )}
    </article>
  );
}
