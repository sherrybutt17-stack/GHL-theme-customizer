import "../services/loadEnv";
import { prisma } from "../services/prisma";
import { leakTerms } from "../services/brandLexicon";

/**
 * Review the SHARED knowledge base queue — the items a feed brought in that nobody has
 * vouched for yet.
 *
 *   npm run review-kb --workspace @ghl-theme-builder/server
 *   npm run review-kb --workspace @ghl-theme-builder/server -- --show <id>
 *   npm run review-kb --workspace @ghl-theme-builder/server -- --approve <id>
 *   npm run review-kb --workspace @ghl-theme-builder/server -- --reject <id>
 *   npm run review-kb --workspace @ghl-theme-builder/server -- --approve-all --feed <feedId>
 *   npm run review-kb --workspace @ghl-theme-builder/server -- --trust-feed <feedId>
 *
 * WHY THIS EXISTS AT ALL. `autoPublish` is off by default and that default is the safety
 * property — the gates prove an item names no vendor, never that it is accurate, current,
 * or even a how-to. But until this script, a SHARED feed with autoPublish off was a black
 * hole: items went into `needs_review` and there was no path in the product that could
 * ever let them out. The dashboard's approve route is scoped
 * `{ agencyInstallId, source: "agency" }` — correctly, since an agency must never be able
 * to publish into the corpus every OTHER agency's bot reads — so no agency owns a shared
 * item and no agency can release one. That is the same write-only shape as the desk
 * storing agent replies nothing delivered.
 *
 * DELIBERATELY A CLI, NOT AN HTTP ROUTE. The shared corpus is Mosaic's own, so an endpoint
 * would need a new authorisation surface, and the desk exists to answer clients rather
 * than to curate a corpus. Same reasoning as `create-desk-user`: the operations only
 * Mosaic performs are operations you run against the database, not features in a product.
 *
 * SHARED ONLY, on purpose. An agency's own held articles are reachable from their own
 * "Your content" tab, and this script must not become a second way to reach tenant
 * content that bypasses `requireAgency`.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

/** Shared, waiting on a human. `archived` is a decision already taken, so it is excluded. */
const PENDING = { agencyInstallId: null, status: "needs_review" } as const;

/** The terms as a person would search for them — see `leakTerms`. */
const leaksOf = leakTerms;

