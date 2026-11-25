import { useEffect, useState } from "react";
import {
  Link,
  useFetcher,
  useLoaderData,
  useLocation,
  type ActionFunctionArgs,
  type HeadersFunction,
  type LinksFunction,
  type LoaderFunctionArgs,
} from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { requireAdmin } from "../.server/context";
import { toActionFailure } from "../.server/errors";
import { readJsonBody } from "../.server/request";
import { getWidgetSettings, updateWidgetSettings } from "../.server/services/settings.service";
import { syncStorefrontConfig } from "../.server/services/storefront-sync.service";
import { themeEditorUrl } from "../.server/theme";
import { fetchSellingPlans, type ShopSellingPlan } from "../.server/shopify/selling-plans";
import { logger } from "../.server/logger";
import { getShopPlan } from "../.server/services/billing.service";
import { applyWidgetPlan, planFor, planFromHandle, WIDGET_DEFAULTS, type WidgetField } from "../lib/plans";
import { EditorCard } from "../components/EditorCard";
import { ColorField, NumberField, TextField } from "../components/Fields";
import { RouteError } from "../components/RouteError";
import { Toggle } from "../components/Toggle";
import { useHydrated } from "../components/use-hydrated";
import { SAMPLE_TIERS, WidgetPreview, type PreviewTier } from "../components/WidgetPreview";
import { widgetSettingsSchema, type WidgetSettingsInput } from "../lib/settings-validation";
import blockStyles from "../styles/widget-block.css?url";

