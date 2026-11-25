import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

// Interactive transactions default to maxWait 2s / timeout 5s. A campaign
// save runs several statements in one transaction; against a remote database
// (e.g. Neon in another region, ~300 ms per round trip in local dev) that
// can exceed 5s. Production should run in the database's region, where
// these limits are never approached.
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

/**
 * DATABASE_ADAPTER=neon connects through Neon's serverless driver over
 * WebSockets (port 443) instead of the Postgres wire protocol on port 5432 —
 * for networks that block 5432. Unset: Prisma's standard TCP connection.
 */
function createClient() {
  // Local dev: read .env if the process wasn't given it (never overrides
  // values that are already set; production has no .env file).
  if (!process.env.DATABASE_ADAPTER && process.env.NODE_ENV !== "production") {
    try {
      process.loadEnvFile();
    } catch {
      // no .env file
    }
  }
  const url = process.env.DATABASE_URL ?? "";
  const isNeon =
    process.env.DATABASE_ADAPTER === "neon" ||
    (typeof url === "string" && url.includes("neon.tech"));

  if (isNeon && url) {
    const adapter = new PrismaNeon({ connectionString: url });
    return new PrismaClient({ adapter, transactionOptions: TRANSACTION_OPTIONS });
  }
  return new PrismaClient({ transactionOptions: TRANSACTION_OPTIONS });
}

// Reuse one client across dev-server hot reloads to avoid exhausting
// PostgreSQL connections.
const prisma = global.prismaGlobal ?? createClient();

if (process.env.NODE_ENV !== "production") {
  global.prismaGlobal = prisma;
}

export default prisma;
