import { Link, useLoaderData, type HeadersFunction, type LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { requireAdmin } from "../.server/context";
import { listSubscriptionPlans } from "../.server/services/subscription-plan.service";
import { RouteError } from "../components/RouteError";
import { frequencyName } from "../lib/subscription-plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  const plans = await listSubscriptionPlans(shop.id);
  return {
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      syncStatus: p.syncStatus,
      syncError: p.syncError,
      products: p.products.map((product) => product.title),
      updatedAt: p.updatedAt.toISOString(),
      frequencies: p.frequencies.map((f) => ({
        name: f.label || frequencyName(f.interval, f.intervalCount),
        discount: Number(f.discountPercent),
      })),
    })),
  };
};

const SYNC_STATUS: Record<string, { tone: "success" | "critical" | "info"; label: string }> = {
  SYNCED: { tone: "success", label: "Live on Shopify" },
  ERROR: { tone: "critical", label: "Not saved to Shopify" },
  NOT_SYNCED: { tone: "info", label: "Saving" },
};

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export default function SubscriptionPlans() {
  const { plans } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Subscriptions" inlineSize="large">
      <s-button slot="primary-action" variant="primary" href="/app/subscriptions/new">
        Create plan
      </s-button>
      <s-button slot="secondary-actions" href="/app/subscribers">
        Subscribers
      </s-button>
      <div className="bb-wrap">
        <header className="bb-pagehead">
          <span className="bb-kicker">Subscribe & save</span>
          <h1 className="bb-display">
            Sell on <em>repeat</em>
          </h1>
          <p className="bb-lede">
            Create subscription plans with any delivery frequency (weekly, monthly, quarterly or your own) and a
            discount for each. Shoppers choose them in the SaleLoop widget.
          </p>
        </header>

        {plans.length === 0 ? (
          <section className="bb-glass bb-editcard">
            <div className="bb-empty">
              <p>No subscription plans yet.</p>
              <Link className="bb-btn bb-btn--dark" to="/app/subscriptions/new">
                Create your first plan
              </Link>
            </div>
          </section>
        ) : (
          <s-section padding="none" accessibilityLabel="Subscription plans">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Plan</s-table-header>
                <s-table-header listSlot="labeled">Delivery frequencies</s-table-header>
                <s-table-header listSlot="labeled">Products</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header listSlot="labeled">Last updated</s-table-header>
                <s-table-header>
                  <span className="bb-visually-hidden">Actions</span>
                </s-table-header>
              </s-table-header-row>
              <s-table-body>
                {plans.map((p) => {
                  const status = SYNC_STATUS[p.syncStatus] ?? SYNC_STATUS.NOT_SYNCED;
                  return (
                    <s-table-row key={p.id}>
                      <s-table-cell>
                        <s-stack gap="small-500">
                          <s-link href={`/app/subscriptions/${p.id}`}>{p.name}</s-link>
                          <s-text color="subdued">
                            {p.frequencies.length} {p.frequencies.length === 1 ? "frequency" : "frequencies"}
                          </s-text>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack gap="small-500">
                          {p.frequencies.map((f) => (
                            <s-text key={f.name}>
                              {f.name}
                              {f.discount > 0 && <s-text color="subdued">{` · ${f.discount}% off`}</s-text>}
                            </s-text>
                          ))}
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack gap="small-500">
                          <s-text>{p.products[0] ?? "—"}</s-text>
                          {p.products.length > 1 && <s-text color="subdued">{`+ ${p.products.length - 1} more`}</s-text>}
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack gap="small-500">
                          <s-badge tone={status.tone}>{status.label}</s-badge>
                          {p.syncStatus === "ERROR" && p.syncError && <s-text color="subdued">{p.syncError}</s-text>}
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-text>{day(p.updatedAt)}</s-text>
                      </s-table-cell>
                      <s-table-cell>
                        <s-button variant="tertiary" href={`/app/subscriptions/${p.id}`} accessibilityLabel={`Edit ${p.name}`}>
                          Edit
                        </s-button>
                      </s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          </s-section>
        )}
      </div>
    </s-page>
  );
}

export const ErrorBoundary = RouteError;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
