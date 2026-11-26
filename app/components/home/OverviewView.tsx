import { Link } from "react-router";
import { buildSetupSteps, setupProgress, type SetupStep } from "../../lib/setup-guide";
import { QuantityPreview } from "./QuantityPreview";
import { RecentCampaigns, type RecentCampaign } from "./RecentCampaigns";
import { StatusRing } from "./StatusRing";

export type OverviewData = {
  shopName: string | null;
  currencyCode: string | null;
  counts: { DRAFT: number; ACTIVE: number; PAUSED: number; ARCHIVED: number };
  totalCampaigns: number;
  liveCampaigns: number;
  liveProducts: number;
  syncErrors: number;
  firstDraftId: string | null;
  themeBlockConfirmed: boolean;
  themeEditorUrl: string;
  recentCampaigns: RecentCampaign[];
};

export type SetupChange = "dismiss" | "restore" | "confirmTheme" | "unconfirmTheme";

const number = new Intl.NumberFormat("en-US");
const plural = (n: number, word: string) => `${number.format(n)} ${word}${n === 1 ? "" : "s"}`;

/**
 * Dashboard: a personal hero with a working preview, the go-live steps until
 * they're done, campaign numbers, and what SaleLoop can do. Router-only
 * dependency is <Link>, so it renders anywhere a router exists.
 */
export function OverviewView({
  data,
  busy,
  onSetupChange,
  onPreviewAddToCart,
}: {
  data: OverviewData;
  busy: boolean;
  onSetupChange: (change: SetupChange) => void;
  onPreviewAddToCart: () => void;
}) {
  const steps = buildSetupSteps(
    {
      totalCampaigns: data.totalCampaigns,
      liveCampaigns: data.liveCampaigns,
      firstDraftId: data.firstDraftId,
      themeBlockConfirmed: data.themeBlockConfirmed,
    },
    data.themeEditorUrl,
  );
  const progress = setupProgress(steps);
  const featured =
    data.recentCampaigns.find((c) => c.status === "ACTIVE" && c.syncStatus === "SYNCED") ?? null;

  return (
    <s-page heading="Overview" inlineSize="large">
      <div className="bb-wrap bb-animate">
        {data.syncErrors > 0 && (
          <s-banner tone="critical" heading="Some discounts aren’t working at checkout">
            {data.syncErrors === 1
              ? "1 campaign couldn’t be updated in Shopify. Open it and select Retry sync."
              : `${data.syncErrors} campaigns couldn’t be updated in Shopify. Open them and select Retry sync.`}
          </s-banner>
        )}

        <Hero data={data} steps={steps} live={progress.allDone} featured={featured} onPreviewAddToCart={onPreviewAddToCart} />
        {!progress.allDone && <SetupSteps steps={steps} busy={busy} onSetupChange={onSetupChange} />}
        <Kpis data={data} />
        {data.totalCampaigns > 0 && <Insights data={data} />}

        <section className="bb-center">
          <h2 className="bb-heading">
            Customers buy more <em>when they save more.</em>
          </h2>
          <p>Quantity breaks reward bigger orders, with no discount codes to share or remember.</p>
        </section>
        <Features />
      </div>
    </s-page>
  );
}

// ---------- Hero ----------

