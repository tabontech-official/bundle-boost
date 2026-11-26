# BundleBoost: Shopify App Store listing

Copy each field into the Partner Dashboard / Dev Dashboard listing form
(Apps → BundleBoost → Distribution → App Store listing). Character counts are
shown in brackets; the form shows each field's limit too, so check them there.

---

## How App Store search ranks apps (what this listing is built for)

- **The words in your listing are what search matches.** In order of weight:
  app name, app card subtitle, search terms, introduction, details, features.
  The main phrases merchants search for this kind of app are used once each in
  the right places: *quantity breaks, volume discount, tiered pricing, bulk
  discount, subscribe and save, subscriptions*. Don't repeat them more:
  keyword stuffing is against the listing rules and can get the listing
  rejected.
- **Installs, reviews and ratings** move you up after launch. Ask happy
  merchants for a review (from inside the app, never in exchange for anything).
- **Built for Shopify** status (performance + design + integration checks)
  gives a badge and better placement. Apply once you have the required
  installs and reviews.
- **Categories and tags** decide which browse pages you appear on.

---

## 1. App name  `[27]`

```
BundleBoost Quantity Breaks
```

Brand + the main search phrase. Don't use "Shopify", prices or claims like
"#1" in the name.

## 2. App icon

`branding/app-icon.png` (1200 × 1200 px, the Bundle Stack icon). No text in
the icon.

## 3. App card subtitle  `[54]`

Shown under the name in search results.

```
Volume discounts, quantity breaks & Subscribe and save
```

## 4. Search terms (up to 5)

```
volume discount
quantity breaks
tiered pricing
bulk discount
subscribe and save
```

## 5. App introduction  `[90]`

```
Grow order value with tiered quantity discounts and Subscribe & save, applied at checkout.
```

## 6. App details  `[494]`

```
BundleBoost turns single-item orders into bigger baskets. Create quantity breaks like Buy 2, save 10% and Buy 5, save 20%, as a percentage or a fixed amount off each item, on the products or variants you choose. A theme block shows every tier, the price per item and the savings on the product page, and the discount is applied automatically at Shopify checkout, with no codes. Add Subscribe & save plans with automatic renewals, and let customers manage their subscriptions from their account.
```

## 7. Features (one per line)

```
Tiered volume discounts: percentage or fixed amount off each item
Applied automatically at checkout as a Shopify discount, no codes
Product page block shows tiers, price per item and savings
Target whole products or specific variants; variants count together
Subscribe & save plans with any delivery frequency and discount
Automatic renewals with retries for failed payments
Customers skip, pause or cancel subscriptions in their account
Match your brand: text, layout and colours, with a live preview
```

## 8. Categories and tags

- **Primary category:** the discounts / pricing category (e.g. *Selling
  products → Pricing → Discounts*; pick the closest the form offers).
- **Secondary category:** subscriptions (*Selling products → Purchase options
  → Subscriptions*, or closest).
- **Tags:** pick the ones the form offers for volume discounts, tiered
  pricing, upsell, subscriptions.

## 9. Pricing (must match the app's plans exactly)

| Plan | Price | What's included |
| --- | --- | --- |
| Free | $0 | 1 active campaign · up to 5 products · 3 tiers · percentage & fixed discounts · basic widget (text, layout, brand colour) |
| Growth | $7.99 / month | 10 active campaigns · up to 100 products · 10 tiers · custom widget (labels, spacing, shape, colour presets) · email support |
| Pro | $14.99 / month | Up to 25 active campaigns · unlimited products · 20 tiers · full widget customization · priority support |

Billed every 30 days through Shopify. If you add a free trial in the app,
add it here too.

## 10. Screenshots (desktop 1600 × 900 px, 3 to 6)

Take them on the dev store with real-looking products, no test data like
"Test Mug". Suggested order and captions:

1. **Product page with the block** and a tier selected (price changes):
   "Show every tier and the savings on the product page"
2. **Campaign editor** (tiers + live preview): "Set up quantity breaks in
   minutes"
