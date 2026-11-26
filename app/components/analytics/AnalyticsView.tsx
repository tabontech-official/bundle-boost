import { Link } from "react-router";
import { auditLabel } from "../../lib/format";
import { StatusRing } from "../home/StatusRing";

export type AnalyticsViewData = {
  counts: { DRAFT: number; ACTIVE: number; PAUSED: number; ARCHIVED: number };
  totalCampaigns: number;
  syncErrors: number;
  liveCampaigns: {
    id: string;
    name: string;
    type: "percentage" | "fixed";
    productCount: number;
    tiers: { qty: number; value: number }[];
  }[];
  liveProducts: number;
  targetedProducts: number;
  storeProducts: number | null;
  deepestPercent: number | null;
  lowestThreshold: number | null;
  activity: { id: string; action: string; createdAt: string; name: string | null }[];
  currencyCode: string | null;
};

const number = new Intl.NumberFormat("en-US");
const plural = (n: number, word: string) => `${number.format(n)} ${word}${n === 1 ? "" : "s"}`;
const when = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
    new Date(iso),
  );

function money(amount: number, currencyCode: string | null) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode ?? "USD" }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

/**
 * Analytics: how campaigns are set up and how much of the catalogue they
 * cover, from real data only. Sales results need order data and are shown as
 * "coming next", never estimated.
 */