// The theme block's own stylesheet, so the preview matches the storefront.
export const links: LinksFunction = () => [{ rel: "stylesheet", href: blockStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  const [s, live, liveCount, { plan }] = await Promise.all([
    getWidgetSettings(shop.id),
    prisma.campaign.findFirst({
      where: { shopId: shop.id, status: "ACTIVE", syncStatus: "SYNCED" },
      orderBy: { updatedAt: "desc" },
      select: {
        name: true,
        discountType: true,
        products: { take: 1, select: { title: true, imageUrl: true } },
        tiers: { orderBy: { position: "asc" }, select: { minQuantity: true, value: true, label: true } },
      },
    }),
    prisma.campaign.count({ where: { shopId: shop.id, status: "ACTIVE", syncStatus: "SYNCED" } }),
    getShopPlan(shop.id, admin),
  ]);
  // The shop's subscription frequencies, for renaming/hiding and the preview.
  // A failure here only hides that list; the rest of the page still works.
  const sellingPlans = await fetchSellingPlans(admin).catch((error) => {
    logger.warn("Could not load selling plans", { shop: shop.domain, error });
    return [] as ShopSellingPlan[];
  });
  const stored: WidgetSettingsInput = {
    heading: s.heading,
    layout: s.layout,
    accentColor: s.accentColor,
    textColor: s.textColor,
    backgroundColor: s.backgroundColor,
    borderRadius: s.borderRadius,
    showSavings: s.showSavings,
    highlightBestDeal: s.highlightBestDeal,
    subheading: s.subheading,
    buyLabel: s.buyLabel,
    badgeText: s.badgeText,
    spacing: (["COMPACT", "COMFORTABLE", "SPACIOUS"] as const).find((v) => v === s.spacing) ?? "COMFORTABLE",
    headingSize: s.headingSize,
    textSize: s.textSize,
    tierBorderColor: s.tierBorderColor,
    selectedBackgroundColor: s.selectedBackgroundColor,
    savingsColor: s.savingsColor,
    badgeColor: s.badgeColor,
    badgeTextColor: s.badgeTextColor,
    containerBorderColor: s.containerBorderColor,
    showPricePerItem: s.showPricePerItem,
    showContainerBorder: s.showContainerBorder,
    showPurchaseOptions: s.showPurchaseOptions,
    oneTimeLabel: s.oneTimeLabel,
    subscribeLabel: s.subscribeLabel,
    frequencyLabel: s.frequencyLabel,
    planOverrides: (s.planOverrides ?? {}) as WidgetSettingsInput["planOverrides"],
  };
  // Any setting missing from the row (e.g. a server started before a new
  // option's migration) falls back to its default instead of breaking the page.
  const settings = {
    ...(WIDGET_DEFAULTS as unknown as WidgetSettingsInput),
    ...Object.fromEntries(Object.entries(stored).filter(([, value]) => value !== undefined && value !== null)),
  } as WidgetSettingsInput;
  return {
    settings,
    sellingPlans,
    planHandle: plan.handle,
    currencyCode: shop.currencyCode,
    liveCount,
    previewCampaign: live && {
      name: live.name,
      productTitle: live.products[0]?.title ?? null,
      productImageUrl: live.products[0]?.imageUrl ?? null,
      type: live.discountType === "PERCENTAGE" ? ("percentage" as const) : ("fixed" as const),
      tiers: live.tiers.map((t) => ({ qty: t.minQuantity, value: Number(t.value), label: t.label ?? "" })),
    },
    publishedAt: shop.storefrontSyncedAt?.toISOString() ?? null,
    themeEditorUrl: themeEditorUrl(shop.domain),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, actorId } = await requireAdmin(request);
  try {
    const { plan } = await getShopPlan(shop.id, admin);
    await updateWidgetSettings({ shopId: shop.id, actorId, plan }, await readJsonBody(request));
    const storefront = await syncStorefrontConfig(admin, shop.id);
    return { ok: true as const, published: storefront.ok };
  } catch (error) {
    return toActionFailure(error, { shop: shop.domain, route: "widget" });
  }
};

type Result =
  | { ok: true; published: boolean }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

type ColorKey =
  | "accentColor"
  | "textColor"
  | "backgroundColor"
  | "tierBorderColor"
  | "selectedBackgroundColor"
  | "savingsColor"
  | "badgeColor"
  | "badgeTextColor"
  | "containerBorderColor";

type Preset = { name: string } & Record<ColorKey, string>;

// One click sets every colour together; fine-tune afterwards.
const PRESETS: Preset[] = [
  {
    name: "Violet",
    accentColor: "#5B47E0",
    textColor: "#1D1B26",
    backgroundColor: "#FFFFFF",
    tierBorderColor: "#E1DDF7",
    selectedBackgroundColor: "#F4F2FE",
    savingsColor: "#5B47E0",
    badgeColor: "#5B47E0",
    badgeTextColor: "#FFFFFF",
    containerBorderColor: "#E6E3F5",
  },
  {
    name: "Forest",
    accentColor: "#1F7A4C",
    textColor: "#16211B",
    backgroundColor: "#F7FAF7",
    tierBorderColor: "#D5E5DA",
    selectedBackgroundColor: "#EAF5EE",
    savingsColor: "#1F7A4C",
    badgeColor: "#1F7A4C",
    badgeTextColor: "#FFFFFF",
    containerBorderColor: "#DCE8DF",
  },
  {
    name: "Ink",
    accentColor: "#18161F",
    textColor: "#18161F",
    backgroundColor: "#FFFFFF",
    tierBorderColor: "#DCDCE0",
    selectedBackgroundColor: "#F5F5F7",
    savingsColor: "#18161F",
    badgeColor: "#18161F",
    badgeTextColor: "#FFFFFF",
    containerBorderColor: "#E3E3E8",
  },
  {
    name: "Coral",
    accentColor: "#D9553A",
    textColor: "#2A1A16",
    backgroundColor: "#FFF8F5",
    tierBorderColor: "#F2D9D1",
    selectedBackgroundColor: "#FFEDE6",
    savingsColor: "#C2462D",
    badgeColor: "#D9553A",
    badgeTextColor: "#FFFFFF",
    containerBorderColor: "#F3E0D9",
  },
  {
    name: "Ocean",
    accentColor: "#1665C0",
    textColor: "#122033",
    backgroundColor: "#F5F9FF",
    tierBorderColor: "#D3E2F5",
    selectedBackgroundColor: "#E8F1FD",
    savingsColor: "#1665C0",
    badgeColor: "#1665C0",
    badgeTextColor: "#FFFFFF",
    containerBorderColor: "#D9E6F6",
  },
];

const COLOR_FIELDS: { key: ColorKey; label: string; group: "base" | "tiers" | "badge" }[] = [
  { key: "accentColor", label: "Accent (selected tier)", group: "base" },
  { key: "textColor", label: "Text", group: "base" },
  { key: "backgroundColor", label: "Background", group: "base" },
  { key: "containerBorderColor", label: "Outer border", group: "base" },
  { key: "tierBorderColor", label: "Tier border", group: "tiers" },
  { key: "selectedBackgroundColor", label: "Selected tier background", group: "tiers" },
  { key: "savingsColor", label: "Savings text", group: "tiers" },
  { key: "badgeColor", label: "Badge background", group: "badge" },
  { key: "badgeTextColor", label: "Badge text", group: "badge" },
];

const COLOR_GROUPS = [
  ["base", "Widget"],
  ["tiers", "Tiers"],
  ["badge", "Best deal badge"],
] as const;

// Shown in the "previewing" note for options above the shop's plan.
const FIELD_LABELS: Record<WidgetField, string> = {
  heading: "Heading",
  subheading: "Sub-heading",
  layout: "Layout",
  showSavings: "Savings",
  highlightBestDeal: "Best deal badge",
  accentColor: "Accent colour",
  showPurchaseOptions: "Purchase options",
  buyLabel: "Tier label",
  badgeText: "Badge text",
  showPricePerItem: "Price per item",
  showContainerBorder: "Outer border",
  spacing: "Spacing",
  borderRadius: "Corner radius",
  textColor: "Text colour",
  backgroundColor: "Background colour",
  oneTimeLabel: "One-time label",
  subscribeLabel: "Subscription label",
  frequencyLabel: "Frequency label",
  headingSize: "Heading size",
  textSize: "Text size",
  tierBorderColor: "Tier border colour",
  selectedBackgroundColor: "Selected tier background",
  savingsColor: "Savings colour",
  badgeColor: "Badge colour",
  badgeTextColor: "Badge text colour",
  containerBorderColor: "Outer border colour",
  planOverrides: "Frequency names",
};

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
    new Date(iso),
  );

