import "../services/loadEnv";
import { prisma } from "../services/prisma";
import { pollAllFeeds, pollFeed } from "../services/feedPoll";

/**
 * Poll every enabled knowledge base feed and ingest what is new.
 *
 *   npm run poll-feeds --workspace @ghl-theme-builder/server
 *   npm run poll-feeds --workspace @ghl-theme-builder/server -- --dry-run
 *   npm run poll-feeds --workspace @ghl-theme-builder/server -- --feed <id>
 *   npm run poll-feeds --workspace @ghl-theme-builder/server -- --list
 *   npm run poll-feeds --workspace @ghl-theme-builder/server -- --add <url> [--agency <id>] [--auto]
 *
 * A SCRIPT ON A SCHEDULE, NOT AN INTERVAL IN THE SERVER. Two reasons, both about the
 * hosting this actually runs on: the free web service sleeps after ~15 minutes, so an
 * in-process timer simply stops; and if the service ever runs more than one instance,
 * every instance would poll every feed and race the same upserts. An external scheduler
 * calling this once an hour has neither problem.
 *
 * ALWAYS `--dry-run` a newly added feed first. It shows what would be ingested without
 * writing anything, which is the cheap way to find out that a feed publishes teasers, or
 * changelog entries, rather than articles.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function list(): Promise<void> {
  const feeds = await prisma.kbFeed.findMany({ orderBy: { createdAt: "asc" } });
  if (!feeds.length) {
    console.log("No feeds configured. Add one with:  -- --add <url>");
    return;
  }
  for (const f of feeds) {
    const state = !f.enabled ? "DISABLED" : f.autoPublish ? "auto-publish" : "review queue";
    console.log(
      `${f.id}\n  ${f.url}\n  ${f.title ?? "(untitled)"} · ${f.source} · ${state}` +
        `${f.agencyInstallId ? ` · agency ${f.agencyInstallId}` : " · shared"}` +
        `\n  last polled ${f.lastPolledAt?.toISOString() ?? "never"}` +
        `${f.lastError ? `\n  LAST ERROR (${f.consecutiveErrors}): ${f.lastError}` : ""}`
    );
  }
}

async function add(url: string): Promise<void> {
  const agencyInstallId = arg("agency") ?? null;
  if (agencyInstallId) {
    const agency = await prisma.agencyInstall.findUnique({ where: { id: agencyInstallId } });
    // Fail before writing rather than leaving a feed pointed at nothing.
    if (!agency) throw new Error(`no such agency: ${agencyInstallId}`);
  }
  try {
    new URL(url);
  } catch {
    throw new Error(`not a valid URL: ${url}`);
  }

  const feed = await prisma.kbFeed.create({
    data: {
      url,
      agencyInstallId,
      // An agency's own feed is THEIR content: ranked above shared at retrieval, and
      // brand-stripped with their own names at ingest.
      source: agencyInstallId ? "agency" : "ghl",
      autoPublish: has("auto"),
    },
  });

  console.log(`Added feed ${feed.id}`);
  console.log(
    feed.autoPublish
      ? `  Publishing AUTOMATICALLY. Dry-run it first if you have not seen its output:\n` +
          `    npm run poll-feeds --workspace @ghl-theme-builder/server -- --feed ${feed.id} --dry-run`
      : `  Items will wait in the review queue. Once you have read a few and trust the feed,\n` +
          `  set autoPublish on it.`
  );
}

async function main(): Promise<void> {
  const dryRun = has("dry-run");

  if (has("list")) {
    await list();
    return;
  }

  const addUrl = arg("add");
  if (addUrl) {
    await add(addUrl);
    return;
  }

  const feedId = arg("feed");
  const results = feedId ? [await pollFeed(feedId, { dryRun })] : await pollAllFeeds({ dryRun });

  if (!results.length) {
    console.log("No enabled feeds. Add one with:  -- --add <url>");
    return;
  }

  const total = results.reduce(
    (acc, r) => ({
      created: acc.created + r.created,
      updated: acc.updated + r.updated,
      held: acc.held + r.held,
      quarantined: acc.quarantined + r.quarantined,
      errors: acc.errors + (r.error ? 1 : 0),
    }),
    { created: 0, updated: 0, held: 0, quarantined: 0, errors: 0 }
  );

  console.log(
    `\n${results.length} feed(s): ${total.created} new, ${total.updated} updated, ` +
      `${total.held} awaiting review, ${total.quarantined} quarantined, ${total.errors} failed`
  );
  if (dryRun) console.log("Dry run — nothing was written.");
  if (total.held) {
    console.log(
      `\n${total.held} article(s) are in the review queue and are NOT retrievable yet. That is\n` +
        `the default for a feed nobody has vouched for: the gates prove an item names no\n` +
        `vendor, not that it is accurate or even a how-to.`
    );
  }
  if (total.quarantined) {
    console.log(
      `\n${total.quarantined} article(s) were QUARANTINED — a brand term survived normalization.\n` +
        `That is the fail-safe working. Fix the wording or teach brandLexicon.ts the term.`
    );
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
