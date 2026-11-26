import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, type ActionFunctionArgs, type HeadersFunction, type LoaderFunctionArgs } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { z } from "zod";
import { requireAdmin } from "../.server/context";
import { toActionFailure } from "../.server/errors";
import { readJsonBody } from "../.server/request";
import { changeContract, listContracts, MAX_FAILED_ATTEMPTS, runRenewals } from "../.server/services/subscription-contract.service";
import { on } from "../components/bool-attrs";
import { RouteError } from "../components/RouteError";
import { frequencyName } from "../lib/subscription-plans";

const numericId = (gid: string) => gid.slice(gid.lastIndexOf("/") + 1);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireAdmin(request);
  const contracts = await listContracts(shop.id);
  return {
    maxAttempts: MAX_FAILED_ATTEMPTS,
    contracts: contracts.map((c) => ({
      id: c.id,
      contractNumber: c.shopifyContractId.slice(c.shopifyContractId.lastIndexOf("/") + 1),
      status: c.status,
      customer: c.customerName || c.customerEmail || (c.customerGid ? `Customer ${c.customerGid.slice(c.customerGid.lastIndexOf("/") + 1)}` : "Customer"),
      email: c.customerName ? c.customerEmail : null,
      originOrder: c.originOrderName,
      // Links into the Shopify admin (App Store requirement for subscription apps).
      customerUrl: c.customerGid ? `shopify://admin/customers/${numericId(c.customerGid)}` : null,
      orderUrl: c.originOrderGid ? `shopify://admin/orders/${numericId(c.originOrderGid)}` : null,
      items: (c.lines as { title: string; variantTitle: string | null; quantity: number }[])
        .map((l) => `${l.quantity} × ${l.title}${l.variantTitle ? ` (${l.variantTitle})` : ""}`)
        .join(", "),
      amount: Number(c.amount),
      currencyCode: c.currencyCode,
      frequency: ["DAY", "WEEK", "MONTH", "YEAR"].includes(c.interval)
        ? frequencyName(c.interval as "DAY" | "WEEK" | "MONTH" | "YEAR", c.intervalCount).replace("Delivery every", "Every")
        : `${c.intervalCount} × ${c.interval.toLowerCase()}`,
      nextBillingDate: c.nextBillingDate?.toISOString() ?? null,
      failedAttempts: c.failedAttempts,
      nextRetryAt: c.nextRetryAt?.toISOString() ?? null,
      // A skipped order that's still ahead: shown as "skipped" with an undo.
      skippedDate: c.skippedCycleDate && c.skippedCycleDate > new Date() ? c.skippedCycleDate.toISOString() : null,
      lastAttempt: c.billingAttempts[0]
        ? { status: c.billingAttempts[0].status, error: c.billingAttempts[0].errorMessage ?? c.billingAttempts[0].errorCode }
        : null,
    })),
  };
};

const intentSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("change"), id: z.string().min(1), action: z.enum(["pause", "resume", "cancel", "skip", "unskip"]) }),
  z.object({ intent: z.literal("run") }),
]);

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, actorId } = await requireAdmin(request);
  try {
    const body = intentSchema.parse(await readJsonBody(request));
    if (body.intent === "run") {
      const r = await runRenewals(admin, shop.id);
      return {
        ok: true as const,
        message: r.charged + r.advanced + r.failed === 0
          ? "No renewals are due right now"
          : `Started ${r.charged} charge${r.charged === 1 ? "" : "s"}${r.failed ? `, ${r.failed} couldn’t start` : ""}`,
      };
    }
    await changeContract({ shopId: shop.id, actorId, admin }, body.id, body.action);
    const done = {
      pause: "Subscription paused",
      resume: "Subscription resumed",
      cancel: "Subscription cancelled",
      skip: "Order skipped",
      unskip: "Skip undone: the order is back on",
    };
    return { ok: true as const, message: done[body.action] };
  } catch (error) {
    return toActionFailure(error, { shop: shop.domain, route: "subscribers" });
  }
};

const money = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};
const day = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso)) : "—";

// Status badge per subscription status.
const STATUS: Record<string, { tone: "success" | "warning" | "critical" | "neutral"; label: string }> = {
  ACTIVE: { tone: "success", label: "Active" },
  PAUSED: { tone: "warning", label: "Paused" },
  CANCELLED: { tone: "neutral", label: "Cancelled" },
  EXPIRED: { tone: "neutral", label: "Expired" },
  FAILED: { tone: "critical", label: "Failed" },
};

type Row = ReturnType<typeof useLoaderData<typeof loader>>["contracts"][number];
type ConfirmAction = "skip" | "pause" | "cancel";
type Confirm = { row: Row; action: ConfirmAction; another: boolean };

