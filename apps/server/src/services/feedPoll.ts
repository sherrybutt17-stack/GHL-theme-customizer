import { prisma } from "./prisma";
import { ingestArticle } from "./kbIngest";
import { parseFeed, type FeedItem } from "./feedParse";
import { safeFetch } from "./safeFetch";
import { describeError } from "./security";

/**
 * Poll syndication feeds and ingest whatever is new.
 *
 * This is the "knowledge base keeps itself current" path. It exists because the corpus
 * has a shelf life that nothing in the code can see: the product it describes changes its
 * UI continually, and a bot confidently giving last year's instructions is worse than one
 * that says it doesn't know.
 *
 * WHAT MAKES IT SAFE TO AUTOMATE is that it adds no new trust. Every item goes through
 * the same `ingestArticle` pipeline as a hand-written article — placeholdered at ingest,
 * scanned for residual brand terms, quarantined if anything survives. The gates were
 * always the guarantee; this just points more content at them.
 *
 * WHAT THE GATES DO NOT COVER is accuracy and relevance, which is why a feed publishes to
 * the review queue until somebody marks it trusted (`autoPublish`). A changelog entry
 * ingested as an article makes the bot answer "how do I add a contact" with a release
 * note, and no amount of brand normalization catches that.
 */

const USER_AGENT =
  "MosaicSupportBot/1.0 (+knowledge base for white-label support; contact: dev@growthguild.us)";
const FETCH_TIMEOUT_MS = 20_000;
/**
 * A feed that will not fit in this is not a feed we can use, and an unbounded `text()` on
 * a URL somebody else chose is a way to exhaust a 512MB free instance from outside.
 * Generous against real feeds: a 100-item RSS file with full `content:encoded` bodies is
 * a few hundred KB.
 */
const MAX_FEED_BYTES = 5_000_000;
/** Feed items are usually short. Below this it is a headline, not an article. */
const MIN_ITEM_CHARS = 200;
/** Per poll, so one enormous backfill cannot fill the review queue in a single run. */
const MAX_ITEMS_PER_POLL = 25;
/** Gap between items within a feed and between feeds. Slow on purpose. */
const REQUEST_GAP_MS = 500;
/**
 * After this many consecutive failures the feed stops being polled and says so.
 *
 * Not deleted — a feed that 500s for a week is usually a publisher outage, and silently
 * dropping it means somebody has to remember it existed. Disabled and visible beats gone.
 */
const MAX_CONSECUTIVE_ERRORS = 10;