function Hero({
  data,
  steps,
  live,
  featured,
  onPreviewAddToCart,
}: {
  data: OverviewData;
  steps: SetupStep[];
  live: boolean;
  featured: RecentCampaign | null;
  onPreviewAddToCart: () => void;
}) {
  const done = steps.filter((s) => s.done).length;
  const hasCampaigns = data.totalCampaigns > 0;
  const next = live
    ? `Your discounts are live on ${plural(data.liveProducts, "product")}.`
    : hasCampaigns
      ? "Let’s get your discounts live."
      : "Let’s create your first quantity break.";
  const state = data.syncErrors > 0
    ? { className: "bb-state bb-state--alert", text: "Needs attention · a campaign failed to sync" }
    : live
      ? { className: "bb-state bb-state--live", text: "Live on your store" }
      : { className: "bb-state", text: `Not live yet · ${done} of ${steps.length} setup steps done` };

  return (
    <section className="bb-hero">
      <div>
        <span className="bb-brand">
          <strong>SaleLoop</strong>
          <small>Quantity breaks &amp; volume discounts</small>
        </span>
        <span className={state.className}>{state.text}</span>
        <h1 className="bb-hero__title">
          {`Welcome${hasCampaigns ? " back" : ""}${data.shopName ? `, ${data.shopName}` : ""}.`} <em>{next}</em>
        </h1>
        <p className="bb-hero__body">
          Give customers a bigger discount for every extra item. Shopify applies it automatically at checkout. Try
          the live preview.
        </p>
        <div className="bb-hero__actions">
          <Link className="bb-btn bb-btn--dark" to={hasCampaigns ? "/app/campaigns" : "/app/campaigns/new"}>
            {hasCampaigns ? "Go to campaigns →" : "Create a campaign →"}
          </Link>
          <Link className="bb-btn bb-btn--glass" to="/app/widget">
            Customize widget
          </Link>
        </div>
      </div>
      <QuantityPreview
        campaignName={featured?.name ?? null}
        tiers={featured?.tiers ?? null}
        discountType={featured?.discountType ?? "PERCENTAGE"}
        currencyCode={data.currencyCode}
        onAddToCart={onPreviewAddToCart}
      />
    </section>
  );
}

// ---------- Setup ----------