3. **Checkout** with the discount line: "Applied automatically at checkout"
4. **Widget settings** with the preview: "Match your store's brand"
5. **Subscription plan** editor: "Subscribe & save with any delivery
   frequency"
6. **My subscriptions** in the customer account: "Customers manage their own
   subscriptions"

Feature image (optional, 1600 × 900): the product page block on a clean
background with the app name.

## 11. Demo video / screencast (required for review)

2 to 4 minutes, English (or with English subtitles), screen recording on the
dev store:

1. Install the app from the install link and open it.
2. Create a campaign (products, 3 tiers), save, **Activate**.
3. Theme editor: add the **Quantity breaks** block to the product page.
4. Storefront: pick a tier (price updates), add to cart, show the discount at
   checkout.
5. Widget page: change text/colours, show it on the storefront.
6. Subscriptions: create a plan, buy with Subscribe & save (test payment).
7. Customer account → My subscriptions: skip, pause, resume, cancel.
8. Subscribers page in the app.
9. Billing: upgrade to Growth (test charge), then back to Free.

## 12. Testing instructions for the reviewer

```
1. Install BundleBoost and open it from Apps.
2. Campaigns → Create campaign: choose any product, keep the sample tiers, Save draft, then Activate.
3. Online Store → Themes → Customize → a product page → Add block → Apps → "Quantity breaks". Save.
4. On the storefront, open that product: the block lists the tiers; selecting one updates the price and quantity. Add to cart and go to checkout: the discount is applied automatically.
5. Subscriptions → Create plan: add the same product with "Every month, 10%". The product page then shows One-time purchase / Subscribe & save. Buy with Subscribe & save (Bogus Gateway, card 1).
6. Content → Menus → Customer account menu → add "My subscriptions". Sign in as that customer: skip, pause, resume, change frequency or cancel the subscription.
7. Subscribers (in the app) lists the subscription; renewals are charged automatically when due.
8. Billing: choose Growth to see the plan approval (test charge on development stores).
```

If the store is password protected, put the storefront password here too.

## 13. Support and contact (required)

- **Support email:** `info@byteoperator.com`
- **Privacy policy URL:** `https://bundle-boost-theta.vercel.app/privacy`
- **FAQ / documentation URL:** optional.
- **Emergency developer contact:** your name, email and phone (not public).

## 14. Data and privacy answers (protected customer data)

- **Data used:** customer name, email and shipping address, only for
  subscriptions (subscriber list, renewals, customer portal address change).
- **Why:** to run subscriptions and show merchants their subscribers.
- **Stored:** name, email, first order number, items and renewal history.
  Addresses and card details are not stored.
- **Retention:** deleted 48 hours after uninstall (shop/redact); a customer's
  details are erased on customers/redact.
- **Encryption / access:** database encrypted at rest (Neon), access limited to
  the developer.

---

## Before you submit: checklist

| | Item | Status |
| --- | --- | --- |
| ☐ | **Privacy policy page** (`/privacy`) | Built; live after the Vercel redeploy |
| ☐ | **Support email** `info@byteoperator.com` | Add `SUPPORT_EMAIL=info@byteoperator.com` in Vercel (landing page + privacy policy) |
| ☐ | Protected customer data approved: Name, Email, Address | Email isn't approved yet (Dev Dashboard → API access) |
| ☐ | App runs on Vercel with the production database | Check after clearing data |
| ☐ | Latest code on Vercel (redeploy) and released to Shopify (`npm run deploy`) | Redeploy needed |
| ☐ | Billing: plans approve on a development store (test charge) | Fixed in code, needs redeploy |
| ☐ | Screenshots (3–6) and demo video | To record |
| ☐ | Test the whole flow once on a fresh install | To do |
| ☐ | Remove test products/orders from screenshots | To do |
| ☐ | Open items from the App Store review: product page purchase options in the admin (5.4.6), variant-level plans (5.4.19), subscription confirmation email (5.4.9) | Decide before submitting |
