import { z } from "zod";

/**
 * Server environment contract. Validated once, on first access, so a
 * misconfigured deployment fails fast with a readable message instead of
 * surfacing as an opaque OAuth or database error later.
 *
 * Values are never logged; only the names of invalid variables are reported.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  SHOPIFY_API_KEY: z.string().min(1, "is required"),
  SHOPIFY_API_SECRET: z.string().min(1, "is required"),
  SHOPIFY_APP_URL: z.url("must be an absolute URL"),
  SCOPES: z.string().optional(),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, "must be a PostgreSQL connection string"),
  // "neon": connect over WebSockets (port 443) via Neon's serverless driver.
  DATABASE_ADAPTER: z.enum(["neon"]).optional(),
  SHOP_CUSTOM_DOMAIN: z.string().optional(),
  // Handle of the app in the Partner Dashboard, used to build the
  // Shopify-hosted plan selection URL. Optional until pricing is configured.
  SHOPIFY_APP_HANDLE: z.string().optional(),
  // Shared secret for the hourly renewal job (POST /jobs/renewals with
  // "Authorization: Bearer <secret>"). Unset = the endpoint is disabled.
  JOBS_SECRET: z.string().min(24, "must be at least 24 characters").optional(),
  // Set in Vercel: Vercel Cron sends it as "Authorization: Bearer <secret>"
  // when it calls /jobs/renewals (see vercel.json).
  CRON_SECRET: z.string().min(24, "must be at least 24 characters").optional(),
  // Shopify App Pricing: subscriptions are read from the Partner API.
  // All three are needed to verify a merchant's plan; without them every
  // shop is treated as Free.
  SHOPIFY_PARTNER_ORG_ID: z.string().regex(/^\d+$/, "must be the numeric Partner organization ID").optional(),
  SHOPIFY_PARTNER_API_ACCESS_TOKEN: z.string().min(1).optional(),
  SHOPIFY_APP_GID: z.string().regex(/^gid:\/\/shopify\/App\/\d+$/, "must look like gid://shopify/App/123").optional(),
  // Public support address, shown on the landing page and privacy policy.
  SUPPORT_EMAIL: z.email("must be an email address").optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid server environment: ${issues.join("; ")}`);
    this.name = "EnvValidationError";
  }
}

export function parseServerEnv(source: NodeJS.ProcessEnv): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map(
        (issue) => `${issue.path.join(".")} ${issue.message}`,
      ),
    );
  }
  return result.data;
}

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