function SetupSteps({
  steps,
  busy,
  onSetupChange,
}: {
  steps: SetupStep[];
  busy: boolean;
  onSetupChange: (change: SetupChange) => void;
}) {
  const done = steps.filter((s) => s.done).length;
  const current = steps.findIndex((s) => !s.done);
  return (
    <section className="bb-glass bb-setup">
      <div className="bb-blockhead">
        <h2 className="bb-heading bb-heading--small">
          Go live in <em>three steps</em>
        </h2>
        <span className="bb-progress">
          <span
            className="bb-meter"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={steps.length}
            aria-valuenow={done}
            aria-label="Setup progress"
          >
            <span className="bb-meter__fill" style={{ inlineSize: `${(done / steps.length) * 100}%` }} />
          </span>
          <span className="bb-mono">{`${done} / ${steps.length}`}</span>
        </span>
      </div>
      <ol className="bb-steps">
        {steps.map((step, i) => {
          const state = step.done ? "done" : i === current ? "current" : "todo";
          const num = String(i + 1).padStart(2, "0");
          const isCurrent = state === "current";
          return (
            <li key={step.id} className={`bb-step bb-step--${state}`}>
              <span className="bb-step__tag bb-mono">
                {state === "done" ? `✓ ${num} — Done` : isCurrent ? `${num} — Up next` : num}
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <div className="bb-step__actions">
                {!step.done &&
                  (step.action.external ? (
                    <a
                      className={isCurrent ? "bb-btn bb-btn--dark bb-btn--small" : "bb-link"}
                      href={step.action.href}
                      target="_top"
                    >
                      {step.action.label}
                    </a>
                  ) : (
                    (isCurrent || step.id !== "activate") && (
                      <Link
                        className={isCurrent ? "bb-btn bb-btn--dark bb-btn--small" : "bb-link"}
                        to={step.action.href}
                      >
                        {step.action.label}
                      </Link>
                    )
                  ))}
                {step.manual && (
                  <button
                    type="button"
                    className="bb-link"
                    disabled={busy}
                    onClick={() => onSetupChange(step.done ? "unconfirmTheme" : "confirmTheme")}
                  >
                    {step.done ? "Mark as not done" : "I’ve added it"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------- Numbers ----------

function Kpis({ data }: { data: OverviewData }) {
  const kpis = [
    {
      label: "Live campaigns",
      value: data.liveCampaigns,
      note: data.counts.DRAFT ? `${data.counts.DRAFT} in draft` : null,
      to: "/app/campaigns?status=ACTIVE",
    },
    { label: "Products discounted", value: data.liveProducts, note: null, to: "/app/campaigns?status=ACTIVE" },
    { label: "Paused campaigns", value: data.counts.PAUSED, note: null, to: "/app/campaigns?status=PAUSED" },
    {
      label: "Sync issues",
      value: data.syncErrors,
      note: data.syncErrors ? "need a retry" : "all in sync",
      to: "/app/campaigns",
    },
  ];
  return (
    <div className="bb-kpis">
      {kpis.map((k) => (
        <Link key={k.label} to={k.to} className="bb-glass bb-kpi">
          <span className="bb-kpi__label">{k.label}</span>
          <span className="bb-kpi__value bb-mono">
            {number.format(k.value)}
            {k.note && <small>{k.note}</small>}
          </span>
        </Link>
      ))}
    </div>
  );
}

function Insights({ data }: { data: OverviewData }) {
  const total = data.counts.ACTIVE + data.counts.PAUSED + data.counts.DRAFT;
  return (
    <div className="bb-two">
      <div className="bb-glass bb-panel">
        <h3 className="bb-panel__title">Campaigns by status</h3>
        {total ? (
          <StatusRing
            label={`${total} campaigns: ${data.counts.ACTIVE} active, ${data.counts.PAUSED} paused, ${data.counts.DRAFT} draft`}
            center={{ value: total, caption: total === 1 ? "campaign" : "campaigns" }}
            segments={[
              { key: "active", label: "Active", value: data.counts.ACTIVE, color: "#e2433a" },
              { key: "paused", label: "Paused", value: data.counts.PAUSED, color: "#eda100" },
              { key: "draft", label: "Draft", value: data.counts.DRAFT, color: "#efe1dc" },
            ]}
          />
        ) : (
          <div className="bb-empty">Only archived campaigns so far.</div>
        )}
      </div>
      {data.recentCampaigns.length > 0 ? (
        <RecentCampaigns campaigns={data.recentCampaigns} currencyCode={data.currencyCode} />
      ) : (
        <div className="bb-glass bb-panel bb-empty">No campaigns to show.</div>
      )}
    </div>
  );
}

// ---------- What it does ----------

const FEATURES = [
  {
    title: "Quantity tiers",
    body: "Up to ten tiers per campaign, as a percentage or a fixed amount off each item.",
    demo: ["Buy 4+", "15% off"],
  },
  {
    title: "Automatic at checkout",
    body: "Runs as a Shopify discount. No codes for customers to find or type.",
    demo: ["Applied at checkout", "auto"],
    warm: true,
  },
  {
    title: "Exact targeting",
    body: "Whole products or just the variants you choose. Sizes and colours count together.",
    demo: ["S ×2 + M ×2", "= 4"],
    warm: true,
  },
  {
    title: "Shown on the product page",
    body: "The theme block lists every tier with the price per item, so the saving is clear before checkout.",
    demo: ["3 pairs · Most popular", "Save 10%"],
    wide: true,
  },
];

function Features() {
  return (
    <div className="bb-features">
      {FEATURES.map((f, i) => (
        <article
          key={f.title}
          className={["bb-glass", "bb-feature", f.wide && "bb-feature--wide", f.warm && "bb-feature--warm"]
            .filter(Boolean)
            .join(" ")}
        >
          <span className="bb-feature__num bb-mono">{String(i + 1).padStart(2, "0")}</span>
          <h3 className="bb-feature__title">{f.title}</h3>
          <p className="bb-feature__body">{f.body}</p>
          <span className="bb-feature__demo" aria-hidden="true">
            <span>{f.demo[0]}</span>
            <span className="bb-mono bb-save">{f.demo[1]}</span>
          </span>
        </article>
      ))}
    </div>
  );
}
