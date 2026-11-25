// Runs database migrations during the Vercel build.
import { execFileSync } from "node:child_process";
import process from "node:process";

// Ensure DIRECT_URL is set if DATABASE_URL is present
if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL.replace("-pooler", "");
}

if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production" && !process.env.RUN_MIGRATIONS_IN_PREVIEW) {
  console.log(`[vercel-migrate] Skipping migrations (VERCEL_ENV=${process.env.VERCEL_ENV}). Set RUN_MIGRATIONS_IN_PREVIEW=1 to enable.`);
  process.exit(0);
}
console.log("[vercel-migrate] Applying database migrations...");
execFileSync("node", ["scripts/migrate.mjs"], { stdio: "inherit", env: process.env });
