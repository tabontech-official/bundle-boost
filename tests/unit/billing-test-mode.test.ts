import { afterEach, describe, expect, it } from "vitest";
import type { AdminGraphqlClient } from "../../app/.server/shopify/graphql";
import { usesTestCharges } from "../../app/.server/shopify/shop-info";

function adminReturning(body: unknown): AdminGraphqlClient {
  return { graphql: async () => Response.json(body) };
}

const store = (partnerDevelopment: boolean) => adminReturning({ data: { shop: { plan: { partnerDevelopment } } } });

afterEach(() => {
  delete process.env.BILLING_TEST;
});

describe("test charges for app billing", () => {
  it("uses test charges on development stores, which can't accept real ones", async () => {
    expect(await usesTestCharges(store(true))).toBe(true);
  });

  it("uses real charges on real stores", async () => {
    expect(await usesTestCharges(store(false))).toBe(false);
  });

  it("falls back to a test charge when Shopify can't say", async () => {
    expect(await usesTestCharges(adminReturning({ errors: [{ message: "Throttled" }] }))).toBe(true);
  });

  it("BILLING_TEST=true forces test charges", async () => {
    process.env.BILLING_TEST = "true";
    expect(await usesTestCharges(store(false))).toBe(true);
  });
});
