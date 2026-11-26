import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { CampaignStatusValue, DiscountTypeValue } from "../../lib/campaign-validation";
import { campaignState, type SyncStatusValue } from "../../lib/campaign-state";
import { formatTierSummary } from "../../lib/format";
import { readValue, useFieldEvents } from "../use-field-events";
import { on } from "../bool-attrs";

export type CampaignRow = {
  id: string;
  name: string;
  status: CampaignStatusValue;
  syncStatus: SyncStatusValue;
  discountType: DiscountTypeValue;
  productCount: number;
  productTitles: string[];
  tiers: { minQuantity: number; value: string }[];
  updatedAt: string;
};

type Tab = "ALL" | CampaignStatusValue;
const TABS: { value: Tab; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "PAUSED", label: "Paused" },
  { value: "DRAFT", label: "Draft" },
  { value: "ARCHIVED", label: "Archived" },
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const shortDate = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));

function productsLine(c: CampaignRow) {
  if (!c.productCount) return "No products";
  const shown = c.productTitles.slice(0, 2).join(", ");
  return c.productCount > 2 ? `${shown} + ${c.productCount - 2} more` : shown;
}

/**
 * Campaign index: page head, then one glass table with status tabs and
 * search on top. Filtering happens in the browser; every campaign is loaded.
 */
