import type { AdminGraphqlClient } from "../../app/.server/shopify/graphql";

/**
 * Test double for the Admin GraphQL client, standing in for a store's
 * catalogue. Only used by the test suite — production code always talks to
 * Shopify through the authenticated library client.
 */
export type FakeProduct = {
  id: string;
  title: string;
  variants: { id: string; title: string }[];
};

export function productGid(n: number) {
  return `gid://shopify/Product/${n}`;
}
export function variantGid(n: number) {
  return `gid://shopify/ProductVariant/${n}`;
}

export function fakeProduct(n: number, variantCount = 2): FakeProduct {
  return {
    id: productGid(n),
    title: `Product ${n}`,
    variants: Array.from({ length: variantCount }, (_, i) => ({
      id: variantGid(n * 100 + i + 1),
      title: `Variant ${i + 1}`,
    })),
  };
}

export type FakeDiscount = {
  id: string;
  title: string;
  status: "ACTIVE" | "EXPIRED" | "SCHEDULED";
  startsAt: string;
  endsAt: string | null;
  combinesWith: Record<string, boolean>;
  appliesOnOneTimePurchase?: boolean;
  appliesOnSubscription?: boolean;
  recurringCycleLimit?: number;
  functionHandle: string;
  discountClasses: string[];
  config: string;
};

/**
 * Stateful stand-in for the store: catalogue lookups plus automatic app
 * discounts and app metafields, so sync logic can be exercised end to end.
 * `failNext` makes the next matching operation return a userError.
 */