export function AnalyticsView({ data }: { data: AnalyticsViewData }) {
  const live = data.liveCampaigns.length;
  return (
    <s-page heading="Analytics" inlineSize="large">
      <div className="bb-wrap bb-animate">
        <header className="bb-pagehead">
          <span className="bb-kicker">Analytics · campaign setup</span>
          <h1 className="bb-display">
            Your offers <em>at a glance</em>
          </h1>
          <p className="bb-lede">
            What’s live, how much of your catalogue it covers, and how deep each discount goes. Everything here comes
            from your campaigns and store — nothing is estimated.
          </p>
        </header>

        {data.totalCampaigns === 0 ? (
          <section className="bb-glass bb-start">
            <h2 className="bb-heading bb-heading--small">
              Nothing to measure <em>yet</em>
            </h2>
            <p>Create and activate a campaign. Coverage and discount depth show up here as soon as one is live.</p>
            <div className="bb-hero__actions">
              <Link className="bb-btn bb-btn--dark" to="/app/campaigns/new">
                Create a campaign →
              </Link>
            </div>
          </section>
        ) : (
          <>
            <div className="bb-kpis">
              <Kpi
                label="Live campaigns"
                value={number.format(live)}
                note={data.counts.PAUSED ? `${data.counts.PAUSED} paused` : null}
                to="/app/campaigns?status=ACTIVE"
              />
              <Kpi
                label="Products discounted"
                value={number.format(data.liveProducts)}
                note={data.storeProducts != null ? `of ${number.format(data.storeProducts)}` : null}
                to="/app/campaigns?status=ACTIVE"
              />
              <Kpi
                label="Deepest discount"
                value={data.deepestPercent != null ? `${data.deepestPercent}%` : "—"}
                note={data.lowestThreshold != null ? `from ${data.lowestThreshold}+ items` : null}
                to="/app/campaigns"
              />
              <Kpi
                label="Sync health"
                value={data.syncErrors ? number.format(data.syncErrors) : "OK"}
                note={data.syncErrors ? (data.syncErrors === 1 ? "campaign failed" : "campaigns failed") : "all in sync"}
                to="/app/campaigns"
                alert={data.syncErrors > 0}
              />
            </div>

            <div className="bb-two">
              <div className="bb-glass bb-panel">
                <h3 className="bb-panel__title">Product coverage</h3>
                {data.storeProducts ? (
                  <StatusRing
                    label={`${data.liveProducts} of ${data.storeProducts} products have a live discount`}
                    center={{ value: data.liveProducts, caption: `of ${number.format(data.storeProducts)} products` }}
                    segments={[
                      { key: "live", label: "Live discount", value: data.liveProducts, color: "#e2433a" },
                      {
                        key: "pending",
                        label: "In drafts or paused",
                        value: Math.max(data.targetedProducts - data.liveProducts, 0),
                        color: "#ffa98a",
                      },
                      {
                        key: "none",
                        label: "No campaign",
                        value: Math.max(data.storeProducts - data.targetedProducts, 0),
                        color: "#efe1dc",
                      },
                    ]}
                  />
                ) : (
                  <div className="bb-empty">Your store’s product count couldn’t be read right now.</div>
                )}
              </div>
              <div className="bb-glass bb-panel">
                <h3 className="bb-panel__title">Campaigns by status</h3>
                <StatusRing
                  label={`${data.totalCampaigns} campaigns by status`}
                  center={{ value: data.totalCampaigns, caption: data.totalCampaigns === 1 ? "campaign" : "campaigns" }}
                  segments={[
                    { key: "active", label: "Active", value: data.counts.ACTIVE, color: "#e2433a" },
                    { key: "paused", label: "Paused", value: data.counts.PAUSED, color: "#eda100" },
                    { key: "draft", label: "Draft", value: data.counts.DRAFT, color: "#c9bcc4" },
                    { key: "archived", label: "Archived", value: data.counts.ARCHIVED, color: "#f1e7e3" },
                  ]}
                />
              </div>
            </div>

            <DiscountDepth campaigns={data.liveCampaigns} currencyCode={data.currencyCode} />
          </>
        )}

        <div className="bb-two">
          <section className="bb-glass bb-panel bb-soon">
            <span className="bb-kicker">Coming next</span>
            <h3 className="bb-heading bb-heading--small">
              Sales <em>impact</em>
            </h3>
            <p>
              Once BundleBoost reads orders, this shows the results of your discounts — counted from real orders only.
            </p>
            <ul className="bb-soonlist">
              <li>Orders that used a quantity break</li>
              <li>Revenue from those orders</li>
              <li>Average items per order, before and after</li>
              <li>Which tier customers pick most</li>
            </ul>
          </section>
          <section className="bb-glass bb-panel">
            <h3 className="bb-panel__title">Recent activity</h3>
            {data.activity.length ? (
              <ol className="bb-timeline">
                {data.activity.map((a) => (
                  <li key={a.id}>
                    <strong>{auditLabel(a.action)}</strong>
                    {a.name && <span>{a.name}</span>}
                    <small>{when(a.createdAt)}</small>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="bb-empty">Changes you make will show up here.</div>
            )}
          </section>
        </div>
      </div>
    </s-page>
  );
}

function Kpi({
  label,
  value,
  note,
  to,
  alert,
}: {
  label: string;
  value: string;
  note: string | null;
  to: string;
  alert?: boolean;
}) {
  return (
    <Link to={to} className={alert ? "bb-glass bb-kpi bb-kpi--alert" : "bb-glass bb-kpi"}>
      <span className="bb-kpi__label">{label}</span>
      <span className="bb-kpi__value bb-mono">
        {value}
        {note && <small>{note}</small>}
      </span>
    </Link>
  );
}

/** One row per live campaign: a bar per tier, scaled to the deepest discount. */
function DiscountDepth({
  campaigns,
  currencyCode,
}: {
  campaigns: AnalyticsViewData["liveCampaigns"];
  currencyCode: string | null;
}) {
  if (!campaigns.length) {
    return (
      <section className="bb-glass bb-panel">
        <h3 className="bb-panel__title">Discount depth</h3>
        <div className="bb-empty">Activate a campaign to compare its tiers here.</div>
      </section>
    );
  }
  const maxPercent = Math.max(1, ...campaigns.filter((c) => c.type === "percentage").flatMap((c) => c.tiers.map((t) => t.value)));
  const maxFixed = Math.max(1, ...campaigns.filter((c) => c.type === "fixed").flatMap((c) => c.tiers.map((t) => t.value)));
  return (
    <section className="bb-glass bb-panel">
      <div className="bb-panel__head">
        <h3 className="bb-panel__title">Discount depth</h3>
        <span className="bb-kicker">{plural(campaigns.length, "live campaign")}</span>
      </div>
      <ul className="bb-depth">
        {campaigns.map((c) => {
          const max = c.type === "percentage" ? maxPercent : maxFixed;
          return (
            <li key={c.id}>
              <div className="bb-depth__head">
                <Link className="bb-depth__name" to={`/app/campaigns/${c.id}`}>
                  {c.name}
                </Link>
                <small>{plural(c.productCount, "product")}</small>
              </div>
              <div className="bb-depth__bars">
                {c.tiers.map((t) => (
                  <div key={t.qty} className="bb-depth__bar">
                    <span className="bb-mono">{t.qty}+</span>
                    <span className="bb-depth__track" aria-hidden="true">
                      <span className="bb-depth__fill" style={{ inlineSize: `${(t.value / max) * 100}%` }} />
                    </span>
                    <span className="bb-mono bb-save">
                      {c.type === "percentage" ? `${t.value}%` : `${money(t.value, currencyCode)} each`}
                    </span>
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