export function CampaignsView({
  campaigns,
  currencyCode,
  initialTab,
  deleting,
  isBulkBusy,
  onDelete,
  onBulkStatus,
  onBulkDelete,
}: {
  campaigns: CampaignRow[];
  currencyCode: string | null;
  initialTab: Tab;
  deleting: boolean;
  isBulkBusy: boolean;
  onDelete: (campaign: CampaignRow) => void;
  onBulkStatus: (ids: string[], status: CampaignStatusValue) => void;
  onBulkDelete: (ids: string[]) => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");
  const [doomed, setDoomed] = useState<CampaignRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // The bulk status change in progress, so only that button shows the loader.
  const [bulkStatus, setBulkStatus] = useState<CampaignStatusValue | null>(null);
  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  const prevBulkBusy = useRef(isBulkBusy);
  const searchRef = useFieldEvents<HTMLElementTagNameMap["s-search-field"]>((el) => setQuery(readValue(el)));

  useEffect(() => {
    if (prevBulkBusy.current && !isBulkBusy) {
      setSelectedIds([]);
    }
    prevBulkBusy.current = isBulkBusy;
  }, [isBulkBusy]);

  const count = (t: Tab) =>
    t === "ALL" ? campaigns.filter((c) => c.status !== "ARCHIVED").length : campaigns.filter((c) => c.status === t).length;
  const live = campaigns.filter((c) => campaignState(c.status, c.syncStatus).key === "live").length;
  const needle = query.trim().toLowerCase();
  const shown = campaigns.filter(
    (c) =>
      (tab === "ALL" ? c.status !== "ARCHIVED" : c.status === tab) &&
      (!needle ||
        [c.name, ...c.productTitles, formatTierSummary(c.discountType, c.tiers, currencyCode)].some((text) =>
          text.toLowerCase().includes(needle),
        )),
  );

  const allShownSelected = shown.length > 0 && shown.every((c) => selectedIds.includes(c.id));
  const someShownSelected = shown.some((c) => selectedIds.includes(c.id));
  const selectedCampaigns = campaigns.filter((c) => selectedIds.includes(c.id));
  const canActivate = selectedCampaigns.some((c) => c.status !== "ACTIVE");
  const canPause = selectedCampaigns.some((c) => c.status === "ACTIVE");
  const canArchive = selectedCampaigns.some((c) => c.status !== "ARCHIVED");

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someShownSelected && !allShownSelected;
    }
  }, [someShownSelected, allShownSelected]);

  const toggleAllShown = () => {
    if (allShownSelected) {
      const shownIds = new Set(shown.map((c) => c.id));
      setSelectedIds((prev) => prev.filter((id) => !shownIds.has(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...shown.map((c) => c.id)])));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <s-page heading="Campaigns" inlineSize="large">
      <s-button slot="primary-action" variant="primary" href="/app/campaigns/new">
        Create campaign
      </s-button>
      <div className="bb-wrap bb-animate">
        <header className="bb-pagehead">
          <span className="bb-kicker">
            {campaigns.length ? `${plural(campaigns.length, "campaign")} · ${live} live` : "No campaigns yet"}
          </span>
          <h1 className="bb-display">
            Your <em>campaigns</em>
          </h1>
          <p className="bb-lede">
            Each campaign gives a bigger discount as customers buy more of the products you choose. Open one to edit
            its tiers, products or status.
          </p>
        </header>

        {campaigns.length === 0 ? (
          <StartCard />
        ) : (
          <div className="bb-glass bb-table">
            <div className="bb-table__bar">
              <div className="bb-tabs" role="tablist" aria-label="Status">
                {TABS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.value}
                    className="bb-tab"
                    onClick={() => setTab(t.value)}
                  >
                    {t.label}
                    <span>{count(t.value)}</span>
                  </button>
                ))}
              </div>
              <div className="bb-table__search">
                <s-search-field
                  ref={searchRef}
                  label="Search campaigns"
                  labelAccessibilityVisibility="exclusive"
                  placeholder="Search by name, product or tier"
                  value={query}
                />
              </div>
            </div>

            {selectedIds.length > 0 && (
              <div className="bb-bulk-bar">
                <div className="bb-bulk-bar__info">
                  <span className="bb-bulk-bar__count">
                    <strong>{selectedIds.length}</strong> {selectedIds.length === 1 ? "campaign selected" : "campaigns selected"}
                  </span>
                  <button
                    type="button"
                    className="bb-bulk-bar__deselect"
                    onClick={() => setSelectedIds([])}
                  >
                    Deselect all
                  </button>
                </div>
                <div className="bb-bulk-bar__actions">
                  {canActivate && (
                    <s-button
                      variant="secondary"
                      {...on({ disabled: isBulkBusy, loading: isBulkBusy && bulkStatus === "ACTIVE" })}
                      onClick={() => {
                        setBulkStatus("ACTIVE");
                        onBulkStatus(selectedIds, "ACTIVE");
                      }}
                    >
                      Activate
                    </s-button>
                  )}
                  {canPause && (
                    <s-button
                      variant="secondary"
                      {...on({ disabled: isBulkBusy, loading: isBulkBusy && bulkStatus === "PAUSED" })}
                      onClick={() => {
                        setBulkStatus("PAUSED");
                        onBulkStatus(selectedIds, "PAUSED");
                      }}
                    >
                      Pause
                    </s-button>
                  )}
                  {canArchive && (
                    <s-button
                      variant="secondary"
                      {...on({ disabled: isBulkBusy, loading: isBulkBusy && bulkStatus === "ARCHIVED" })}
                      onClick={() => {
                        setBulkStatus("ARCHIVED");
                        onBulkStatus(selectedIds, "ARCHIVED");
                      }}
                    >
                      Archive
                    </s-button>
                  )}
                  <s-button
                    variant="secondary"
                    tone="critical"
                    commandFor="bulk-delete-modal"
                    command="--show"
                    {...on({ disabled: isBulkBusy })}
                  >
                    Delete
                  </s-button>
                </div>
              </div>
            )}

            {shown.length ? (
              <>
                <div className="bb-table__head">
                  <div className="bb-table__select">
                    <input
                      type="checkbox"
                      ref={headerCheckboxRef}
                      className="bb-checkbox"
                      checked={allShownSelected}
                      onChange={toggleAllShown}
                      aria-label="Select all campaigns"
                    />
                  </div>
                  <span>Campaign</span>
                  <span>Status</span>
                  <span>Tiers</span>
                  <span>Products</span>
                  <span>Updated</span>
                  <span />
                </div>
                <ul className="bb-table__rows">
                  {shown.map((c) => {
                    const state = campaignState(c.status, c.syncStatus);
                    const deletable = c.status === "DRAFT" || c.status === "ARCHIVED";
                    const isSelected = selectedIds.includes(c.id);
                    return (
                      <li key={c.id} className={isSelected ? "is-selected" : undefined}>
                        <div className="bb-table__select">
                          <input
                            type="checkbox"
                            className="bb-checkbox"
                            checked={isSelected}
                            onChange={() => toggleOne(c.id)}
                            aria-label={`Select ${c.name}`}
                          />
                        </div>
                        <Link className="bb-crow" to={`/app/campaigns/${c.id}`}>
                          <span className="bb-crow__main">
                            <span className="bb-crow__name">{c.name}</span>
                            <span className="bb-crow__sub">
                              {formatTierSummary(c.discountType, c.tiers, currencyCode)} · {productsLine(c)}
                            </span>
                          </span>
                          <span className={`bb-state bb-state--${state.key}`}>{state.label}</span>
                          <span className={c.tiers.length ? "bb-crow__num" : "bb-crow__num is-zero"}>
                            {c.tiers.length}
                            <span className="bb-crow__unit">{c.tiers.length === 1 ? " tier" : " tiers"}</span>
                          </span>
                          <span className={c.productCount ? "bb-crow__num" : "bb-crow__num is-zero"}>
                            {c.productCount}
                            <span className="bb-crow__unit">{c.productCount === 1 ? " product" : " products"}</span>
                          </span>
                          <span className="bb-crow__date">{shortDate(c.updatedAt)}</span>
                        </Link>
                        {deletable ? (
                          <s-button
                            variant="tertiary"
                            tone="critical"
                            icon="delete"
                            accessibilityLabel={`Delete ${c.name}`}
                            commandFor="delete-campaign-modal"
                            command="--show"
                            onClick={() => setDoomed(c)}
                          />
                        ) : (
                          <span />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <div className="bb-empty">
                <s-icon type="search" tone="neutral" />
                {needle ? "No campaigns match. Try a different search or status." : "No campaigns with this status."}
              </div>
            )}
          </div>
        )}
      </div>

      <s-modal id="bulk-delete-modal" heading={`Delete ${selectedIds.length === 1 ? "campaign" : `${selectedIds.length} campaigns`}?`}>
        <s-paragraph>
          {selectedIds.length === 1
            ? "This campaign will be permanently deleted. This can't be undone."
            : `These ${selectedIds.length} campaigns will be permanently deleted. This can't be undone.`}
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          {...on({ loading: isBulkBusy, disabled: isBulkBusy })}
          onClick={() => {
            (document.getElementById("bulk-delete-modal") as (HTMLElement & { hideOverlay?: () => void }) | null)?.hideOverlay?.();
            onBulkDelete(selectedIds);
          }}
        >
          Delete
        </s-button>
        <s-button slot="secondary-actions" commandFor="bulk-delete-modal" command="--hide">
          Cancel
        </s-button>
      </s-modal>

      <s-modal id="delete-campaign-modal" heading="Delete campaign?">
        <s-paragraph>
          {doomed && `"${doomed.name}" will be permanently deleted. This can't be undone.`}
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          {...(deleting ? { loading: true, disabled: true } : {})}
          onClick={() => doomed && onDelete(doomed)}
        >
          Delete
        </s-button>
        <s-button slot="secondary-actions" commandFor="delete-campaign-modal" command="--hide">
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

const EXAMPLES = [
  ["Buy 2", "5% off"],
  ["Buy 3", "10% off"],
  ["Buy 4+", "15% off"],
];

function StartCard() {
  return (
    <section className="bb-glass bb-start">
      <h2 className="bb-heading bb-heading--small">
        Reward customers <em>who buy more</em>
      </h2>
      <p>
        Pick the products, set a discount for each quantity, and activate. Shopify applies it automatically at
        checkout, with no codes.
      </p>
      <div className="bb-chips" aria-label="Example tiers">
        {EXAMPLES.map(([qty, off]) => (
          <span key={qty} className="bb-chip">
            {qty} <b>{off}</b>
          </span>
        ))}
      </div>
      <div className="bb-hero__actions">
        <Link className="bb-btn bb-btn--dark" to="/app/campaigns/new">
          Create your first campaign →
        </Link>
      </div>
    </section>
  );
}