function Segment<V extends string>(props: {
  name: string;
  label: string;
  value: V;
  options: readonly (readonly [V, string])[];
  onChange: (v: V) => void;
  disabled?: boolean;
  note?: string;
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
      {props.note && <span className="bb-fieldhint">{props.note}</span>}
    </div>
  );
}

export default function WidgetCustomization() {
  const {
    settings: initial,
    sellingPlans,
    planHandle,
    currencyCode,
    liveCount,
    previewCampaign,
    publishedAt,
    themeEditorUrl,
  } = useLoaderData<typeof loader>();
  const plan = planFromHandle(planHandle);
  const can = (field: WidgetField) => plan.widget.includes(field);
  const lockNote = (field: WidgetField) => {
    const next = planFor((p) => p.widget.includes(field));
    return can(field) || !next ? undefined : `Available on ${next.name}`;
  };
  // Start from what the store actually shows on this plan (locked options
  // use their defaults), so the preview always matches the storefront.
  const [settings, setSettings] = useState(() => applyWidgetPlan(initial, plan));
  const [baseline, setBaseline] = useState(() => applyWidgetPlan(initial, plan));
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const fetcher = useFetcher<Result>();
  const shopify = useAppBridge();
  const location = useLocation();
  // Until React is running, clicks would only change the raw HTML and be lost.
  const ready = useHydrated();

  const saving = fetcher.state !== "idle";
  const parsed = widgetSettingsSchema.safeParse(settings);
  const errors: Record<string, string> = fetcher.data && !fetcher.data.ok ? fetcher.data.fieldErrors ?? {} : {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors[issue.path.join(".")] ??= issue.message;
  }
  // Options above the plan can be tried in the preview, but only what the
  // plan includes is saved and published (the server enforces this too).
  const publishable = (s: WidgetSettingsInput) => applyWidgetPlan(s, plan);
  const dirty = JSON.stringify(publishable(settings)) !== JSON.stringify(publishable(baseline));


  // Subscription frequencies: the merchant's name for each plan, and hiding.
  const overrides = settings.planOverrides ?? {};
  const setPlanOverride = (id: string, patch: { label?: string; hidden?: boolean }) => {
    const merged = { ...overrides[id], ...patch };
    const next = { ...overrides };
    // Drop entries that change nothing, so clearing a name isn't an "edit".
    if (merged.label || merged.hidden) {
      next[id] = { ...(merged.label ? { label: merged.label } : {}), ...(merged.hidden ? { hidden: true } : {}) };
    } else {
      delete next[id];
    }
    set("planOverrides", next);
  };
  const previewPlans = sellingPlans
    .filter((p) => !overrides[p.id]?.hidden)
    .map((p) => ({ id: p.id, name: overrides[p.id]?.label || p.name, discount: p.discount, percent: p.percent }));

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const result = fetcher.data;
    if (!result.ok) {
      shopify.toast.show(result.message, { isError: true });
      return;
    }
    setBaseline(settings);
    shopify.toast.show(
      !result.published
        ? "Saved, but the store couldn’t be updated. Save again to retry."
        : "Saved and published to your store",
      { isError: !result.published },
    );
    // Only react to a finished save, not to edits made afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data, shopify]);

  const set = <K extends keyof WidgetSettingsInput>(key: K, value: WidgetSettingsInput[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));
  const save = () => {
    if (!parsed.success) {
      shopify.toast.show(
        `Fix: ${Object.keys(errors)
          .map((key) => FIELD_LABELS[key as WidgetField] ?? key)
          .join(", ")}`,
        { isError: true },
      );
      return;
    }
    fetcher.submit(publishable(parsed.data), { method: "post", encType: "application/json" });
  };
  const resetToDefaults = () => setSettings({ ...(WIDGET_DEFAULTS as unknown as WidgetSettingsInput) });

  const tiers: PreviewTier[] = previewCampaign?.tiers.length ? previewCampaign.tiers : SAMPLE_TIERS;
  // Presets only change the colours this plan includes.
  const presetKeys = COLOR_FIELDS.map((f) => f.key).filter((k) => can(k));
  const canPreset = can("textColor");
  const activePreset = PRESETS.find((p) =>
    presetKeys.every((key) => p[key].toLowerCase() === settings[key].toLowerCase()),
  );
  const upgrade = (target: string) => (
    <>
      {" "}
      <Link className="bb-link" to={{ pathname: "/app/billing", search: location.search }}>
        Upgrade to {target}
      </Link>
    </>
  );
  // Remount colour inputs when a preset or reset replaces their values.
  const colorKey = activePreset?.name ?? "custom";

  return (
    <s-page heading="Widget" inlineSize="large">
      <SaveBar id="widget-save-bar" open={dirty}>
        <button variant="primary" onClick={save} {...(saving ? { loading: "" } : {})}>
          Save
        </button>
        <button onClick={() => setSettings(baseline)} disabled={saving}>
          Discard
        </button>
      </SaveBar>

      <div className="bb-wrap">
        <header className="bb-pagehead">
          <span className="bb-kicker">
            Storefront block ·{" "}
            {publishedAt ? (ready ? `published ${when(publishedAt)}` : "published") : "not published yet"}
          </span>
          <h1 className="bb-display">
            Make the offer <em>yours</em>
          </h1>
          <p className="bb-lede">
            Customize every part of the quantity-break block shoppers see on product pages: text, layout, sizes and
            colours. Changes show in the preview right away and go live when you save.{" "}
            {plan.handle === "pro"
              ? "Every option is included in your Pro plan."
              : `Options marked “Available on …” unlock when you upgrade from ${plan.name}. The preview shows exactly what your store shows.`}
          </p>
        </header>

        {liveCount === 0 && (
          <s-banner tone="info" heading="The block only shows for live campaigns">
            It appears on products in a campaign that’s active at checkout. You don’t have one live yet.
            <s-button slot="secondary-actions" href="/app/campaigns">
              Go to campaigns
            </s-button>
          </s-banner>
        )}

        <div className="bb-editor bb-editor--wide-aside">
          <fieldset
            className={`bb-stack bb-editorfields${ready ? "" : " bb-editorfields--loading"}`}
            disabled={!ready}
            aria-busy={!ready}
          >
            <legend className="bb-visually-hidden">Widget settings</legend>
            {!ready && (
              <p className="bb-loadingnote" role="status">
                Loading editor…
              </p>
            )}
            <EditorCard num="01" title="Text" hint="What shoppers read on the block.">
              <div className="bb-fields">
                <TextField
                  label="Heading"
                  value={settings.heading}
                  maxLength={80}
                  error={errors.heading}
                  disabled={!can("heading")}
                  onChange={(v) => set("heading", v)}
                />
                <TextField
                  label="Sub-heading"
                  value={settings.subheading}
                  maxLength={120}
                  placeholder="Optional, e.g. Discount applied at checkout"
                  error={errors.subheading}
                  disabled={!can("subheading")}
                  onChange={(v) => set("subheading", v)}
                />
                <div className="bb-colorgrid">
                  <TextField
                    label="Tier label"
                    value={settings.buyLabel}
                    maxLength={40}
                    details={lockNote("buyLabel") ?? "{quantity} is replaced with each tier’s quantity."}
                    error={errors.buyLabel}
                    disabled={!can("buyLabel")}
                    onChange={(v) => set("buyLabel", v)}
                  />
                  <TextField
                    label="Best deal badge"
                    value={settings.badgeText}
                    maxLength={20}
                    details={lockNote("badgeText")}
                    error={errors.badgeText}
                    disabled={!can("badgeText")}
                    onChange={(v) => set("badgeText", v)}
                  />
                </div>
              </div>
            </EditorCard>

            <EditorCard
              num="02"
              title="What to show"
              hint={can("showPricePerItem") ? undefined : <>Price per item and the outer border are on Growth.{upgrade("Growth")}</>}
            >
              <div className="bb-toggles">
                <Toggle
                  label="Show savings on each tier"
                  hint={lockNote("showSavings") ? `${lockNote("showSavings")}. “Save 10%” next to every quantity.` : "“Save 10%” next to every quantity."}
                  checked={settings.showSavings}
                  disabled={!can("showSavings")}
                  onChange={(v) => set("showSavings", v)}
                />
                <Toggle
                  label="Show price per item"
                  hint={lockNote("showPricePerItem") ? `${lockNote("showPricePerItem")}. The discounted price for each item in the tier.` : "The discounted price for each item in the tier."}
                  checked={settings.showPricePerItem}
                  disabled={!can("showPricePerItem")}
                  onChange={(v) => set("showPricePerItem", v)}
                />
                <Toggle
                  label="Highlight the best deal"
                  hint={lockNote("highlightBestDeal") ? `${lockNote("highlightBestDeal")}. A badge on the largest tier.` : "A badge on the largest tier."}
                  checked={settings.highlightBestDeal}
                  disabled={!can("highlightBestDeal")}
                  onChange={(v) => set("highlightBestDeal", v)}
                />
                <Toggle
                  label="Show outer border"
                  hint={lockNote("showContainerBorder") ? `${lockNote("showContainerBorder")}. A frame around the whole block.` : "A frame around the whole block."}
                  checked={settings.showContainerBorder}
                  disabled={!can("showContainerBorder")}
                  onChange={(v) => set("showContainerBorder", v)}
                />
              </div>
            </EditorCard>

            <EditorCard
              num="03"
              title="Purchase options"
              hint={
                can("oneTimeLabel") ? (
                  "One-time purchase or Subscribe & save, with a delivery frequency. Shown on products in your BundleBoost subscription plans."
                ) : (
                  <>Custom labels are on Growth.{upgrade("Growth")}</>
                )
              }
            >
              <div className="bb-fields">
                <div className="bb-toggles">
                  <Toggle
                    label="Show purchase options"
                    hint="Lets shoppers choose a one-time purchase or a subscription right in the widget."
                    checked={settings.showPurchaseOptions}
                    disabled={!can("showPurchaseOptions")}
                    onChange={(v) => set("showPurchaseOptions", v)}
                  />
                </div>
                {settings.showPurchaseOptions && (
                  <>
                    <div className="bb-colorgrid">
                      <TextField
                        label="One-time label"
                        value={settings.oneTimeLabel}
                        maxLength={40}
                        details={lockNote("oneTimeLabel")}
                        error={errors.oneTimeLabel}
                        disabled={!can("oneTimeLabel")}
                        onChange={(v) => set("oneTimeLabel", v)}
                      />
                      <TextField
                        label="Subscription label"
                        value={settings.subscribeLabel}
                        maxLength={50}
                        details={lockNote("subscribeLabel") ?? "{discount} shows the plan’s saving, e.g. 10%."}
                        error={errors.subscribeLabel}
                        disabled={!can("subscribeLabel")}
                        onChange={(v) => set("subscribeLabel", v)}
                      />
                    </div>
                    <TextField
                      label="Frequency label"
                      value={settings.frequencyLabel}
                      maxLength={40}
                      details={lockNote("frequencyLabel")}
                      error={errors.frequencyLabel}
                      disabled={!can("frequencyLabel")}
                      onChange={(v) => set("frequencyLabel", v)}
                    />
                    <div>
                      <span className="bb-fieldlabel">Delivery frequencies</span>
                      {sellingPlans.length === 0 ? (
                        <p className="bb-fieldhint bb-plansempty">
                          You have no subscription plans yet.{" "}
                          <Link className="bb-link" to="/app/subscriptions/new">
                            Create a plan
                          </Link>{" "}
                          with delivery frequencies (for example every month or every 3 months) and add products to it.
                          They appear here and in the widget automatically.
                        </p>
                      ) : (
                        <>
                          <span className="bb-fieldhint bb-fieldhint--top">
                            {lockNote("planOverrides") ??
                              "From your subscription plans. Rename any frequency (e.g. “Quarterly”) or hide it from the widget. Add new ones in Subscriptions."}
                          </span>
                          <ul className="bb-freqlist">
                            {sellingPlans.map((p) => {
                              const o = overrides[p.id] ?? {};
                              return (
                                <li key={p.id} className={`bb-freqrow${o.hidden ? " bb-freqrow--hidden" : ""}`}>
                                  <div className="bb-freqrow__name">
                                    <strong>{p.name}</strong>
                                    <small>
                                      {p.groupName}
                                      {p.discount ? ` · saves ${p.discount}` : ""}
                                    </small>
                                  </div>
                                  <TextField
                                    label={`Name shown for ${p.name}`}
                                    labelHidden
                                    value={o.label ?? ""}
                                    placeholder={p.name}
                                    maxLength={60}
                                    error={errors[`planOverrides.${p.id}.label`]}
                                    disabled={!can("planOverrides")}
                                    onChange={(v) => setPlanOverride(p.id, { label: v })}
                                  />
                                  <label className="bb-freqrow__show">
                                    <input
                                      type="checkbox"
                                      checked={!o.hidden}
                                      disabled={!can("planOverrides")}
                                      onChange={(e) => setPlanOverride(p.id, { hidden: !e.currentTarget.checked })}
                                    />
                                    Show
                                  </label>
                                </li>
                              );
                            })}
                          </ul>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </EditorCard>

            <EditorCard
              num="04"
              title="Layout and size"
              hint={
                can("headingSize") ? undefined : (
                  <>
                    {can("spacing")
                      ? "Font sizes are on Pro."
                      : "Spacing and corners are on Growth, font sizes on Pro."}
                    {upgrade(can("spacing") ? "Pro" : "Growth")}
                  </>
                )
              }
            >
              <div className="bb-fields">
                <Segment
                  name="layout"
                  label="Layout"
                  value={settings.layout}
                  options={[
                    ["STACKED", "Stacked rows"],
                    ["GRID", "Side-by-side cards"],
                  ]}
                  disabled={!can("layout")}
                  onChange={(v) => set("layout", v)}
                  note={lockNote("layout")}
                />
                <Segment
                  name="spacing"
                  label="Spacing"
                  value={settings.spacing}
                  options={[
                    ["COMPACT", "Compact"],
                    ["COMFORTABLE", "Comfortable"],
                    ["SPACIOUS", "Spacious"],
                  ]}
                  disabled={!can("spacing")}
                  onChange={(v) => set("spacing", v)}
                  note={lockNote("spacing")}
                />
                <div className="bb-colorgrid">
                  <NumberField
                    label="Heading size"
                    suffix="px"
                    min={12}
                    max={32}
                    step={1}
                    value={String(settings.headingSize)}
                    error={errors.headingSize}
                    details={lockNote("headingSize")}
                    disabled={!can("headingSize")}
                    onChange={(v) => set("headingSize", Number(v))}
                  />
                  <NumberField
                    label="Text size"
                    suffix="px"
                    min={11}
                    max={20}
                    step={1}
                    value={String(settings.textSize)}
                    error={errors.textSize}
                    details={lockNote("textSize")}
                    disabled={!can("textSize")}
                    onChange={(v) => set("textSize", Number(v))}
                  />
                  <NumberField
                    label="Corner radius"
                    suffix="px"
                    min={0}
                    max={32}
                    step={1}
                    value={String(settings.borderRadius)}
                    error={errors.borderRadius}
                    details={lockNote("borderRadius")}
                    disabled={!can("borderRadius")}
                    onChange={(v) => set("borderRadius", Number(v))}
                  />
                </div>
              </div>
            </EditorCard>

            <EditorCard
              num="05"
              title="Colours"
              hint={
                can("tierBorderColor") ? (
                  "Start from a preset, then fine-tune any colour."
                ) : canPreset ? (
                  <>Presets set your accent, text and background. Tier and badge colours are on Pro.{upgrade("Pro")}</>
                ) : (
                  <>Your plan includes the accent colour. Presets and more colours are on Growth.{upgrade("Growth")}</>
                )
              }
            >
              <div className="bb-presets" role="group" aria-label="Colour presets">
                {PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    className="bb-preset"
                    aria-pressed={canPreset && activePreset?.name === p.name}
                    disabled={!canPreset}
                    title={canPreset ? undefined : lockNote("textColor")}
                    onClick={() =>
                      setSettings((s) => {
                        const next = { ...s };
                        for (const key of presetKeys) next[key] = p[key];
                        return next;
                      })
                    }
                  >
                    <span className="bb-preset__swatch" aria-hidden="true">
                      <i style={{ background: p.backgroundColor }} />
                      <i style={{ background: p.accentColor }} />
                      <i style={{ background: p.textColor }} />
                    </span>
                    {p.name}
                  </button>
                ))}
              </div>
              <div className="bb-fields">
                {COLOR_GROUPS.map(([group, title]) => (
                  <div key={group}>
                    <span className="bb-fieldlabel bb-fieldlabel--group">{title}</span>
                    <div className="bb-colorgrid">
                      {COLOR_FIELDS.filter((f) => f.group === group).map(({ key, label }) => (
                        <ColorField
                          key={`${key}-${colorKey}`}
                          label={label}
                          value={settings[key]}
                          error={errors[key]}
                          details={lockNote(key)}
                          disabled={!can(key)}
                          onChange={(v) => set(key, v)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="bb-actions bb-resetrow">
                <button type="button" className="bb-link" onClick={resetToDefaults}>
                  Reset all widget settings to defaults
                </button>
              </div>
            </EditorCard>

            <EditorCard num="06" title="Add it to your theme">
              <ol className="bb-howto">
                <li>Open the theme editor. It starts on a product page with the BundleBoost block added.</li>
                <li>Drag the block under the price or the Add to cart button.</li>
                <li>Select Save in the theme editor.</li>
              </ol>
              <div className="bb-actions">
                <a className="bb-btn bb-btn--dark" href={themeEditorUrl} target="_top">
                  Open theme editor →
                </a>
                <Link className="bb-link" to="/app">
                  Back to setup steps
                </Link>
              </div>
            </EditorCard>
          </fieldset>

          <aside className="bb-stack bb-editor__aside bb-sticky">
            <EditorCard
              title="Preview"
              aside={
                <fieldset className="bb-segment bb-segment--mini" aria-label="Preview size">
                  {(
                    [
                      ["desktop", "Desktop"],
                      ["mobile", "Mobile"],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name="device"
                        value={value}
                        checked={device === value}
                        onChange={() => setDevice(value)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>
              }
              hint={
                previewCampaign
                  ? `Tiers from “${previewCampaign.name}”. Sample product and price. Click a tier to see the selected style.`
                  : "Example tiers until you have a live campaign. Click a tier to see the selected style."
              }
            >
              <div className={`bb-device bb-device--${device}`}>
                <div className="bb-mockpdp">
                  <div className="bb-mockpdp__image" aria-hidden="true">
                    {previewCampaign?.productImageUrl ? (
                      <img
                        src={previewCampaign.productImageUrl}
                        alt={previewCampaign.productTitle ?? "Product"}
                        className="bb-mockpdp__img"
                      />
                    ) : (
                      <div className="bb-mockpdp__tshirt">
                        <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="bb-tshirt-svg">
                          <path
                            d="M32 20C35 27 42 31 50 31C58 31 65 27 68 20L86 30L76 50L68 45V82H32V45L24 50L14 30L32 20Z"
                            fill="#5B47E0"
                            fillOpacity="0.15"
                            stroke="#5B47E0"
                            strokeWidth="2.5"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M40 20C42 24 46 26 50 26C54 26 58 24 60 20"
                            stroke="#5B47E0"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                          />
                          <path d="M24 50L32 45" stroke="#5B47E0" strokeWidth="2" strokeLinecap="round" />
                          <path d="M76 50L68 45" stroke="#5B47E0" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="bb-mockpdp__title">{previewCampaign?.productTitle ?? "BundleBoost Classic T-Shirt"}</div>
                  <div className="bb-mockpdp__price">
                    {new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode ?? "USD" }).format(24)}
                  </div>
                  {parsed.success ? (
                    <WidgetPreview
                      settings={parsed.data}
                      plans={sellingPlans.length ? previewPlans : undefined}
                      tiers={tiers}
                      type={previewCampaign?.type ?? "percentage"}
                      currencyCode={currencyCode}
                    />
                  ) : (
                    <div className="bb-empty bb-placeholder">
                      Fix {Object.keys(errors).length === 1 ? "this field" : "these fields"} to see the preview:{" "}
                      {Object.keys(errors)
                        .map((key) => FIELD_LABELS[key as WidgetField] ?? key)
                        .join(", ")}
                    </div>
                  )}
                  <div className="bb-mockpdp__cart" aria-hidden="true">
                    Add to cart
                  </div>
                </div>
              </div>
              <div className="bb-savebar">
                <span className="bb-savebar__status" role="status">
                  {saving ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}
                </span>
                <button
                  type="button"
                  className="bb-btn bb-btn--glass"
                  disabled={!dirty || saving || !ready}
                  onClick={() => setSettings(baseline)}
                >
                  Discard
                </button>
                <button
                  type="button"
                  className="bb-btn bb-btn--dark"
                  disabled={!dirty || saving || !ready}
                  onClick={save}
                >
                  {saving && <span className="bb-spinner" aria-hidden="true" />}
                  {saving ? "Saving…" : "Save and publish"}
                </button>
              </div>
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
