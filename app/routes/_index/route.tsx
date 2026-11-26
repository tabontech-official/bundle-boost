import { redirect, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { PLAN_ORDER, PLANS } from "../../lib/plans";
import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export const meta: MetaFunction = () => [
  { title: "BundleBoost: quantity breaks, volume discounts and subscriptions for Shopify" },
  {
    name: "description",
    content:
      "Reward customers for buying more with automatic quantity discounts, show the deal on your product pages, and sell on subscription with Subscribe & save.",
  },
];

const FEATURES = [
  {
    title: "Quantity breaks at checkout",
    body: "Set tiers like Buy 2, save 10% and Buy 5, save 20%, as a percentage or a fixed amount off each item. The discount is applied automatically in Shopify checkout. No codes for customers to remember.",
  },
  {
    title: "A deal block on the product page",
    body: "Shoppers see every tier, the price per item and what they save, and pick a quantity with one tap. The product price updates to match. Match it to your brand with your own text and colours.",
  },
  {
    title: "Subscribe & save",
    body: "Create subscription plans with any delivery frequency and a discount for each. Renewals are charged automatically, and failed payments are retried before a subscription is paused.",
  },
  {
    title: "Customers manage their own subscriptions",
    body: "From their Shopify customer account, customers can skip a delivery, pause, resume, cancel, change how often it arrives, update their address or payment method, and see their orders.",
  },
];

const STEPS = [
  {
    title: "Create a campaign",
    body: "Choose products or variants and add your quantity tiers.",
  },
  {
    title: "Add the block to your theme",
    body: "Place the BundleBoost block on your product page in the theme editor. No code needed.",
  },
  {
    title: "Watch order values grow",
    body: "Customers see the savings, add more to their cart, and get the discount at checkout.",
  },
];

const EXAMPLE_TIERS = [
  { qty: 2, each: "$13.50", save: "Save 10%" },
  { qty: 3, each: "$12.75", save: "Save 15%" },
  { qty: 5, each: "$12.00", save: "Save 20%", best: true },
];

/**
 * Public landing page at the app's URL. Merchants install and open the app
 * from Shopify only, so there's no shop-domain login form here.
 */
export default function Landing() {
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <div className={styles.brand}>
          <img src="/bundleboost-icon.svg" alt="" width={36} height={36} />
          <span>BundleBoost</span>
        </div>
        <span className={styles.pill}>Shopify app</span>
      </header>

      <main>
        <section className={styles.hero}>
          <div className={styles.heroText}>
            <h1>Sell more per order with quantity discounts and subscriptions</h1>
            <p className={styles.lede}>
              BundleBoost rewards customers for buying more. Offer &ldquo;buy more, save more&rdquo; tiers on the
              products you choose, show the savings right on the product page, and let customers subscribe for
              repeat deliveries.
            </p>
            <p className={styles.howToOpen}>
              Install BundleBoost from the Shopify App Store. Already installed? Open it from your Shopify admin
              under <strong>Apps → BundleBoost</strong>.
            </p>
          </div>

          <figure className={styles.example} aria-label="Example of the BundleBoost block on a product page">
            <p className={styles.exampleHeading}>Buy more, save more</p>
            <ul>
              {EXAMPLE_TIERS.map((t) => (
                <li key={t.qty} className={t.best ? styles.tierBest : undefined}>
                  {t.best && <span className={styles.badge}>Best deal</span>}
                  <strong>Buy {t.qty}+</strong>
                  <span>{t.each} each</span>
                  <span className={styles.save}>{t.save}</span>
                </li>
              ))}
            </ul>
            <figcaption>Example: a $15 product with three tiers.</figcaption>
          </figure>
        </section>

        <section className={styles.section} aria-labelledby="what">
          <h2 id="what">What BundleBoost does</h2>
          <ul className={styles.features}>
            {FEATURES.map((f) => (
              <li key={f.title}>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="how">
          <h2 id="how">How it works</h2>
          <ol className={styles.steps}>
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className={styles.stepNum}>{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.section} aria-labelledby="plans">
          <h2 id="plans">Plans</h2>
          <ul className={styles.plans}>
            {PLAN_ORDER.map((handle) => {
              const plan = PLANS[handle];
              return (
                <li key={handle}>
                  <h3>{plan.name}</h3>
                  <p className={styles.price}>
                    {plan.price === 0 ? "Free" : `$${plan.price.toFixed(2)}`}
                    {plan.price > 0 && <span> / month</span>}
                  </p>
                  <p className={styles.tagline}>{plan.tagline}</p>
                  <ul>
                    {plan.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
          <p className={styles.note}>Prices in USD, billed through Shopify.</p>
        </section>
      </main>

      <footer className={styles.footer}>
        <p>
          BundleBoost works inside your Shopify admin. Discounts run in Shopify checkout, and card details stay with
          Shopify.
        </p>
      </footer>
    </div>
  );
}
