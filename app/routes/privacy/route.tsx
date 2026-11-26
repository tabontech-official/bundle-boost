import { useLoaderData, type MetaFunction } from "react-router";
import { env } from "../../.server/env";
import styles from "../_index/styles.module.css";

export const loader = () => ({ supportEmail: env().SUPPORT_EMAIL ?? null });

export const meta: MetaFunction = () => [
  { title: "Privacy policy · BundleBoost" },
  { name: "description", content: "How BundleBoost collects, uses and deletes data for Shopify merchants and their customers." },
];

const UPDATED = "November 26, 2026";

/** Public privacy policy (linked from the App Store listing). */
export default function Privacy() {
  const { supportEmail } = useLoaderData<typeof loader>();
  const contact = supportEmail ? (
    <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
  ) : (
    "the support email on our Shopify App Store listing"
  );

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <a className={styles.brand} href="/">
          <img src="/bundleboost-icon.svg" alt="" width={36} height={36} />
          <span>BundleBoost</span>
        </a>
        <span className={styles.pill}>Privacy policy</span>
      </header>

      <main className={styles.prose}>
        <h1>Privacy policy</h1>
        <p className={styles.note}>Last updated {UPDATED}</p>

        <p>
          BundleBoost (&ldquo;the app&rdquo;, &ldquo;we&rdquo;) is a Shopify app by Tak ledger that adds quantity
          discounts and subscriptions to Shopify stores. This policy explains what data the app collects when a
          merchant installs it, how that data is used, and how it&rsquo;s deleted.
        </p>

        <h2>Information we collect</h2>
        <h3>From merchants</h3>
        <ul>
          <li>Store details from Shopify: store domain, name and currency.</li>
          <li>
            A Shopify access token for your store, so the app can manage its discounts, subscription plans and
            subscriptions on your behalf.
          </li>
          <li>What you set up in the app: campaigns, discount tiers, widget settings and subscription plans.</li>
          <li>
            An activity log of changes made in the app (for example &ldquo;campaign activated&rdquo;), with the Shopify
            staff ID that made them.
          </li>
          <li>Your BundleBoost plan and its status, from Shopify billing.</li>
        </ul>

        <h3>About your customers (subscriptions only)</h3>
        <p>When a customer buys on a BundleBoost subscription plan, the app stores:</p>
        <ul>
          <li>the customer&rsquo;s name and email address, and their Shopify customer ID;</li>
          <li>the first order number, the subscribed items, price and delivery frequency;</li>
          <li>renewal dates and the results of renewal charges (succeeded or failed).</li>
        </ul>
        <p>
          The app does <strong>not</strong> store card or payment details: payments are handled by Shopify. Delivery
          addresses are read from Shopify when a customer views or changes them in their account, and are not stored
          by the app. The product page block doesn&rsquo;t set cookies or track shoppers.
        </p>

        <h2>How we use it</h2>
        <ul>
          <li>To apply your quantity discounts at checkout and show them on your product pages.</li>
          <li>To create subscription plans, charge renewals when they&rsquo;re due and retry failed payments.</li>
          <li>To show you your subscribers, and let customers manage their own subscriptions in their account.</li>
          <li>To provide support and keep the app secure and working.</li>
        </ul>
        <p>We don&rsquo;t sell data, and we don&rsquo;t use it for advertising.</p>

        <h2>Sharing</h2>
        <p>Data is processed only by the services that run the app:</p>
        <ul>
          <li>Shopify, the platform the app runs on;</li>
          <li>Vercel, which hosts the app;</li>
          <li>Neon, which hosts the app&rsquo;s database (encrypted at rest).</li>
        </ul>
        <p>We disclose data otherwise only if required by law.</p>

        <h2>Retention and deletion</h2>
        <ul>
          <li>When you uninstall the app, its access to your store ends immediately.</li>
          <li>
            48 hours after uninstall, Shopify asks us to delete your store&rsquo;s data, and everything the app holds
            for your store is permanently deleted.
          </li>
          <li>
            When a customer asks your store to erase their data, Shopify tells the app and their details are removed
            from their subscriptions.
          </li>
          <li>When a customer asks for their data, Shopify tells the app and we provide what we hold.</li>
        </ul>

        <h2>Your rights</h2>
        <p>
          Merchants can ask us to access, correct or delete their data at any time. Customers of a store should
          contact that store, which can make the request through Shopify; we act on it as described above. Depending
          on where you live (for example under the GDPR or CCPA), you may have further rights, which we respect.
        </p>

        <h2>Security</h2>
        <p>
          Data is sent over HTTPS, stored in an encrypted database, and only the developer can access it. Requests
          from Shopify are verified before the app acts on them.
        </p>

        <h2>Changes</h2>
        <p>If this policy changes, we&rsquo;ll update this page and the date above.</p>

        <h2>Contact</h2>
        <p>Questions about privacy or your data: contact us at {contact}.</p>
      </main>

      <footer className={styles.footer}>
        <p>
          <a href="/">BundleBoost</a> · Privacy policy
        </p>
      </footer>
    </div>
  );
}
