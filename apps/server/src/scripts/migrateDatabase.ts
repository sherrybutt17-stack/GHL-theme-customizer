/**
 * Copy a Mosaic database from one Postgres host to another.
 *
 * Written for the 2026-08 move off Render's expiring free Postgres onto Neon, on a
 * machine with no `pg_dump`/`psql` and no Docker. Prisma is already a dependency and
 * can hold two connections at once, so it does the job with no extra tooling.
 *
 * The TARGET must already have the schema - run `prisma migrate deploy` against it
 * first. This copies rows only, never DDL.
 *
 * Usage:
 *   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... npm run migrate-db --workspace @ghl-theme-builder/server
 *   ... -- --dry-run        report what WOULD be copied, write nothing
 *   ... -- --skip-webhooks  omit WebhookEvent (audit/idempotency log; often the bulk)
 *
 * Safe to re-run: every insert uses skipDuplicates, so an interrupted run resumes
 * rather than double-writing.
 *
 * NOTE: carry TOKEN_ENCRYPTION_KEY to the new deploy unchanged. The OAuth tokens in
 * AgencyInstall are AES-256-GCM ciphertext (services/tokenCrypto.ts); under a
 * different key they don't degrade, they throw, and every agency must re-authorise.
 */
import { PrismaClient, Prisma } from "@prisma/client";

const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_WEBHOOKS = process.argv.includes("--skip-webhooks");
const BATCH = 500;

/** Parent-before-child, so foreign keys always resolve. */
const COPY_ORDER = [
  "AgencyInstall", // root: everything below hangs off it
  "LocationInstall", // -> AgencyInstall
  "ThemeConfig", // -> LocationInstall (versioned: many rows per location)
  "AgencyDefaultTheme", // -> AgencyInstall
  "ThemePreset", // -> AgencyInstall
  "CustomMenuLinkRegistration", // -> AgencyInstall
  "WebhookEvent", // independent
] as const;

/**
 * Prisma reads a null `Json?` column as `null`, but rejects a bare `null` on write
 * because it can't tell "SQL NULL" from "the JSON value null". DbNull is the former.
 * Derived from the DMMF so a newly added Json field is handled without edits here.
 */
const jsonFieldsByModel = new Map<string, string[]>(
  Prisma.dmmf.datamodel.models.map((m) => [m.name, m.fields.filter((f) => f.type === "Json").map((f) => f.name)])
);

function normalizeJsonNulls(model: string, row: Record<string, unknown>) {
  for (const field of jsonFieldsByModel.get(model) ?? []) {
    if (row[field] === null) row[field] = Prisma.DbNull;
  }
  return row;
}

/** "AgencyInstall" -> the `agencyInstall` delegate on the client. */
const delegate = (client: PrismaClient, model: string): any =>
  (client as any)[model.charAt(0).toLowerCase() + model.slice(1)];

async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  const targetUrl = process.env.TARGET_DATABASE_URL;
  if (!sourceUrl || !targetUrl) {
    console.error("Set both SOURCE_DATABASE_URL and TARGET_DATABASE_URL.");
    process.exit(1);
  }
  if (sourceUrl === targetUrl) {
    console.error("SOURCE_DATABASE_URL and TARGET_DATABASE_URL are identical - refusing to run.");
    process.exit(1);
  }

  const source = new PrismaClient({ datasourceUrl: sourceUrl });
  const target = new PrismaClient({ datasourceUrl: targetUrl });
  const models = COPY_ORDER.filter((m) => !(SKIP_WEBHOOKS && m === "WebhookEvent"));

  try {
    // Fail before writing anything if either side is unreachable, rather than
    // half-way through the copy.
    await Promise.all([source.$connect(), target.$connect()]);
    console.log(`Connected. ${DRY_RUN ? "DRY RUN - nothing will be written.\n" : ""}`);

    const summary: { model: string; source: number; copied: number; target: number }[] = [];

    for (const model of models) {
      const from = delegate(source, model);
      const to = delegate(target, model);
      const total = await from.count();
      const before = await to.count();
      let copied = 0;

      if (!DRY_RUN && total > 0) {
        // Ordered by id so batches are stable across a resumed run.
        for (let skip = 0; skip < total; skip += BATCH) {
          const rows = await from.findMany({ skip, take: BATCH, orderBy: { id: "asc" } });
          const payload = rows.map((r: Record<string, unknown>) => normalizeJsonNulls(model, { ...r }));
          const res = await to.createMany({ data: payload, skipDuplicates: true });
          copied += res.count;
          process.stdout.write(`  ${model}: ${Math.min(skip + BATCH, total)}/${total}\r`);
        }
      }

      const after = DRY_RUN ? before : await to.count();
      summary.push({ model, source: total, copied, target: after });
      console.log(
        `  ${model.padEnd(28)} source=${String(total).padStart(6)}  ` +
          `${DRY_RUN ? "would copy" : "copied"}=${String(DRY_RUN ? total - before : copied).padStart(6)}  target=${after}`
      );
    }

    console.log("\n--- verification ---");
    let mismatched = 0;
    for (const s of summary) {
      // Target may legitimately hold MORE than source (pre-existing rows); fewer means
      // the copy dropped something.
      if (!DRY_RUN && s.target < s.source) {
        console.error(`  MISMATCH ${s.model}: source ${s.source} > target ${s.target}`);
        mismatched++;
      }
    }
    if (DRY_RUN) console.log("  (skipped - dry run)");
    else if (mismatched === 0) console.log("  OK - every table's target count >= source count.");

    if (SKIP_WEBHOOKS) console.log("\nNOTE: WebhookEvent was skipped (--skip-webhooks).");
    if (mismatched > 0) process.exit(1);
  } finally {
    await source.$disconnect().catch(() => {});
    await target.$disconnect().catch(() => {});
  }
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