const CONFIRM_MODAL = "bb-subscription-confirm";

/** Text of the confirmation modal for each action. */
function confirmCopy({ row, action, another }: Confirm) {
  const due = day(row.nextBillingDate);
  if (action === "skip") {
    return {
      heading: another ? "Skip another order?" : "Skip the next order?",
      body: `${row.customer}'s order due ${due} won't be charged or shipped. The next renewal moves to the following delivery. You can undo this until that date.`,
      cta: another ? "Skip another order" : "Skip order",
      critical: false,
    };
  }
  if (action === "pause") {
    return {
      heading: "Pause this subscription?",
      body: `No renewals are charged or shipped for ${row.customer} while it's paused. You can resume it at any time.`,
      cta: "Pause subscription",
      critical: false,
    };
  }
  return {
    heading: "Cancel this subscription?",
    body: `${row.customer} won't be charged or sent any more orders. This can't be undone; they'd need to subscribe again.`,
    cta: "Cancel subscription",
    critical: true,
  };
}

export default function Subscribers() {
  const { contracts, maxAttempts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message?: string }>();
  const shopify = useAppBridge();
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const busy = fetcher.state !== "idle";
  // Which action is running ("run", or "<action>:<id>"), so only its button spins.
  const sent = busy ? (fetcher.json as { intent?: string; id?: string; action?: string } | undefined) : undefined;
  const pending = sent ? (sent.intent === "run" ? "run" : `${sent.action}:${sent.id}`) : undefined;

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) {
      if (fetcher.data.message) shopify.toast.show(fetcher.data.message);
      // Close the confirmation only once the action has succeeded.
      shopify.modal.hide(CONFIRM_MODAL);
    } else if (confirm) {
      setConfirmError(fetcher.data.message ?? "Something went wrong. Try again.");
    } else {
      shopify.toast.show(fetcher.data.message ?? "Something went wrong", { isError: true });
    }
    // Only react to a finished request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const send = (body: Record<string, string>) => fetcher.submit(body, { method: "post", encType: "application/json" });
  const ask = (row: Row, action: ConfirmAction, another = false) => {
    setConfirm({ row, action, another });
    setConfirmError(null);
    shopify.modal.show(CONFIRM_MODAL);
  };
  const copy = confirm ? confirmCopy(confirm) : null;

  // Reset the dialog however it closes (button, Escape, dismiss). React 18
  // doesn't wire event props on custom elements, so listen directly.
  const modalRef = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    const reset = () => {
      setConfirm(null);
      setConfirmError(null);
    };
    modal.addEventListener("afterhide", reset);
    return () => modal.removeEventListener("afterhide", reset);
  }, []);

  const active = contracts.filter((c) => c.status === "ACTIVE").length;
  const retrying = contracts.filter((c) => c.status === "ACTIVE" && c.failedAttempts > 0).length;

  return (
    <s-page heading="Subscribers" inlineSize="large">
      <s-button
        slot="secondary-actions"
        {...on({ disabled: busy, loading: pending === "run" })}
        onClick={() => send({ intent: "run" })}
      >
        Charge due renewals now
      </s-button>
      <s-link slot="breadcrumb-actions" href="/app/subscriptions">
        Subscriptions
      </s-link>
      <div className="bb-wrap">
        <header className="bb-pagehead">
          <span className="bb-kicker">
            {active} active{retrying ? ` · ${retrying} retrying a payment` : ""}
          </span>
          <h1 className="bb-display">
            Your <em>subscribers</em>
          </h1>
          <p className="bb-lede">
            Everyone subscribed on your SaleLoop plans. Renewals are charged automatically when they’re due. A
            failed payment is retried after 1 and 3 days, and the subscription is paused after {maxAttempts} failed
            attempts.
          </p>
        </header>

        {contracts.length === 0 ? (
          <section className="bb-glass bb-editcard">
            <div className="bb-empty">
              <p>No subscribers yet. They appear here when someone checks out with a subscription plan.</p>
            </div>
          </section>
        ) : (
          <s-section padding="none" accessibilityLabel="Subscribers">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Customer</s-table-header>
                <s-table-header listSlot="labeled">Items</s-table-header>
                <s-table-header listSlot="labeled">Price</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header listSlot="labeled">Next renewal</s-table-header>
                <s-table-header>
                  <span className="bb-visually-hidden">Actions</span>
                </s-table-header>
              </s-table-header-row>
              <s-table-body>
                {contracts.map((c) => {
                  const status = STATUS[c.status] ?? { tone: "neutral" as const, label: c.status };
                  const retry = c.status === "ACTIVE" && c.failedAttempts > 0;
                  const menuId = `bb-subscription-menu-${c.id}`;
                  return (
                    <s-table-row key={c.id}>
                      <s-table-cell>
                        <s-stack gap="small-500">
                          {c.customerUrl ? (
                            <s-link href={c.customerUrl} target="_top">
                              {c.customer}
                            </s-link>
                          ) : (
                            <s-text type="strong">{c.customer}</s-text>
                          )}
                          <s-text color="subdued">
                            #{c.contractNumber}
                            {c.email ? ` · ${c.email}` : ""}
                          </s-text>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack gap="small-500">
                          <s-text>{c.items || "—"}</s-text>
                          {c.originOrder && (
                            <s-text color="subdued">
                              First order{" "}
                              {c.orderUrl ? (
                                <s-link href={c.orderUrl} target="_top">
                                  {c.originOrder}
                                </s-link>
                              ) : (
                                c.originOrder
                              )}
                            </s-text>
                          )}
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack gap="small-500">
                          <s-text>{money(c.amount, c.currencyCode)}</s-text>
                          <s-text color="subdued">{c.frequency}</s-text>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-badge tone={retry ? "warning" : status.tone}>{retry ? "Payment retrying" : status.label}</s-badge>
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack gap="small-500">
                          {c.status === "ACTIVE" ? (
                            <>
                              <s-text>{retry ? `Retry ${day(c.nextRetryAt)}` : day(c.nextBillingDate)}</s-text>
                              {c.skippedDate && (
                                <s-badge tone="success" icon="check">
                                  {`Skipped ${day(c.skippedDate)}`}
                                </s-badge>
                              )}
                              {retry && <s-text color="subdued">{`Failed ${c.failedAttempts} of ${maxAttempts}`}</s-text>}
                            </>
                          ) : (
                            <s-text color="subdued">—</s-text>
                          )}
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        {c.status !== "CANCELLED" && c.status !== "EXPIRED" && (
                          <>
                            <s-button
                              variant="tertiary"
                              icon="menu-horizontal"
                              accessibilityLabel={`Actions for ${c.customer}`}
                              commandFor={menuId}
                              {...on({ disabled: busy && !pending?.endsWith(`:${c.id}`), loading: Boolean(pending?.endsWith(`:${c.id}`)) })}
                            />
                            <s-menu id={menuId} accessibilityLabel={`Actions for ${c.customer}`}>
                              {c.status === "ACTIVE" &&
                                (c.skippedDate ? (
                                  <>
                                    <s-button icon="undo" onClick={() => send({ intent: "change", id: c.id, action: "unskip" })}>
                                      Undo skip
                                    </s-button>
                                    <s-button icon="arrow-right" onClick={() => ask(c, "skip", true)}>
                                      Skip another order
                                    </s-button>
                                  </>
                                ) : (
                                  <s-button icon="arrow-right" onClick={() => ask(c, "skip")}>
                                    Skip next order
                                  </s-button>
                                ))}
                              {c.status === "ACTIVE" && (
                                <s-button icon="pause-circle" onClick={() => ask(c, "pause")}>
                                  Pause
                                </s-button>
                              )}
                              {(c.status === "PAUSED" || c.status === "FAILED") && (
                                <s-button icon="play" onClick={() => send({ intent: "change", id: c.id, action: "resume" })}>
                                  Resume
                                </s-button>
                              )}
                              <s-button icon="delete" tone="critical" onClick={() => ask(c, "cancel")}>
                                Cancel subscription
                              </s-button>
                            </s-menu>
                          </>
                        )}
                      </s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          </s-section>
        )}
      </div>

      <s-modal ref={modalRef} id={CONFIRM_MODAL} heading={copy?.heading ?? "Confirm"}>
        <s-stack gap="base">
          <s-paragraph>{copy?.body}</s-paragraph>
          {confirmError && (
            <s-banner tone="critical" heading="That didn't work">
              {confirmError}
            </s-banner>
          )}
        </s-stack>
        <s-button
          slot="primary-action"
          variant="primary"
          {...(copy?.critical ? { tone: "critical" as const } : {})}
          {...on({ loading: busy && Boolean(confirm) })}
          onClick={() => confirm && send({ intent: "change", id: confirm.row.id, action: confirm.action })}
        >
          {copy?.cta ?? "Confirm"}
        </s-button>
        <s-button slot="secondary-actions" commandFor={CONFIRM_MODAL} command="--hide" {...on({ disabled: busy })}>
          Keep it
        </s-button>
      </s-modal>
    </s-page>
  );
}

export const ErrorBoundary = RouteError;

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
