# SaleLoop: Shopify App Store listing

Copy each field into the Partner Dashboard / Dev Dashboard listing form
(Apps → SaleLoop → Distribution → App Store listing). Character counts are
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

## 1. App name

```
SaleLoop
```

Optional descriptor, if the form allows up to 30 characters:
`SaleLoop: Buy More & Repeat` (27). Don't use "Shopify", prices or claims
like "#1" in the name. Internal identifiers (the `bundleboost` plan tag,
metafield namespace, extension handles) stay as they are.

## 2. App icon

`branding/app-icon.png` (1200 × 1200 px). No text in the icon.

## 3. App card subtitle  `[59]`

```
Sell more per order with quantity breaks and repeat orders.
```

## 4. Search terms (up to 5)

```
volume discount
quantity discount
buy more save more
tiered pricing
subscriptions
```

## 5. App introduction  `[98]`

No `%`, "offer" or "subscribe" (Shopify's review tips flag them as
statistics or pricing).

```
Quantity breaks and recurring delivery plans. Customers buy more per order and come back for more.
```

## 6. App details  `[470]`

```
SaleLoop helps you sell more in every order and turn one-time buyers into repeat customers. Create quantity breaks on the products you choose, with a bigger discount for each extra item, as a percentage or a fixed amount. The tiers and savings show on your product page, and Shopify applies the discount at checkout with no code. You can also sell products on recurring delivery plans that renew automatically, and customers manage their own plans from their account.
```

## 7. Features (5, up to 80 characters each)

```
Quantity breaks with a percentage or fixed amount off each extra item
Discount applied automatically at checkout, with no code for customers
Product page block that shows every tier and the savings, matched to your brand
Recurring delivery plans with automatic renewals and failed payment retries
Customers skip, pause or cancel their own plans from their account
```

## Web search content

- **Title tag** `[46]`: `SaleLoop – Quantity Breaks & Subscriptions App`
- **Meta description** `[152]`: `Add quantity breaks and volume discounts to your store. Show the savings on product pages, apply them at checkout, and sell on recurring delivery plans.`

## Media

- **Feature image:** `branding/feature-media-1600x900.png`. Alt text:
  `SaleLoop quantity breaks block on a product page, showing three tiers, the discounted price and a monthly delivery plan.`
- **Screenshots:** `branding/screenshots/` (1600 × 900), with alt texts:
  1. `Product page block showing quantity tiers and savings`
  2. `Campaign editor with quantity tiers and a live preview`
  3. `Customer account page to skip, pause or cancel a subscription`

## 8. Categories and tags

From Shopify's category list (shopify.dev → App listing categories):

- **Primary:** Marketing and conversion → Promotions → **Discounts**
  ("Apps that let merchants offer discounts or special sales for products").
  Quantity breaks are discounts applied at checkout, so this is the main
  purpose.
- **Secondary:** Selling products → Payments → **Subscriptions**
  ("ongoing, automatic purchases of products"). Subscriptions are a full
  feature (plans, renewals, customer portal), not a small extra, so a
  secondary category is justified.
- **Structured features:** in each category, tick every feature the app
  really has (up to 25). These can be changed later without an appeal.

Alternatives if review disagrees: *Selling products → Pricing → Pricing
optimization*, or *Marketing and conversion → Upsell and bundles*.

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
1. Install SaleLoop and open it from Apps.
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