export interface FeedPollResult {
  feedId: string;
  url: string;
  /** True when the publisher answered 304 and there was nothing to do. */
  notModified: boolean;
  itemsSeen: number;
  created: number;
  updated: number;
  unchanged: number;
  held: number;
  quarantined: number;
  skipped: number;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a feed through the SHARED SSRF guard (`safeFetch`).
 *
 * This used to be a bare `fetch(feed.url, { redirect: "follow" })`. The URL is pasted by
 * an agency into "Your content → Add feed", and the route in front of this validated the
 * SCHEME and nothing else — no address check, no port check, no per-hop revalidation on a
 * redirect chain it handed wholesale to undici, and no size cap on `res.text()`.
 *
 * The identical guard had existed in `brandScan.ts` for months, written after a real
 * bypass and documented at length. It simply lived in one file, so the next feature that
 * needed to fetch a user-supplied URL did not get it — and this one is the worse of the
 * two, because a brand scan turns a response into a colour whereas a feed response is
 * parsed and INGESTED as knowledge-base articles that retrieval can surface into a
 * client's chat. `http://169.254.169.254/latest/meta-data/…` was the whole exploit.
 */
async function fetchFeed(feed: { url: string; etag: string | null; lastModified: string | null }) {
  // Conditional GET. A poll that finds nothing new should cost one 304, not a full
  // download — polling on a schedule without this is how a client gets rate limited.
  const headers: Record<string, string> = {};
  if (feed.etag) headers["if-none-match"] = feed.etag;
  if (feed.lastModified) headers["if-modified-since"] = feed.lastModified;

  const res = await safeFetch(feed.url, {
    maxBytes: MAX_FEED_BYTES,
    timeoutMs: FETCH_TIMEOUT_MS,
    userAgent: USER_AGENT,
    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    headers,
  });
  return {
    status: res.status,
    body: res.status === 200 ? res.buf.toString("utf8") : "",
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
  };
}

/**
 * Newest first, so a `MAX_ITEMS_PER_POLL` cut keeps the most recent rather than whatever
 * order the publisher happened to emit. Undated items sort last — they are usually
 * evergreen pages a feed lists alongside its posts.
 */
function newestFirst(items: FeedItem[]): FeedItem[] {
  return [...items].sort(
    (a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)
  );
}

export async function pollFeed(
  feedId: string,
  opts: { dryRun?: boolean; log?: (msg: string) => void } = {}
): Promise<FeedPollResult> {
  const log = opts.log ?? ((m: string) => console.log(`[feed] ${m}`));
  const feed = await prisma.kbFeed.findUnique({ where: { id: feedId } });
  if (!feed) throw new Error(`no such feed: ${feedId}`);

  const result: FeedPollResult = {
    feedId: feed.id,
    url: feed.url,
    notModified: false,
    itemsSeen: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    held: 0,
    quarantined: 0,
    skipped: 0,
  };

  // An agency's own brand names must become {{PLATFORM}} at ingest, exactly as for
  // hand-authored agency content: ONE article is shared across all their sub-accounts,
  // and those carry DIFFERENT brand names, so hardcoding "Acme Portal" would announce it
  // inside "Beta Hub"'s chat window.
  const ownBrandNames = feed.agencyInstallId ? await agencyBrandNames(feed.agencyInstallId) : [];

  let fetched: Awaited<ReturnType<typeof fetchFeed>>;
  try {
    fetched = await fetchFeed(feed);
  } catch (e) {
    const error = describeError(e);
    await recordFailure(feed.id, feed.consecutiveErrors, error, log);
    return { ...result, error };
  }

  if (fetched.status === 304) {
    result.notModified = true;
    if (!opts.dryRun) {
      await prisma.kbFeed.update({
        where: { id: feed.id },
        data: { lastPolledAt: new Date(), lastError: null, consecutiveErrors: 0 },
      });
    }
    log(`${feed.url} -> 304 not modified`);
    return result;
  }

  if (fetched.status !== 200) {
    const error = `HTTP ${fetched.status}`;
    await recordFailure(feed.id, feed.consecutiveErrors, error, log);
    return { ...result, error };
  }

  let parsed;
  try {
    parsed = parseFeed(fetched.body);
  } catch (e) {
    const error = `unparseable feed: ${describeError(e)}`;
    await recordFailure(feed.id, feed.consecutiveErrors, error, log);
    return { ...result, error };
  }

  const items = newestFirst(parsed.items).slice(0, MAX_ITEMS_PER_POLL);
  result.itemsSeen = parsed.items.length;
  if (parsed.items.length > items.length) {
    // Never let a capped run read as full coverage — the rest arrive on the next poll.
    log(`${feed.url}: ${parsed.items.length} items, taking the newest ${items.length}`);
  }

  let newest: Date | null = null;
  for (const item of items) {
    if (item.publishedAt && (!newest || item.publishedAt > newest)) newest = item.publishedAt;

    if (opts.dryRun) {
      log(`[dry-run] would ingest: ${item.title}`);
      continue;
    }

    const ingested = await ingestArticle(
      { url: item.url, title: item.title, body: item.body, isHtml: true },
      {
        source: feed.source,
        agencyInstallId: feed.agencyInstallId,
        ownBrandNames,
        minBodyChars: MIN_ITEM_CHARS,
        // The safety default: hold for a human unless this feed has earned trust.
        forceReview: !feed.autoPublish,
      }
    );

    if (ingested.status === "created") result.created++;
    else if (ingested.status === "updated") result.updated++;
    else if (ingested.status === "unchanged") result.unchanged++;
    else if (ingested.status === "held") result.held++;
    else if (ingested.status === "quarantined") result.quarantined++;
    else result.skipped++;

    await sleep(REQUEST_GAP_MS);
  }

  if (!opts.dryRun) {
    await prisma.kbFeed.update({
      where: { id: feed.id },
      data: {
        title: feed.title ?? parsed.title,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
        lastPolledAt: new Date(),
        lastItemAt: newest ?? feed.lastItemAt,
        lastError: null,
        consecutiveErrors: 0,
      },
    });
  }

  log(
    `${feed.url}: ${result.created} new, ${result.updated} updated, ${result.unchanged} unchanged, ` +
      `${result.held} awaiting review, ${result.quarantined} quarantined, ${result.skipped} skipped`
  );
  return result;
}

/** Every brand name this agency uses, so none of them survives into a shared article. */
async function agencyBrandNames(agencyInstallId: string): Promise<string[]> {
  const [agency, locations, agencyDefault] = await Promise.all([
    prisma.agencyInstall.findUnique({ where: { id: agencyInstallId }, select: { companyName: true } }),
    prisma.locationInstall.findMany({
      where: { agencyInstallId },
      select: { themeConfigs: { orderBy: { version: "desc" }, take: 1, select: { brandName: true } } },
    }),
    prisma.agencyDefaultTheme.findUnique({
      where: { agencyInstallId },
      select: { brandName: true },
    }),
  ]);

  return [
    agency?.companyName,
    agencyDefault?.brandName,
    ...locations.map((l) => l.themeConfigs[0]?.brandName),
  ].filter((n): n is string => typeof n === "string" && n.trim().length >= 3);
}

async function recordFailure(
  feedId: string,
  previousErrors: number,
  error: string,
  log: (msg: string) => void
): Promise<void> {
  const consecutiveErrors = previousErrors + 1;
  const giveUp = consecutiveErrors >= MAX_CONSECUTIVE_ERRORS;
  await prisma.kbFeed.update({
    where: { id: feedId },
    data: {
      lastPolledAt: new Date(),
      lastError: error,
      consecutiveErrors,
      ...(giveUp ? { enabled: false } : {}),
    },
  });
  log(
    `FAILED (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${error}` +
      (giveUp ? " — disabling this feed; re-enable it once the publisher is back" : "")
  );
}

/** Poll every enabled feed, one at a time. */
export async function pollAllFeeds(
  opts: { dryRun?: boolean; log?: (msg: string) => void } = {}
): Promise<FeedPollResult[]> {
  const feeds = await prisma.kbFeed.findMany({ where: { enabled: true }, orderBy: { createdAt: "asc" } });
  const results: FeedPollResult[] = [];
  for (const feed of feeds) {
    // Serial, with a gap. Concurrency here buys nothing — this is a background job whose
    // wall-clock cost is irrelevant — and costs politeness with every publisher at once.
    results.push(await pollFeed(feed.id, opts));
    await sleep(REQUEST_GAP_MS);
  }
  return results;
}
