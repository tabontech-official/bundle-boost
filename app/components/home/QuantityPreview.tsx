import { useState } from "react";
import type { DiscountTypeValue } from "../../lib/campaign-validation";

/**
 * A working preview of the product-page quantity-break block. Uses the
 * merchant's live campaign tiers when there is one; otherwise example tiers.
 * The product and its price are a labelled sample, never store data.
 */
export type PreviewTier = { minQuantity: number; value: string; label: string | null };

const SAMPLE_PRICE = 24;
const EXAMPLE_TIERS: PreviewTier[] = [
  { minQuantity: 1, value: "0", label: null },
  { minQuantity: 2, value: "5", label: null },
  { minQuantity: 3, value: "10", label: "Most popular" },
  { minQuantity: 4, value: "15", label: null },
];

function money(amount: number, currencyCode: string | null) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode ?? "USD" }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export function QuantityPreview({
  campaignName,
  tiers: liveTiers,
  discountType,
  currencyCode,
  onAddToCart,
  productName = "Merino Crew Socks",
  units = ["pair", "pairs"],
}: {
  productName?: string;
  /** Singular and plural for the quantity rows, e.g. ["item", "items"]. */
  units?: [string, string];
  campaignName: string | null;
  tiers: PreviewTier[] | null;
  discountType: DiscountTypeValue;
  currencyCode: string | null;
  onAddToCart: () => void;
}) {
  // A "1 pair" row first, so the preview shows the full-price baseline.
  const tiers =
    liveTiers && liveTiers.length
      ? [{ minQuantity: 1, value: "0", label: null }, ...liveTiers]
      : EXAMPLE_TIERS;
  const [picked, setPicked] = useState(2);
  // Tiers can shrink while editing; never point past the last one.
  const selected = Math.min(picked, tiers.length - 1);
  const tier = tiers[selected];
  const value = Number(tier.value);
  const unit =
    discountType === "PERCENTAGE" ? SAMPLE_PRICE * (1 - value / 100) : Math.max(SAMPLE_PRICE - value, 0);
  const total = unit * tier.minQuantity;
  const full = SAMPLE_PRICE * tier.minQuantity;
  const saved = full - total;
  const best = tiers.length - 1;
  const offLabel = (t: PreviewTier) =>
    Number(t.value) === 0
      ? "Full price"
      : discountType === "PERCENTAGE"
        ? `Save ${Number(t.value)}%`
        : `Save ${money(Number(t.value), currencyCode)} each`;

  return (
    <div className="bb-glass bb-pdp" role="group" aria-label="Sample product page you can try">
      <div className="bb-pdp__head">
        <span className="bb-pdp__thumb" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 26 26">
            <path d="M8 3h7v9l3.5 6.5a4 4 0 0 1-3.5 6H7.5A3.5 3.5 0 0 1 4 21v-1a3 3 0 0 1 3-3h1z" fill="#ffa98a" />
            <path d="M8 3h7v3H8z" fill="#e2433a" />
          </svg>
        </span>
        <span>
          <strong>{productName}</strong>
          <small>Sample product · live preview</small>
        </span>
      </div>

      <div className="bb-pdp__label">
        <span>Buy more, save more</span>
        <span>{campaignName ?? "Example tiers"}</span>
      </div>
      <div className="bb-tiers">
        {tiers.slice(0, 5).map((t, i) => (
          <button
            key={t.minQuantity}
            type="button"
            className="bb-tier"
            aria-pressed={i === selected}
            onClick={() => setPicked(i)}
          >
            <span>
              {t.minQuantity === 1 ? `1 ${units[0]}` : `${t.minQuantity} ${units[1]}`}
              {i === best && tiers.length > 2 && <span className="bb-tier__badge">Best deal</span>}
              {t.label && <small>{t.label}</small>}
            </span>
            <span className={Number(t.value) > 0 ? "bb-mono bb-save" : "bb-mono"}>{offLabel(t)}</span>
          </button>
        ))}
      </div>

      <div className="bb-pdp__savings">
        <span>You save</span>
        <span className="bb-mono bb-save">{saved > 0 ? money(saved, currencyCode) : "—"}</span>
      </div>

      <button
        type="button"
        className="bb-addcart"
        aria-label={`Add to cart, ${tier.minQuantity} items, ${money(total, currencyCode)}`}
        onClick={onAddToCart}
      >
        <span>Add to cart</span>
        <span className="bb-mono">
          {saved > 0 && <s>{money(full, currencyCode)}</s>}
          {money(total, currencyCode)}
        </span>
      </button>
    </div>
  );
}