function ageOf(d: Date | null): string {
  if (!d) return "unknown";
  const hours = Math.floor((Date.now() - d.getTime()) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function list(): Promise<void> {
  const rows = await prisma.kbArticle.findMany({
    where: PENDING,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      titleNormalized: true,
      bodyNormalized: true,
      featureTags: true,
      residualLeaks: true,
      sourceUrl: true,
      createdAt: true,
      // The decision being made is about the PUBLISHER as much as the item — "do I trust
      // this source" is what the queue is for — so the listing has to name it.
      feed: { select: { id: true, url: true, title: true } },
    },
  });

  if (!rows.length) {
    console.log("Nothing waiting. The shared review queue is empty.");
    return;
  }

  console.log(`${rows.length} shared article(s) waiting for review:\n`);
  for (const r of rows) {
    const leaks = leaksOf(r.residualLeaks);
    // A quarantine and a merely-unread item look identical in a status column and must
    // not read alike here: one needs its wording fixed, the other needs somebody's opinion.
    const flag = leaks.length
      ? `  ⚠ QUARANTINED — a brand term survived: ${leaks.join(", ")}. Cannot be approved.`
      : "";
    console.log(`${r.id}`);
    console.log(`  ${r.titleNormalized}`);
    console.log(`  ${r.bodyNormalized.slice(0, 140).replace(/\s+/g, " ")}…`);
    console.log(`  tags: ${r.featureTags.join(", ") || "(none)"} · ${ageOf(r.createdAt)}`);
    console.log(`  from: ${r.feed ? (r.feed.title ?? r.feed.url) : "(no feed — hand-written or crawled)"}`);
    if (flag) console.log(flag);
    console.log();
  }

  const feeds = [...new Map(rows.filter((r) => r.feed).map((r) => [r.feed!.id, r.feed!])).values()];
  console.log("Read one in full with  -- --show <id>");
  console.log("Then                   -- --approve <id>   or   -- --reject <id>");
  if (feeds.length) {
    console.log("\nOnce you have read a few and trust a publisher:");
    for (const f of feeds) {
      console.log(`  -- --approve-all --feed ${f.id}   (its backlog: ${f.title ?? f.url})`);
      console.log(`  -- --trust-feed ${f.id}           (and everything it sends from now on)`);
    }
  }
}

async function show(id: string): Promise<void> {
  const a = await prisma.kbArticle.findFirst({
    where: { id, agencyInstallId: null },
    select: {
      id: true,
      titleNormalized: true,
      bodyNormalized: true,
      featureTags: true,
      residualLeaks: true,
      status: true,
      sourceUrl: true,
    },
  });
  if (!a) throw new Error(`no such shared article: ${id}`);

  const leaks = leaksOf(a.residualLeaks);
  console.log(`${a.titleNormalized}\n${"=".repeat(Math.min(a.titleNormalized.length, 72))}\n`);
  console.log(a.bodyNormalized);
  console.log(`\n---`);
  console.log(`status : ${a.status}${leaks.length ? `  ⚠ leaks: ${leaks.join(", ")}` : ""}`);
  console.log(`tags   : ${a.featureTags.join(", ") || "(none)"}`);
  // Internal provenance. Never rendered to a client or an agent; shown here because the
  // person running this is the operator deciding whether to trust the publisher.
  console.log(`source : ${a.sourceUrl ?? "(hand-written)"}`);
}

/**
 * `needs_review` -> `ready`, and ONLY for an article whose normalization left nothing
 * behind. An operator cannot wave a real quarantine through for the same reason an agency
 * cannot: a fail-safe anybody is allowed to override is advisory, and this one is the last
 * thing between a vendor name and a client's chat window. Those need the wording fixed or
 * the lexicon taught the term, then a re-ingest.
 */
async function approve(id: string): Promise<void> {
  const a = await prisma.kbArticle.findFirst({
    where: { id, agencyInstallId: null },
    select: { id: true, status: true, residualLeaks: true, titleNormalized: true },
  });
  if (!a) throw new Error(`no such shared article: ${id}`);

  const leaks = leaksOf(a.residualLeaks);
  if (leaks.length > 0) {
    throw new Error(
      `refusing: a brand term survived normalization (${leaks.join(", ")}). ` +
        `Fix the wording or teach brandLexicon.ts the term, then re-ingest.`
    );
  }
  if (a.status === "ready") {
    console.log(`Already published: ${a.titleNormalized}`);
    return;
  }

  await prisma.kbArticle.update({ where: { id: a.id }, data: { status: "ready" } });
  console.log(`Published: ${a.titleNormalized}`);
  console.log("  It is retrievable now — every agency's bot can cite it.");
}

/**
 * A rejection has to SURVIVE the next poll, or it is not a decision, it is a treadmill.
 *
 * Deleting the row would not do it: the feed still lists the item, so the next poll
 * re-creates it and the same thing is back in the queue within the hour. `archived`
 * ("manually retired", already in the enum) is skipped by retrieval exactly like
 * `needs_review`, and `ingestArticle` short-circuits on an unchanged `contentHash`
 * BEFORE it would rewrite the status — so the decision holds until the publisher
 * genuinely edits the item, which is the one case worth looking at again.
 */
async function reject(id: string): Promise<void> {
  const a = await prisma.kbArticle.findFirst({
    where: { id, agencyInstallId: null },
    select: { id: true, titleNormalized: true, status: true },
  });
  if (!a) throw new Error(`no such shared article: ${id}`);
  if (a.status === "ready") {
    throw new Error(
      `that article is already published. Rejecting it here would leave every bot that ` +
        `has cited it looking wrong; retire it deliberately instead.`
    );
  }

  await prisma.kbArticle.update({ where: { id: a.id }, data: { status: "archived" } });
  console.log(`Rejected: ${a.titleNormalized}`);
  console.log("  Archived, not deleted — so the next poll does not bring it straight back.");
}

/**
 * Publish everything still pending FROM ONE FEED.
 *
 * Scoped on `feedId` and nothing else. The first version took `--feed <id>`, validated it
 * existed, and then approved every pending shared article regardless of origin — a flag
 * that names a scope and does not apply it. With two shared feeds that means vouching for
 * one publisher silently publishes the other's backlog, and the operator has no way to
 * see it happened. Found by the live check, not by reading the function.
 */
async function approveAll(feedId: string): Promise<void> {
  const feed = await prisma.kbFeed.findUnique({ where: { id: feedId } });
  if (!feed) throw new Error(`no such feed: ${feedId}`);

  const rows = await prisma.kbArticle.findMany({
    where: { ...PENDING, feedId: feed.id },
    select: { id: true, titleNormalized: true, residualLeaks: true },
  });
  if (!rows.length) {
    // Say which feed, or "nothing to do" reads as success on a mistyped id.
    console.log(`Nothing pending from ${feed.url}.`);
    return;
  }

  let published = 0;
  let refused = 0;
  for (const r of rows) {
    if (leaksOf(r.residualLeaks).length > 0) {
      // Bulk must not become the way around the fail-safe.
      console.log(`  skipped (quarantined): ${r.titleNormalized}`);
      refused++;
      continue;
    }
    await prisma.kbArticle.update({ where: { id: r.id }, data: { status: "ready" } });
    published++;
  }
  console.log(`Published ${published} from ${feed.url}, refused ${refused} still-quarantined.`);
}

/**
 * Flipping autoPublish is the point of the whole review queue: you read a few, you decide
 * the publisher is worth trusting, and from then on their items go straight in. It stays a
 * separate deliberate step rather than something `--add` could do by accident.
 */
async function trustFeed(feedId: string): Promise<void> {
  const feed = await prisma.kbFeed.findUnique({ where: { id: feedId } });
  if (!feed) throw new Error(`no such feed: ${feedId}`);
  if (feed.autoPublish) {
    console.log(`Already trusted: ${feed.url}`);
    return;
  }
  await prisma.kbFeed.update({ where: { id: feed.id }, data: { autoPublish: true } });
  console.log(`Trusting ${feed.url}`);
  console.log("  New items from it publish immediately. The brand gates still apply —");
  console.log("  what you have waived is the read-it-first step, not the fail-safe.");
}

async function main(): Promise<void> {
  const showId = arg("show");
  const approveId = arg("approve");
  const rejectId = arg("reject");
  const trustId = arg("trust-feed");
  const feedId = arg("feed");

  if (showId) await show(showId);
  else if (approveId) await approve(approveId);
  else if (rejectId) await reject(rejectId);
  else if (trustId) await trustFeed(trustId);
  else if (has("approve-all")) {
    if (!feedId) throw new Error("--approve-all needs --feed <feedId>");
    await approveAll(feedId);
  } else await list();
}

main()
  .catch((e) => {
    console.error(`\n${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
