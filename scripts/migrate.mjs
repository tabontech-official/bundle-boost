#!/usr/bin/env node
/**
 * Applies pending Prisma migrations before the app starts.
 *
 * Prisma Migrate always needs a direct Postgres connection (port 5432). Some
 * networks block that port while HTTPS works. If the database can't be
 * reached that way and DATABASE_ADAPTER=neon, this checks over Neon's HTTPS
 * SQL endpoint whether every local migration is already applied:
 *   - all applied  → warn and continue (nothing to do)
 *   - any missing  → fail with a clear message, so the app never runs
 *                    against an out-of-date schema.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Read .env when the caller didn't pass the variables (never overrides).
try {
  process.loadEnvFile();
} catch {
  // no .env file
}

// Ensure DIRECT_URL is set if DATABASE_URL is available
if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL.replace("-pooler", "");
}

const migrationsDir = join(process.cwd(), "prisma", "migrations");

function runMigrateDeploy() {
  const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  process.stdout.write(result.stdout ?? "");
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function localMigrations() {
  return readdirSync(migrationsDir)
    .filter((name) => statSync(join(migrationsDir, name)).isDirectory())
    .sort();
}

async function appliedOverHttps(connectionString) {
  const host = new URL(connectionString).hostname;
  const response = await fetch(`https://${host}/sql`, {
    method: "POST",
    headers: { "Neon-Connection-String": connectionString, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: 'select migration_name from "_prisma_migrations" where finished_at is not null and rolled_back_at is null',
      params: [],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Neon HTTPS check failed with HTTP ${response.status}`);
  const body = await response.json();
  return new Set(body.rows.map((row) => row.migration_name));
}

const first = runMigrateDeploy();
if (first.ok) process.exit(0);

const unreachable = /P1001|Can't reach database server/.test(first.output);
if (!unreachable || process.env.DATABASE_ADAPTER !== "neon") {
  process.stderr.write(first.output);
  process.exit(1);
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
try {
  const applied = await appliedOverHttps(url);
  const missing = localMigrations().filter((name) => !applied.has(name));
  if (missing.length) {
    console.error(
      `\n✖ Port 5432 is blocked on this network and ${missing.length} migration(s) are not applied:\n  ${missing.join("\n  ")}\n` +
        "  Run `npx prisma migrate deploy` from a network that allows port 5432, then start again.\n",
    );
    process.exit(1);
  }
  console.warn(
    "\n⚠ Port 5432 is blocked on this network, so `prisma migrate deploy` couldn't run.\n" +
      "  Checked over HTTPS instead: every migration is already applied. Continuing.\n",
  );
  process.exit(0);
} catch (error) {
  process.stderr.write(first.output);
  console.error(`\n✖ Could not verify migrations over HTTPS either: ${error.message}\n`);
  process.exit(1);
}
