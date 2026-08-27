/**
 * The shared review queue — proving the two claims `reviewKb.ts` makes in its comments,
 * because both are about behaviour ACROSS modules and neither is visible by reading one.
 *
 * Background: `autoPublish: false` is the safety default for a feed nobody has vouched
 * for. Until now a SHARED feed with it off was write-only — the dashboard's approve route
 * is scoped `{ agencyInstallId, source: "agency" }` (correctly: an agency must never
 * publish into the corpus every other agency's bot reads), so no agency owns a shared item
 * and nothing in the product could release one. Items went in and never came out.
 *
 * The two claims worth checking:
 *   1. A REJECT SURVIVES THE NEXT POLL. Deleting the row would not — the feed still lists
 *      the item, so the next poll re-creates it and the same thing is back within the hour.
 *   2. A QUARANTINE CANNOT BE WAVED THROUGH, one at a time or in bulk. A fail-safe anybody
 *      may override is advisory, and this one is the last thing between a vendor name and
 *      a client's chat window.
 */
// FIRST — the workspace .env then the root one. `dotenv/config` alone does not find it,
// because npm runs workspace scripts with cwd = apps/server while .env lives at the root.
import "../apps/server/src/services/loadEnv";
import { execFileSync } from "node:child_process";
// fileURLToPath, NOT `new URL(...).pathname` — the latter stays percent-encoded, and this
// repo lives under "GHL theme builder", so the space became %20, the cwd did not exist and
// every CLI call died ENOENT. Which looked exactly like the CLI being broken.
import { fileURLToPath } from "node:url";
import { prisma } from "../apps/server/src/services/prisma";
import { ingestArticle } from "../apps/server/src/services/kbIngest";
import { searchKb } from "../apps/server/src/services/kbSearch";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`); }
}

const REPO = fileURLToPath(new URL("..", import.meta.url));
const CLI = ["run", "review-kb", "--workspace", "@ghl-theme-builder/server", "--"];
function cli(...args: string[]): { out: string; ok: boolean } {
  try {
    const out = execFileSync("npm", [...CLI, ...args], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { out, ok: true };
  } catch (e: any) {
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    // A CLI that never ran produces empty output, and "" trivially satisfies every
    // absence check below — an invocation failure would then read as a PASS. Say so.
    if (/ENOENT|command not found/.test(String(e.message))) {
      throw new Error(`the CLI could not be launched at all (${e.message}) — no check below means anything`);
    }
    return { out, ok: false };
  }
}

const TAG = "zzverify";
const CLEAN_URL = `mosaic:verify/${TAG}-clean`;
const DIRTY_URL = `mosaic:verify/${TAG}-dirty`;
const REJECT_URL = `mosaic:verify/${TAG}-reject`;

async function cleanup(): Promise<void> {
  await prisma.kbArticle.deleteMany({ where: { sourceUrl: { startsWith: "mosaic:verify/" } } });
  await prisma.kbFeed.deleteMany({ where: { url: { startsWith: "mosaic:verify/" } } });
}

async function main(): Promise<void> {
  await cleanup();

  console.log("\n== a feed item nobody has read waits, and is not retrievable ==");
  // forceReview is exactly what a non-autoPublish feed sets.
  const clean = await ingestArticle(
    { url: CLEAN_URL, title: `Zzverify quarterly widget reconciliation`,
      body: "To reconcile a zzverify widget, open the reconciliation screen and choose the period you want to settle. ".repeat(3) },
    { source: "ghl", forceReview: true }
  );
  check("held for review rather than published", clean.status === "held", clean.status);

  const heldRow = await prisma.kbArticle.findUnique({ where: { sourceUrl: CLEAN_URL } });
  check("  ↳ stored needs_review with NO residual leaks — unread, not unsafe",
    heldRow?.status === "needs_review" && (heldRow?.residualLeaks as any[] ?? []).length === 0,
    `${heldRow?.status} leaks=${JSON.stringify(heldRow?.residualLeaks)}`);

  let hits = await searchKb({ query: "zzverify widget reconciliation", limit: 5 });
  check("  ↳ invisible to retrieval while it waits",
    !hits.some((h: any) => h.sourceUrl === CLEAN_URL), `${hits.length} hits`);

  console.log("\n== the operator can list it — which nothing in the product could do before ==");
  const listed = cli();
  check("it appears in the shared queue", listed.out.includes(heldRow!.id), listed.out.slice(0, 200));
  check("  ↳ and the queue explains how to act on it",
    /--approve <id>/.test(listed.out) && /--reject <id>/.test(listed.out));

  console.log("\n== approving publishes it, and only then is it retrievable ==");
  const approved = cli("--approve", heldRow!.id);
  check("approve reports success", approved.ok && /Published:/.test(approved.out), approved.out.slice(0, 200));
  const afterApprove = await prisma.kbArticle.findUnique({ where: { sourceUrl: CLEAN_URL } });
  check("  ↳ status is ready", afterApprove?.status === "ready", String(afterApprove?.status));
  hits = await searchKb({ query: "zzverify widget reconciliation", limit: 5 });
  check("  ↳ NOW retrievable", hits.some((h: any) => h.sourceUrl === CLEAN_URL), `${hits.length} hits`);

  console.log("\n== a real quarantine cannot be waved through, singly or in bulk ==");
  const dirty = await ingestArticle(
    { url: DIRTY_URL, title: "Zzverify migration notes",
      body: "This zzverify guide explains moving accounts. Written for GoHighLeveI users migrating between systems, with the usual caveats about data mapping and field types. ".repeat(2) },
    { source: "ghl", forceReview: true }
  );
  const dirtyRow = await prisma.kbArticle.findUnique({ where: { sourceUrl: DIRTY_URL } });
  const dirtyLeaks = (dirtyRow?.residualLeaks as any[] ?? []).length;
  check("a homoglyph vendor name is quarantined with leaks recorded",
    dirty.status === "quarantined" && dirtyLeaks > 0, `${dirty.status} leaks=${dirtyLeaks}`);

  const refused = cli("--approve", dirtyRow!.id);
  check("  ↳ --approve REFUSES it", !refused.ok && /refusing/i.test(refused.out), refused.out.slice(0, 220));
  check("  ↳ and names the surviving term rather than just failing",
    /brand term survived/i.test(refused.out), refused.out.slice(0, 220));
  const stillHeld = await prisma.kbArticle.findUnique({ where: { sourceUrl: DIRTY_URL } });
  check("  ↳ still not published", stillHeld?.status !== "ready", String(stillHeld?.status));

  console.log("\n== --approve-all HONOURS --feed, and touches nothing from elsewhere ==");
  /*
   * The bug this pins: the first version validated the feed id and then approved every
   * pending shared article regardless of origin — a flag that names a scope and does not
   * apply it. Nothing in the DB linked an article to its feed, so the scope was
   * unexpressible. It published all 10 real changelog items during a verify run, which is
   * how it was found; reading the function did not show it.
   */
  const feedA = await prisma.kbFeed.upsert({
    where: { url: `mosaic:verify/${TAG}-feed-a` },
    create: { url: `mosaic:verify/${TAG}-feed-a`, source: "ghl", autoPublish: false, title: "Zzverify feed A" },
    update: {},
  });
  const feedB = await prisma.kbFeed.upsert({
    where: { url: `mosaic:verify/${TAG}-feed-b` },
    create: { url: `mosaic:verify/${TAG}-feed-b`, source: "ghl", autoPublish: false, title: "Zzverify feed B" },
    update: {},
  });
  const mk = (url: string, feedId: string, n: string) =>
    ingestArticle(
      { url, title: `Zzverify ${n} scheduling policy`,
        body: `The zzverify ${n} scheduling policy governs how appointments are batched across the working week and what happens to overflow. `.repeat(3) },
      { source: "ghl", forceReview: true, feedId }
    );
  await mk(`mosaic:verify/${TAG}-a1`, feedA.id, "alpha");
  await mk(`mosaic:verify/${TAG}-a2`, feedA.id, "alpha second");
  await mk(`mosaic:verify/${TAG}-b1`, feedB.id, "bravo");

  const bulk = cli("--approve-all", "--feed", feedA.id);
  check("bulk-approving feed A reports only A's count", /Published 2 /.test(bulk.out), bulk.out.slice(0, 240));
  const a1 = await prisma.kbArticle.findUnique({ where: { sourceUrl: `mosaic:verify/${TAG}-a1` } });
  const b1 = await prisma.kbArticle.findUnique({ where: { sourceUrl: `mosaic:verify/${TAG}-b1` } });
  check("  ↳ feed A's items are published", a1?.status === "ready", String(a1?.status));
  check("  ↳ and feed B's item is UNTOUCHED — trusting one publisher does not publish another",
    b1?.status === "needs_review", String(b1?.status));

  const bulkQ = cli("--approve-all", "--feed", feedB.id);
  check("  ↳ a feed with nothing pending but B's says so by name",
    /Published 1 /.test(bulkQ.out), bulkQ.out.slice(0, 200));

  // The quarantined item belongs to no feed, so no --approve-all can ever reach it.
  const afterBulk = await prisma.kbArticle.findUnique({ where: { sourceUrl: DIRTY_URL } });
  check("  ↳ and a quarantined article is still not published after any bulk run",
    afterBulk?.status !== "ready", String(afterBulk?.status));

  console.log("\n== a feed link is adopted on re-poll, so pre-existing rows are reachable ==");
  /*
   * Rows ingested before `feedId` existed can never acquire one through the normal path:
   * `ingestArticle` short-circuits on an unchanged contentHash before it would rewrite
   * anything. Left alone they stay permanently invisible to --approve-all --feed.
   */
  const orphanUrl = `mosaic:verify/${TAG}-orphan`;
  const oBody = "The zzverify orphan record predates the feed column entirely and must still become reachable. ".repeat(3);
  await ingestArticle({ url: orphanUrl, title: "Zzverify orphan record", body: oBody }, { source: "ghl", forceReview: true });
  await prisma.kbArticle.update({ where: { sourceUrl: orphanUrl }, data: { feedId: null } });
  const beforeAdopt = await prisma.kbArticle.findUnique({ where: { sourceUrl: orphanUrl } });
  check("an article with no feed link starts orphaned", beforeAdopt?.feedId === null, String(beforeAdopt?.feedId));

  const adopt = await ingestArticle({ url: orphanUrl, title: "Zzverify orphan record", body: oBody }, { source: "ghl", forceReview: true, feedId: feedA.id });
  const afterAdopt = await prisma.kbArticle.findUnique({ where: { sourceUrl: orphanUrl } });
  check("  ↳ an unchanged re-poll still reports unchanged", adopt.status === "unchanged", adopt.status);
  check("  ↳ but adopts the feed link", afterAdopt?.feedId === feedA.id, String(afterAdopt?.feedId));
  check("  ↳ and does NOT resurrect its review status", afterAdopt?.status === "needs_review", String(afterAdopt?.status));

  // Only ever fills a NULL — an article must not be re-pointed at whichever feed polled last.
  await ingestArticle({ url: orphanUrl, title: "Zzverify orphan record", body: oBody }, { source: "ghl", forceReview: true, feedId: feedB.id });
  const afterSecond = await prisma.kbArticle.findUnique({ where: { sourceUrl: orphanUrl } });
  check("  ↳ and a DIFFERENT feed polling it later does not steal it",
    afterSecond?.feedId === feedA.id, String(afterSecond?.feedId));

  console.log("\n== THE LOAD-BEARING ONE: a rejection survives the next poll ==");
  const body = "The zzverify rejection path exists so an operator can decline an item without it returning. ".repeat(3);
  await ingestArticle({ url: REJECT_URL, title: "Zzverify declined release note", body }, { source: "ghl", forceReview: true });
  const rejRow = await prisma.kbArticle.findUnique({ where: { sourceUrl: REJECT_URL } });

  const rejected = cli("--reject", rejRow!.id);
  check("reject reports success", rejected.ok && /Rejected:/.test(rejected.out), rejected.out.slice(0, 200));
  const afterReject = await prisma.kbArticle.findUnique({ where: { sourceUrl: REJECT_URL } });
  check("  ↳ archived, NOT deleted — the row is kept for provenance",
    afterReject?.status === "archived", String(afterReject?.status));

  // The whole point. A poll re-offers every item the feed still lists; if that flipped the
  // status back, "reject" would be a button that undoes itself every hour.
  const repoll = await ingestArticle({ url: REJECT_URL, title: "Zzverify declined release note", body }, { source: "ghl", forceReview: true });
  const afterRepoll = await prisma.kbArticle.findUnique({ where: { sourceUrl: REJECT_URL } });
  check("re-polling the SAME item reports unchanged", repoll.status === "unchanged", repoll.status);
  check("  ↳ and it is STILL archived — the decision held", afterRepoll?.status === "archived", String(afterRepoll?.status));
  // Positive control: the quarantined row IS still queued, which proves the listing ran.
  // Without it, an empty output would satisfy the absence check and read as a pass.
  const afterQueue = cli().out;
  check("  ↳ so it does NOT reappear in the queue",
    afterQueue.includes(dirtyRow!.id) && !afterQueue.includes(rejRow!.id),
    afterQueue.includes(dirtyRow!.id) ? "rejected item is back in the queue" : "the listing did not run at all");
  hits = await searchKb({ query: "zzverify declined release", limit: 5 });
  check("  ↳ and stays invisible to retrieval", !hits.some((h: any) => h.sourceUrl === REJECT_URL), `${hits.length} hits`);

  console.log("\n== an already-published article is not silently un-published ==");
  const reRejectPublished = cli("--reject", heldRow!.id);
  check("rejecting a ready article is refused, not done quietly",
    !reRejectPublished.ok && /already published/i.test(reRejectPublished.out),
    reRejectPublished.out.slice(0, 200));

  console.log("\n== the tenant boundary holds ==");
  const anyAgency = await prisma.agencyInstall.findFirst({ select: { id: true } });
  if (anyAgency) {
    await ingestArticle(
      { url: `mosaic:verify/${TAG}-agency`, title: "Zzverify agency owned note",
        body: "An agency's own held article belongs on their own Your content tab, not in Mosaic's shared queue. ".repeat(3) },
      { source: "agency", agencyInstallId: anyAgency.id, forceReview: true }
    );
    const agencyRow = await prisma.kbArticle.findUnique({ where: { sourceUrl: `mosaic:verify/${TAG}-agency` } });
    const sharedQueue = cli().out;
    check("an AGENCY's held article never appears in the shared queue",
      sharedQueue.includes(dirtyRow!.id) && !sharedQueue.includes(agencyRow!.id),
      sharedQueue.includes(dirtyRow!.id) ? "shared CLI is listing tenant content" : "the listing did not run at all");
    const reach = cli("--approve", agencyRow!.id);
    check("  ↳ and the shared CLI cannot approve it either",
      !reach.ok && /no such shared article/i.test(reach.out), reach.out.slice(0, 200));
  }

  await cleanup();
  console.log(`\n${"-".repeat(52)}\n  ${pass} passed, ${fail} failed`);
}

main()
  .catch(async (e) => { console.error(e); fail++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fail ? 1 : 0); });