export function createAdminDouble(catalog: FakeProduct[]) {
  const calls: { query: string; variables?: Record<string, unknown>; apiVersion?: string }[] = [];
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const discounts = new Map<string, FakeDiscount>();
  const appMetafields = new Map<string, string>();
  // Selling plan groups: id -> { name, plans (option -> id + input), products }
  const sellingPlanGroups = new Map<
    string,
    { name: string; plans: Map<string, { id: string; input: Record<string, unknown> }>; products: Set<string> }
  >();
  let nextSellingPlan = 5000;
  // Subscription contracts: cycle i (from 1) is due at firstDue + (i-1) * periodDays.
  type FakeContract = {
    id: string;
    status: string;
    firstDue: Date;
    periodDays: number;
    billed: Set<number>;
    skipped: Set<number>;
    customer: { id: string; displayName: string; email: string } | null;
    charges: number[];
    // Customer portal: the plan (frequency) the lines are on, and the line price.
    sellingPlanId: string | null;
    interval: string;
    intervalCount: number;
    linePrice: string;
    paymentUpdateEmails: number;
  };
  const contracts = new Map<string, FakeContract>();
  let nextAttempt = 9000;
  const DAY = 24 * 60 * 60 * 1000;
  const cycleDate = (c: FakeContract, index: number) => new Date(c.firstDue.getTime() + (index - 1) * c.periodDays * DAY);
  const cycleIndexOf = (c: FakeContract, selector: { index?: number; date?: string }) =>
    selector.index ?? Math.max(1, Math.floor((new Date(selector.date!).getTime() - c.firstDue.getTime()) / (c.periodDays * DAY)) + 1);
  const cycleNode = (c: FakeContract, index: number) => ({
    cycleIndex: index,
    billingAttemptExpectedDate: cycleDate(c, index).toISOString(),
    skipped: c.skipped.has(index),
    status: c.billed.has(index) ? "BILLED" : "UNBILLED",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingCalculations = new Map<string, { contractId: string; input: any }>();
  let nextCalculation = 0;
  const nextDue = (c: FakeContract) => [...Array(500).keys()].map((i) => i + 1).find((i) => !c.billed.has(i) && !c.skipped.has(i)) ?? 1;
  const portalNode = (c: FakeContract) => ({
    id: c.id,
    status: c.status,
    createdAt: "2026-11-01T00:00:00Z",
    nextBillingDate: cycleDate(c, nextDue(c)).toISOString(),
    currencyCode: "USD",
    customer: c.customer && { id: c.customer.id },
    billingPolicy: { interval: c.interval, intervalCount: c.intervalCount },
    deliveryPrice: { amount: "4.99" },
    lines: {
      nodes: [
        {
          id: `${c.id}/line/1`,
          title: "Coffee beans",
          variantTitle: "1 kg",
          quantity: 2,
          sellingPlanId: c.sellingPlanId,
          sellingPlanName: null,
          currentPrice: { amount: c.linePrice },
          variantImage: null,
        },
      ],
    },
    customerPaymentMethod: {
      id: `${c.id}/payment`,
      instrument: { __typename: "CustomerCreditCard", brand: "Visa", lastDigits: "4242", expiryMonth: 4, expiryYear: 2029 },
    },
    orders: { nodes: [{ id: "gid://shopify/Order/1001", name: "#1001", createdAt: "2026-11-01T00:00:00Z", displayFulfillmentStatus: "FULFILLED", totalPriceSet: { shopMoney: { amount: "22.99", currencyCode: "USD" } } }] },
  });
  const failures: { operation: string; message: string }[] = [];
  let nextDiscount = 1000;
  let activeSubs: { id: string; name: string; status: string; test: boolean; trialDays: number; currentPeriodEnd: string | null }[] = [];

  const userError = (message: string, field = ["base"]) => ({ field, message, code: null });
  const takeFailure = (operation: string) => {
    const i = failures.findIndex((f) => f.operation === operation);
    return i === -1 ? null : failures.splice(i, 1)[0];
  };

  const client: AdminGraphqlClient = {
    async graphql(query, options) {
      calls.push({ query, variables: options?.variables, apiVersion: options?.apiVersion });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v = (options?.variables ?? {}) as Record<string, any>;
      const op = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "";
      const failure = takeFailure(op);
      if (failure?.message === "NETWORK") throw new Error("socket hang up");

      if (op === "BundleBoostDiscountCreate") {
        if (failure) return Response.json({ data: { discountAutomaticAppCreate: { automaticAppDiscount: null, userErrors: [userError(failure.message)] } } });
        if ([...discounts.values()].some((other) => other.title === v.discount.title)) {
          return Response.json({ data: { discountAutomaticAppCreate: { automaticAppDiscount: null, userErrors: [userError("Title must be unique for automatic discount.", ["automaticAppDiscount", "title"])] } } });
        }
        const id = `gid://shopify/DiscountAutomaticNode/${nextDiscount++}`;
        const d = v.discount;
        discounts.set(id, {
          id,
          title: d.title,
          status: "ACTIVE",
          startsAt: d.startsAt,
          endsAt: d.endsAt,
          combinesWith: d.combinesWith,
          appliesOnOneTimePurchase: d.appliesOnOneTimePurchase,
          appliesOnSubscription: d.appliesOnSubscription,
          recurringCycleLimit: d.recurringCycleLimit,
          functionHandle: d.functionHandle,
          discountClasses: d.discountClasses,
          config: d.metafields?.[0]?.value,
        });
        return Response.json({ data: { discountAutomaticAppCreate: { automaticAppDiscount: { discountId: id, status: "ACTIVE" }, userErrors: [] } } });
      }
      if (op === "BundleBoostDiscountUpdate") {
        const existing = discounts.get(v.id);
        if (!existing || failure) {
          return Response.json({ data: { discountAutomaticAppUpdate: { automaticAppDiscount: null, userErrors: [existing ? userError(failure!.message) : userError("Discount does not exist", ["id"])] } } });
        }
        if ([...discounts.values()].some((other) => other.id !== existing.id && other.title === v.discount.title)) {
          return Response.json({ data: { discountAutomaticAppUpdate: { automaticAppDiscount: null, userErrors: [userError("Title must be unique for automatic discount.", ["automaticAppDiscount", "title"])] } } });
        }
        Object.assign(existing, {
          title: v.discount.title,
          startsAt: v.discount.startsAt,
          endsAt: v.discount.endsAt,
          combinesWith: v.discount.combinesWith,
          appliesOnOneTimePurchase: v.discount.appliesOnOneTimePurchase,
          appliesOnSubscription: v.discount.appliesOnSubscription,
          recurringCycleLimit: v.discount.recurringCycleLimit,
        });
        return Response.json({ data: { discountAutomaticAppUpdate: { automaticAppDiscount: { discountId: existing.id, status: existing.status }, userErrors: [] } } });
      }
      if (op === "BundleBoostDiscountActivate" || op === "BundleBoostDiscountDeactivate") {
        const key = op === "BundleBoostDiscountActivate" ? "discountAutomaticActivate" : "discountAutomaticDeactivate";
        const existing = discounts.get(v.id);
        if (!existing) return Response.json({ data: { [key]: { automaticDiscountNode: null, userErrors: [userError("Discount does not exist", ["id"])] } } });
        existing.status = op === "BundleBoostDiscountActivate" ? "ACTIVE" : "EXPIRED";
        return Response.json({ data: { [key]: { automaticDiscountNode: { id: existing.id }, userErrors: [] } } });
      }
      if (op === "BundleBoostDiscountDelete") {
        if (!discounts.delete(v.id)) {
          return Response.json({ data: { discountAutomaticDelete: { deletedAutomaticDiscountId: null, userErrors: [userError("Discount does not exist", ["id"])] } } });
        }
        return Response.json({ data: { discountAutomaticDelete: { deletedAutomaticDiscountId: v.id, userErrors: [] } } });
      }
      if (op === "BundleBoostMetafieldsSet") {
        if (failure) return Response.json({ data: { metafieldsSet: { metafields: [], userErrors: [userError(failure.message)] } } });
        for (const m of v.metafields as { ownerId: string; namespace: string; key: string; value: string }[]) {
          const discount = discounts.get(m.ownerId);
          if (discount) discount.config = m.value;
          else appMetafields.set(`${m.namespace}.${m.key}`, m.value);
        }
        return Response.json({ data: { metafieldsSet: { metafields: [], userErrors: [] } } });
      }
      if (op === "BundleBoostSellingPlanGroupState") {
        const g = sellingPlanGroups.get(v.id);
        return Response.json({
          data: {
            sellingPlanGroup: g && {
              id: v.id,
              products: { nodes: [...g.products].map((id) => ({ id })) },
              sellingPlans: { nodes: [...g.plans.entries()].map(([option, p]) => ({ id: p.id, options: [option] })) },
            },
          },
        });
      }
      if (op.startsWith("BundleBoostSellingPlanGroup")) {
        const key = op.replace("BundleBoost", "").replace(/^./, (c) => c.toLowerCase());
        if (failure) return Response.json({ data: { [key]: { sellingPlanGroup: null, userErrors: [userError(failure.message)] } } });
        const groupPayload = (id: string) => {
          const g = sellingPlanGroups.get(id)!;
          return {
            id,
            sellingPlans: { nodes: [...g.plans.entries()].map(([option, p]) => ({ id: p.id, options: [option] })) },
          };
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const addPlans = (g: { plans: Map<string, any> }, plans: any[] = []) => {
          for (const plan of plans) {
            const id = plan.id ?? `gid://shopify/SellingPlan/${nextSellingPlan++}`;
            for (const [opt, existing] of g.plans) if (existing.id === id) g.plans.delete(opt);
            g.plans.set(plan.options[0], { id, input: plan });
          }
        };
        if (op === "BundleBoostSellingPlanGroupCreate") {
          const id = `gid://shopify/SellingPlanGroup/${nextSellingPlan++}`;
          const g = { name: v.input.name, plans: new Map(), products: new Set<string>(v.resources?.productIds ?? []) };
          sellingPlanGroups.set(id, g);
          addPlans(g, v.input.sellingPlansToCreate);
          return Response.json({ data: { sellingPlanGroupCreate: { sellingPlanGroup: groupPayload(id), userErrors: [] } } });
        }
        const g = sellingPlanGroups.get(v.id);
        if (!g) return Response.json({ data: { [key]: { sellingPlanGroup: null, userErrors: [userError("Selling plan group does not exist", ["id"])] } } });
        if (op === "BundleBoostSellingPlanGroupUpdate") {
          g.name = v.input.name;
          for (const [opt, p] of [...g.plans]) if ((v.input.sellingPlansToDelete ?? []).includes(p.id)) g.plans.delete(opt);
          addPlans(g, v.input.sellingPlansToUpdate);
          addPlans(g, v.input.sellingPlansToCreate);
          return Response.json({ data: { sellingPlanGroupUpdate: { sellingPlanGroup: groupPayload(v.id), userErrors: [] } } });
        }
        if (op === "BundleBoostSellingPlanGroupAddProducts") {
          if (v.productIds.some((id: string) => g.products.has(id))) {
            return Response.json({ data: { sellingPlanGroupAddProducts: { sellingPlanGroup: null, userErrors: [userError("Resource has already been taken")] } } });
          }
          for (const id of v.productIds) g.products.add(id);
          return Response.json({ data: { sellingPlanGroupAddProducts: { sellingPlanGroup: { id: v.id }, userErrors: [] } } });
        }
        if (op === "BundleBoostSellingPlanGroupRemoveProducts") {
          for (const id of v.productIds) g.products.delete(id);
          return Response.json({ data: { sellingPlanGroupRemoveProducts: { removedProductIds: v.productIds, userErrors: [] } } });
        }
        if (op === "BundleBoostSellingPlanGroupDelete") {
          sellingPlanGroups.delete(v.id);
          return Response.json({ data: { sellingPlanGroupDelete: { deletedSellingPlanGroupId: v.id, userErrors: [] } } });
        }
      }
      if (failure && op.startsWith("BundleBoostSubscriptionContract")) {
        return Response.json({ errors: [{ message: failure.message }] });
      }
      if (
        op === "BundleBoostSubscriptionContract" ||
        op === "BundleBoostSubscriptionContractNoEmail" ||
        op === "BundleBoostSubscriptionContractMinimal"
      ) {
        const c = contracts.get(v.id);
        if (!c) return Response.json({ data: { subscriptionContract: null } });
        const next = [...Array(500).keys()].map((i) => i + 1).find((i) => !c.billed.has(i) && !c.skipped.has(i)) ?? 1;
        return Response.json({
          data: {
            subscriptionContract: {
              id: c.id,
              status: c.status,
              nextBillingDate: cycleDate(c, next).toISOString(),
              currencyCode: "USD",
              billingPolicy: { interval: c.interval, intervalCount: c.intervalCount },
              lines: { nodes: [{ title: "Coffee beans", variantTitle: "1 kg", quantity: 2, currentPrice: { amount: c.linePrice } }] },
              ...(op !== "BundleBoostSubscriptionContractMinimal"
                ? {
                    customer: c.customer && {
                      id: c.customer.id,
                      displayName: c.customer.displayName,
                      ...(op === "BundleBoostSubscriptionContract"
                        ? { defaultEmailAddress: { emailAddress: c.customer.email } }
                        : {}),
                    },
                    originOrder: { name: "#1001" },
                  }
                : {}),
            },
          },
        });
      }
      if (op === "BundleBoostPortalContracts") {
        const nodes = [...contracts.values()].filter((c) => c.customer?.id === v.customerId).map(portalNode);
        return Response.json({ data: { customer: { subscriptionContracts: { nodes } } } });
      }
      if (op === "BundleBoostPortalContract") {
        const c = contracts.get(v.id);
        return Response.json({ data: { subscriptionContract: c ? portalNode(c) : null } });
      }
      if (op === "BundleBoostPortalContractLines") {
        const c = contracts.get(v.id);
        return Response.json({
          data: {
            subscriptionContract: c && {
              id: c.id,
              currencyCode: "USD",
              lines: {
                nodes: [
                  {
                    id: `${c.id}/line/1`,
                    quantity: 2,
                    variantId: "gid://shopify/ProductVariant/11",
                    sellingPlanId: c.sellingPlanId,
                    customAttributes: [{ key: "gift", value: "no" }],
                    currentPrice: { amount: c.linePrice },
                    pricingPolicy: { basePrice: { amount: "10.00" } },
                  },
                ],
              },
            },
          },
        });
      }
      if (op === "BundleBoostPortalUpdateCalculate") {
        const c = contracts.get(v.contractId);
        if (!c || failure) {
          return Response.json({
            data: { subscriptionContractUpdateCalculate: { subscriptionContractCalculation: null, userErrors: [userError(failure?.message ?? "Contract not found")] } },
          });
        }
        pendingCalculations.set(`gid://shopify/SubscriptionContractCalculation/${++nextCalculation}`, { contractId: c.id, input: v.input });
        return Response.json({
          data: {
            subscriptionContractUpdateCalculate: {
              subscriptionContractCalculation: { id: `gid://shopify/SubscriptionContractCalculation/${nextCalculation}` },
              userErrors: [],
            },
          },
        });
      }
      if (op === "BundleBoostPortalCalculation") {
        const known = pendingCalculations.has(v.id);
        return Response.json({
          data: { subscriptionContractCalculation: known ? { __typename: "SubscriptionContractCalculationSuccess", id: v.id } : null },
        });
      }
      if (op === "BundleBoostPortalCalculationCommit") {
        const calc = pendingCalculations.get(v.id);
        const c = calc && contracts.get(calc.contractId);
        if (!calc || !c) return Response.json({ data: { subscriptionContractCalculationCommit: { contract: null, userErrors: [userError("Not found")] } } });
        const line = calc.input.lines[0].productVariantLine;
        c.sellingPlanId = line.originSellingPlanId;
        c.interval = calc.input.billingPolicy.cadence.unit;
        c.intervalCount = calc.input.billingPolicy.cadence.count;
        c.linePrice = line.priceOverride.amount;
        pendingCalculations.delete(v.id);
        return Response.json({ data: { subscriptionContractCalculationCommit: { contract: { id: c.id, nextBillingDate: null }, userErrors: [] } } });
      }
      if (op === "BundleBoostPortalPaymentUpdateEmail") {
        const c = [...contracts.values()].find((x) => `${x.id}/payment` === v.id);
        if (c) c.paymentUpdateEmails += 1;
        return Response.json({
          data: { customerPaymentMethodSendUpdateEmail: { customer: c ? { id: c.customer?.id } : null, userErrors: c ? [] : [userError("Not found")] } },
        });
      }
      if (op === "BundleBoostBillingCycleUnskip") {
        const c = contracts.get(v.contractId);
        if (!c) return Response.json({ data: { subscriptionBillingCycleUnskip: { billingCycle: null, userErrors: [userError("Contract not found", ["id"])] } } });
        const index = cycleIndexOf(c, v.selector);
        c.skipped.delete(index);
        return Response.json({ data: { subscriptionBillingCycleUnskip: { billingCycle: cycleNode(c, index), userErrors: [] } } });
      }
      if (op === "BundleBoostBillingCycle" || op === "BundleBoostBillingCycleCharge" || op === "BundleBoostBillingCycleSkip") {
        const c = contracts.get(v.contractId);
        const key = { BundleBoostBillingCycle: "subscriptionBillingCycle", BundleBoostBillingCycleCharge: "subscriptionBillingCycleCharge", BundleBoostBillingCycleSkip: "subscriptionBillingCycleSkip" }[op as "BundleBoostBillingCycle"];
        if (!c) return Response.json({ data: { [key]: op === "BundleBoostBillingCycle" ? null : { userErrors: [userError("Contract not found", ["id"])] } } });
        const index = cycleIndexOf(c, v.selector);
        if (op === "BundleBoostBillingCycle") return Response.json({ data: { subscriptionBillingCycle: cycleNode(c, index) } });
        if (failure) return Response.json({ data: { [key]: { userErrors: [userError(failure.message)] } } });
        if (op === "BundleBoostBillingCycleSkip") {
          c.skipped.add(index);
          return Response.json({ data: { subscriptionBillingCycleSkip: { billingCycle: { cycleIndex: index, skipped: true }, userErrors: [] } } });
        }
        c.charges.push(index);
        return Response.json({
          data: {
            subscriptionBillingCycleCharge: {
              subscriptionBillingAttempt: { id: `gid://shopify/SubscriptionBillingAttempt/${nextAttempt++}` },
              userErrors: [],
            },
          },
        });
      }
      if (op === "BundleBoostContractPause" || op === "BundleBoostContractActivate" || op === "BundleBoostContractCancel") {
        const c = contracts.get(v.id);
        const key = { BundleBoostContractPause: "subscriptionContractPause", BundleBoostContractActivate: "subscriptionContractActivate", BundleBoostContractCancel: "subscriptionContractCancel" }[op as "BundleBoostContractPause"];
        if (!c) return Response.json({ data: { [key]: { contract: null, userErrors: [userError("Contract not found", ["id"])] } } });
        c.status = { BundleBoostContractPause: "PAUSED", BundleBoostContractActivate: "ACTIVE", BundleBoostContractCancel: "CANCELLED" }[op as "BundleBoostContractPause"];
        return Response.json({ data: { [key]: { contract: { id: c.id, status: c.status }, userErrors: [] } } });
      }
      if (op === "BundleBoostAppInstallationId") {
        return Response.json({ data: { currentAppInstallation: { id: "gid://shopify/AppInstallation/1" } } });
      }
      if (op === "BundleBoostActiveSubscriptions") {
        if (failure) return Response.json({ errors: [{ message: failure.message }] }, { status: 500 });
        return Response.json({ data: { currentAppInstallation: { activeSubscriptions: activeSubs } } });
      }
      if (op === "BundleBoostSubscriptionCancel") {
        if (failure) return Response.json({ errors: [{ message: failure.message }] }, { status: 500 });
        return Response.json({
          data: {
            appSubscriptionCancel: {
              appSubscription: { id: v.id, status: "CANCELLED" },
              userErrors: [],
            },
          },
        });
      }
      if (query.includes("BundleBoostProductsById")) {
        const ids = (options?.variables?.ids ?? []) as string[];
        const nodes = ids.map((id) => {
          const p = byId.get(id);
          if (!p) return null;
          return {
            id: p.id,
            title: p.title,
            handle: p.title.toLowerCase().replace(/\s+/g, "-"),
            featuredMedia: null,
            variants: { nodes: p.variants },
          };
        });
        return Response.json({ data: { nodes } });
      }
      if (query.includes("BundleBoostShopInfo")) {
        return Response.json({ data: { shop: { name: "Test Shop", currencyCode: "EUR" } } });
      }
      return Response.json({ errors: [{ message: "Unhandled query in test double" }] });
    },
  };
  return {
    client,
    calls,
    discounts,
    appMetafields,
    sellingPlanGroups,
    contracts,
    /** A contract as Shopify creates it at checkout; cycle 1 is due on `firstDue`. */
    addContract(id: string, firstDue: Date, periodDays = 30, customer: FakeContract["customer"] = { id: "gid://shopify/Customer/7", displayName: "Ayesha Khan", email: "ayesha@example.com" }) {
      contracts.set(id, {
        id,
        status: "ACTIVE",
        firstDue,
        periodDays,
        billed: new Set(),
        skipped: new Set(),
        customer,
        charges: [],
        sellingPlanId: null,
        interval: "DAY",
        intervalCount: periodDays,
        linePrice: "9.00",
        paymentUpdateEmails: 0,
      });
    },
    /** Puts the contract's lines on a selling plan (as bought at checkout). */
    setContractPlan(id: string, sellingPlanId: string, interval: string, intervalCount: number) {
      Object.assign(contracts.get(id)!, { sellingPlanId, interval, intervalCount });
    },
    contract(id: string) {
      return contracts.get(id);
    },
    /** Marks a cycle billed, as Shopify does when a charge succeeds. */
    billCycle(id: string, index: number) {
      contracts.get(id)!.billed.add(index);
    },
    setActiveSubscriptions(subs: typeof activeSubs) {
      activeSubs = subs;
    },
    failNext(operation: string, message: string) {
      failures.push({ operation, message });
    },
  };
}
