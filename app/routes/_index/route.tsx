import { redirect, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { env } from "../../.server/env";
import { PLAN_FOOTNOTES, PLAN_ORDER, PLANS } from "../../lib/plans";
import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { supportEmail: env().SUPPORT_EMAIL ?? null };
};

export const meta: MetaFunction = () => [
  { title: "SaleLoop: quantity breaks, volume discounts and subscriptions for Shopify" },
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
    body: "Place the SaleLoop block on your product page in the theme editor. No code needed.",
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
  const { supportEmail } = useLoaderData<typeof loader>();
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <a className={styles.brand} href="/">
          <img src="/bundleboost-icon.svg" alt="" width={36} height={36} />
          <span>SaleLoop</span>
        </a>
        <span className={styles.pill}>Shopify app</span>
      </header>

      <main>
        <section className={styles.hero}>
          <div className={styles.heroText}>
            <span className={styles.kicker}>Quantity breaks · Volume discounts · Subscriptions</span>
            <h1>
              Sell more per order with <em>quantity breaks</em> and subscriptions
            </h1>
            <p className={styles.lede}>
              SaleLoop rewards customers for buying more. Offer &ldquo;buy more, save more&rdquo; tiers on the
              products you choose, show the savings right on the product page, and let customers subscribe for
              repeat deliveries.
            </p>
            <p className={styles.howToOpen}>
              <span className={styles.dot} aria-hidden="true" />
              <span>
                Install SaleLoop from the Shopify App Store. Already installed? Open it from your Shopify admin
                under <strong>Apps → SaleLoop</strong>.
              </span>
            </p>
          </div>

          <figure className={styles.example} aria-label="Example of the SaleLoop block on a product page">
            <div className={styles.exampleHead}>
              <p className={styles.exampleHeading}>Buy more, save more</p>
              <span className={styles.exampleTag}>On your product page</span>
            </div>
            <ul>
              {EXAMPLE_TIERS.map((t) => (
                <li key={t.qty} className={t.best ? styles.tierBest : undefined}>
                  {t.best && <span className={styles.badge}>Best deal</span>}
                  <strong>Buy {t.qty}+</strong>
                  <span className={styles.each}>{t.each} each</span>
                  <span className={styles.save}>{t.save}</span>
                </li>
              ))}
            </ul>
            <div className={styles.exampleTotal}>
              <span>5 items at checkout</span>
              <strong>
                <s>$75.00</s>$60.00
              </strong>
            </div>
            <figcaption>Example: a $15 product with three tiers.</figcaption>
          </figure>
        </section>

        <section className={styles.section} aria-labelledby="what">
          <div className={styles.sectionHead}>
            <span className={styles.kicker}>What it does</span>
            <h2 id="what">
              Customers buy more <em>when they save more</em>
            </h2>
          </div>
          <ul className={styles.features}>
            {FEATURES.map((f, i) => (
              <li key={f.title}>
                <span className={styles.featureNum}>{String(i + 1).padStart(2, "0")}</span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="how">
          <div className={styles.sectionHead}>
            <span className={styles.kicker}>How it works</span>
            <h2 id="how">
              Live in <em>three steps</em>
            </h2>
          </div>
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
          <div className={styles.sectionHead}>
            <span className={styles.kicker}>Pricing</span>
            <h2 id="plans">
              Start free, <em>upgrade as you grow</em>
            </h2>
          </div>
          <ul className={styles.plans}>
            {PLAN_ORDER.map((handle) => {
              const plan = PLANS[handle];
              return (
                <li key={handle} className={handle === "growth" ? styles.planFeatured : undefined}>
                  <div className={styles.planHead}>
                    <h3>{plan.name}</h3>
                    {handle === "growth" && <span className={styles.planBadge}>Recommended</span>}
                  </div>
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
          {PLAN_FOOTNOTES.map((note) => (
            <p key={note} className={styles.note}>
              {note}
            </p>
          ))}
        </section>
      </main>

      <footer className={styles.footer}>
        <p>
          SaleLoop works inside your Shopify admin. Discounts run in Shopify checkout, and card details stay with
          Shopify.
        </p>
        <p className={styles.footerLinks}>
          <a href="/privacy">Privacy policy</a>
          {supportEmail && (
            <>
              {" · "}
              <a href={`mailto:${supportEmail}`}>Support: {supportEmail}</a>
            </>
          )}
        </p>
      </footer>
    </div>
  );
}
