import "../services/loadEnv";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * Apply every migration to an EMPTY database and check what comes out.
 *
 * Run this before any deploy. On Render's free plan migrations run inside the build
 * command, so a broken one doesn't degrade the site — it fails the build, and the failed
 * row it leaves in `_prisma_migrations` blocks every later deploy until someone resolves
 * it by hand against production.
 *
 * The failure this exists to catch is invisible in development: migrations are applied
 * one at a time, in the order you happen to write them, so a migration that depends on a
 * LATER one's table works fine on your machine forever. It only breaks on a fresh
 * database — which is to say, on the deploy. That is exactly what happened to
 * `add_desk_tickets_and_canned_replies`: it altered `Conversation` while sorting before
 * the migration that creates it.
 *
 * Checks the OUTCOME too, not just that the run exited 0. Two features here are raw SQL
 * that Prisma's datamodel cannot express, so `migrate diff` reports them as drift and a
 * regenerated migration would quietly drop them:
 *   - `KbArticle.searchVector` must be a GENERATED column (not a trigger — generated
 *     cannot drift), and
 *   - it must carry a GIN index, or every KB search degrades to a sequential scan.
 */
const SCRATCH_DB = "mosaic_migration_check";
const MIGRATIONS_DIR = join(__dirname, "..", "..", "prisma", "migrations");

/**
 * RENDER DEPLOYS FROM GIT, NOT FROM YOUR DISK — so "every migration applies" is only half
 * the question. The other half is whether the deploy will HAVE them.
 *
 * This gate read the folder, applied 27 migrations to an empty database and printed ✓,
 * while git knew about 26. The missing one added `origin`, `ticketType`, `snoozedUntil`,
 * `botPaused`, the automation claim columns and `SupportConfig.slaFirstResponseMins`, and
 * dropped NOT NULL from `accessTokenHash`. Measured by applying only the git-tracked set to
 * a scratch database: **eleven columns absent** and `accessTokenHash` still NOT NULL.
 *
 * Prisma selects every scalar field by default, so that deploy does not degrade — the desk
 * 500s on any conversation query, the widget cannot open one, and the ticket automations
 * crash on every pass. Exactly the shape this script was written for ("invisible in
 * development, because your machine already has the columns"), one layer further out: the
 * gate itself could not see it, because it was looking at the wrong copy of the repo.
 *
 * Both directions are checked. A migration in git but deleted locally is the mirror image:
 * it would apply on the deploy and never be exercised by the run above.
 */
function gitTrackingProblems(): { untracked: string[]; onlyInGit: string[]; skipped: string } | null {
  let tracked: Set<string>;
  try {
    tracked = new Set(
      execFileSync("git", ["ls-files", "--", MIGRATIONS_DIR], { encoding: "utf8" })
        .split("\n")
        .filter(Boolean)
        .map((f) => f.split("/").slice(-2)[0])
    );
  } catch {
    // Not a git checkout (a tarball, a container). Say so rather than passing silently:
    // a check that cannot run is not a check that passed.
    return { untracked: [], onlyInGit: [], skipped: "not a git checkout" };
  }
  const onDisk = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  return {
    untracked: onDisk.filter((d) => !tracked.has(d)),
    onlyInGit: [...tracked].filter((d) => d !== "migrations" && !onDisk.includes(d)),
    skipped: "",
  };
}

function adminUrl(base: string, db: string): string {
  return base.replace(/\/[^/?]+(\?|$)/, `/${db}$1`);
}

async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set");
  if (/neon\.tech|render\.com/i.test(base)) {
    // This drops and recreates a database. It must never be aimed at a real one.
    throw new Error("Refusing to run against a hosted database — point DATABASE_URL at localhost.");
  }

  /**
   * Checked BEFORE the database work: it needs nothing, and there is no sense spending
   * thirty seconds proving that a migration set applies when the deploy will not receive
   * it. Reported through the same list at the end so there is one verdict.
   */
  const git = gitTrackingProblems()!;

  // Uses the Prisma client already in the workspace rather than adding a `pg` dependency
  // just for a dev script.
  const admin = new PrismaClient({ datasources: { db: { url: base } } });
  console.log(`Recreating scratch database "${SCRATCH_DB}"…`);
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${SCRATCH_DB}"`);
  await admin.$disconnect();

  const target = adminUrl(base, SCRATCH_DB);
  console.log("Applying every migration from zero…\n");
  try {
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: target },
      stdio: "inherit",
    });
  } catch {
    console.error("\n✗ A migration failed on a FRESH database. This deploy would fail.");
    process.exit(1);
  }

  const db = new PrismaClient({ datasources: { db: { url: target } } });
  const one = async (sql: string) => (await db.$queryRawUnsafe<any[]>(sql))[0];

  const applied = await one(`SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`);
  const failed = await one(`SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NULL`);
  const generated = await one(
    `SELECT attgenerated::text AS g FROM pg_attribute WHERE attrelid = '"KbArticle"'::regclass AND attname = 'searchVector'`
  );
  const gin = await one(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'KbArticle' AND indexdef ILIKE '%gin%' LIMIT 1`
  );
  await db.$disconnect();

  const checks: [string, boolean, string][] = [
    [
      "every migration is committed — the deploy builds from GIT, not from this disk",
      git.untracked.length === 0,
      git.skipped
        ? `skipped (${git.skipped})`
        : `${git.untracked.join(", ")} — applied here and ABSENT from the deploy, so its columns will not exist`,
    ],
    [
      "  ↳ and nothing in git is missing locally, so the run above covered them all",
      git.onlyInGit.length === 0,
      `${git.onlyInGit.join(", ")} — these would apply on the deploy and were never exercised here`,
    ],
    ["every migration applied", Number(failed.n) === 0, `${failed.n} unfinished`],
    ["migrations recorded", Number(applied.n) > 0, `${applied.n}`],
    ["searchVector is a GENERATED column", generated?.g === "s", generated?.g ?? "missing"],
    ["searchVector has its GIN index", !!gin?.indexname, gin?.indexname ?? "MISSING"],
  ];

  let bad = 0;
  console.log();
  for (const [name, ok, detail] of checks) {
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : ` — ${detail}`}`);
    if (!ok) bad++;
  }

  const cleanup = new PrismaClient({ datasources: { db: { url: base } } });
  await cleanup.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
  await cleanup.$disconnect();

  console.log(bad ? `\n✗ ${bad} problem(s) — do not deploy.` : `\n✓ ${applied.n} migrations apply cleanly to an empty database.`);
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
