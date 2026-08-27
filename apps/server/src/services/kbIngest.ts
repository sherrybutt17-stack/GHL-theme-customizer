import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import { normalizeArticle, PLATFORM_PLACEHOLDER } from "./kbNormalize";
import { safeFetch } from "./safeFetch";
import { describeError } from "./security";
import type { KbSource } from "@prisma/client";

/**
 * Ingest help content into the knowledge base.
 *
 * Every article is stored ONCE, brand-neutral: "GoHighLevel" becomes {{PLATFORM}} and
 * "Opportunities" becomes {{FEATURE:opportunities}} before it ever touches the
 * database. Per-agency wording is a substitution at answer time, not a stored copy -
 * which is why an agency renaming a menu item takes effect on the next answer with no
 * re-ingest.
 *
 * Two properties this module is responsible for:
 *   1. NOTHING BRAND-SHAPED BECOMES RETRIEVABLE. If normalization leaves a residual,
 *      the row is stored `needs_review` and retrieval skips it. Quarantine, not leak.
 *   2. POLITE CRAWLING. robots.txt is honoured, requests are serialised with a delay,
 *      and only excerpts are kept - we never mirror an article wholesale.
 */

/** Be identifiable. An anonymous crawler is the kind that gets blocked, deservedly. */
const USER_AGENT =
  "MosaicSupportBot/1.0 (+knowledge base for white-label support; contact: dev@growthguild.us)";

/** Serialised requests with this gap between them. Slow on purpose. */
const CRAWL_DELAY_MS = 1500;
const FETCH_TIMEOUT_MS = 15_000;
/** A help-centre page or sitemap larger than this is not one we can use. */
const MAX_CRAWL_BYTES = 5_000_000;
/** Below this, the "article" is a nav stub or an error page, not content. */
const MIN_BODY_CHARS = 200;

export interface RawArticle {
  url?: string;
  title: string;
  /** Raw HTML or plain text. */
  body: string;
  isHtml?: boolean;
}

export interface IngestResult {
  /**
   * `quarantined` — a brand term survived normalization. The fail-safe fired.
   * `held`        — normalized clean, but waiting on a human because its feed is not
   *                 trusted to publish unattended. Same invisibility, different reason,
   *                 and the review queue must not report it as a brand leak.
   */
  status: "created" | "updated" | "unchanged" | "quarantined" | "held" | "skipped";
  id?: string;
  reason?: string;
  residualCount?: number;
}

/** Hash the RAW source so a recrawl can tell changed from unchanged cheaply. */
function hashContent(a: RawArticle): string {
  return createHash("sha256").update(`${a.title}\0${a.body}`).digest("hex");
}

/**
 * Normalize and store one article.
 *
 * The residual check is the fail-safe and it is not advisory: an article whose
 * normalized body still trips the brand lexicon is written as `needs_review` with the
 * offending matches recorded, and retrieval never sees it. A term the lexicon doesn't
 * yet know therefore costs us one unavailable article - not a brand leak into a
 * client's chat window.
 */
export async function ingestArticle(
  raw: RawArticle,
  opts: {
    source: KbSource;
    agencyInstallId?: string | null;
    /**
     * The agency's OWN brand names, replaced with {{PLATFORM}} before normalization.
     *
     * Only relevant for agency-authored content, and it is not a nicety. One agency
     * article is shared across ALL their sub-accounts, and each sub-account can carry a
     * different brandName - so an article that hardcodes "Acme Portal" would announce
     * brand A's name inside brand B's chat window. Same placeholder-at-ingest principle
     * as the vendor name, applied to their own brands.
     */
    ownBrandNames?: string[];
    /**
     * Override the "this is a nav stub, not an article" floor. That threshold exists to
     * reject crawled junk; a hand-written SOP can legitimately be two sentences.
     */
    minBodyChars?: number;
    /**
     * Hold the article for review even when normalization left nothing behind.
     *
     * The residual scan proves an article names no vendor. It cannot prove the article is
     * accurate, current, or even a how-to — so anything arriving unattended from a feed
     * waits for a human unless that feed has been explicitly trusted. Same storage and
     * the same invisibility to retrieval as a quarantine; a different reason, which is
     * why `residualLeaks` stays empty and the review queue can tell them apart.
     */
    forceReview?: boolean;
    /**
     * Which feed this arrived from, so one publisher's items can be acted on as a group.
     * Absent for hand-written and crawled content, which have no feed.
     */
    feedId?: string | null;
    /**
     * Normalize, classify and report — writing NOTHING.
     *
     * This has to live here rather than in the caller, and it did not: `crawlHelpCenter`
     * called this function unconditionally and then checked its own `dryRun` flag only to
     * decide how to LOG the result. So `--dry-run` printed "DRY RUN - nothing will be
     * written" and then wrote every article it visited. Measured on a cleared database: a
     * 3-page dry run left 2 rows behind.
     *
     * That inverts the one procedure this repo insists on ("ALWAYS dry-run first"), and it
     * is worst exactly where it is used most — pointing the crawler at an unfamiliar site
     * to see what extraction produces, which is precisely when you do not want the result
     * in your corpus. It is how 60 rows of navigation furniture got in.
     */
    dryRun?: boolean;
  }
): Promise<IngestResult> {
  const contentHash = hashContent(raw);

  if (raw.url) {
    const existing = await prisma.kbArticle.findUnique({ where: { sourceUrl: raw.url } });
    if (existing && existing.contentHash === contentHash) {
      // Unchanged upstream. Touch the crawl timestamp so staleness reporting stays
      // honest, but skip re-normalizing and (importantly) skip re-quarantining an
      // article a human already reviewed.
      //
      // Also adopt the feed link if it is missing. That is not inference: this poll is
      // fetching this exact URL from this exact feed right now, so the origin is a fact.
      // Without it, rows ingested before `feedId` existed could never acquire one — the
      // short-circuit above means an unchanged item is never rewritten — and they would
      // stay permanently unreachable from `--approve-all --feed`, which is precisely the
      // group action they need. Only ever fills a NULL; it never re-points an article at
      // a different feed.
      if (!opts.dryRun) {
        await prisma.kbArticle.update({
          where: { id: existing.id },
          data: {
            lastCrawledAt: new Date(),
            ...(existing.feedId == null && opts.feedId ? { feedId: opts.feedId } : {}),
          },
        });
      }
      return { status: "unchanged", id: existing.id };
    }
  }

  // Swap the agency's own brand names for the placeholder BEFORE normalization, so the
  // stored copy is neutral for every one of their sub-accounts. Longest first, or
  // "Acme" would chop up "Acme Portal" and leave a stray "Portal" behind.
  const stripOwnBrands = (text: string): string => {
    let out = text;
    for (const name of [...(opts.ownBrandNames ?? [])].sort((a, b) => b.length - a.length)) {
      const clean = name.trim();
      if (clean.length < 3) continue; // too short to match safely against ordinary prose
      out = out.replace(new RegExp(clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), PLATFORM_PLACEHOLDER);
    }
    return out;
  };

  const normalized = normalizeArticle({
    title: stripOwnBrands(raw.title),
    body: stripOwnBrands(raw.body),
    isHtml: raw.isHtml,
  });

  const floor = opts.minBodyChars ?? MIN_BODY_CHARS;
  if (normalized.bodyNormalized.length < floor) {
    return { status: "skipped", reason: `body too short (${normalized.bodyNormalized.length} chars, minimum ${floor})` };
  }

  const quarantined = normalized.residualLeaks.length > 0;
  const held = quarantined || opts.forceReview === true;
  const data = {
    source: opts.source,
    agencyInstallId: opts.agencyInstallId ?? null,
    feedId: opts.feedId ?? null,
    sourceUrl: raw.url ?? null,
    titleNormalized: normalized.titleNormalized,
    bodyNormalized: normalized.bodyNormalized,
    contentHash,
    featureTags: normalized.featureTags,
    status: held ? ("needs_review" as const) : ("ready" as const),
    // Only ever populated by the residual scan. An article held for review because its
    // feed is untrusted has nothing to report here, and the queue reads the difference.
    residualLeaks: quarantined ? (normalized.residualLeaks as unknown as object) : undefined,
    lastCrawledAt: new Date(),
  };

  if (opts.dryRun) {
    // Everything above is pure computation — the hash, the normalization, the residual
    // scan — so the classification here is exactly what a real run would store. Reported
    // WITHOUT the write, which is the entire promise the flag makes.
    const existingId = raw.url
      ? (await prisma.kbArticle.findUnique({ where: { sourceUrl: raw.url }, select: { id: true } }))?.id
      : undefined;
    if (quarantined) {
      return { status: "quarantined", id: existingId, residualCount: normalized.residualLeaks.length };
    }
    if (held) {
      return { status: "held", id: existingId, reason: "awaiting review (feed is not set to publish automatically)" };
    }
    return { status: existingId ? "updated" : "created", id: existingId };
  }

  const row = raw.url
    ? await prisma.kbArticle.upsert({ where: { sourceUrl: raw.url }, create: data, update: data })
    : await prisma.kbArticle.create({ data });

  if (quarantined) {
    console.warn(
      `[kb] QUARANTINED ${raw.url ?? row.id}: ${normalized.residualLeaks.length} residual brand term(s) - ` +
        normalized.residualLeaks.map((l) => `${l.id}:"${l.match}"`).join(", ")
    );
    return { status: "quarantined", id: row.id, residualCount: normalized.residualLeaks.length };
  }
  if (held) {
    return { status: "held", id: row.id, reason: "awaiting review (feed is not set to publish automatically)" };
  }
  return { status: row.createdAt.getTime() === row.updatedAt.getTime() ? "created" : "updated", id: row.id };
}

// --- Crawling -------------------------------------------------------------------

/**
 * Minimal robots.txt evaluation for OUR user-agent.
 *
 * Not a full spec implementation - it reads the `*` group plus any group naming us,
 * and collects Disallow prefixes. Deliberately fails CLOSED in one direction only: if
 * robots.txt can't be fetched we proceed (a missing file means no restrictions), but
 * any rule we DO parse is obeyed.
 */
export interface RobotsRules {
  disallow: string[];
  crawlDelayMs: number;
}

export function parseRobots(text: string, agent = "mosaicsupportbot"): RobotsRules {
  const rules: RobotsRules = { disallow: [], crawlDelayMs: CRAWL_DELAY_MS };
  let applies = false;
  for (const line of text.split("\n")) {
    const clean = line.replace(/#.*$/, "").trim();
    if (!clean) continue;
    const [rawKey, ...rest] = clean.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      const ua = value.toLowerCase();
      applies = ua === "*" || ua.includes(agent);
      continue;
    }
    if (!applies) continue;
    if (key === "disallow" && value) rules.disallow.push(value);
    // Honour a site's stated crawl delay when it is SLOWER than ours; never faster.
    if (key === "crawl-delay") {
      const secs = Number(value);
      if (Number.isFinite(secs) && secs * 1000 > rules.crawlDelayMs) rules.crawlDelayMs = secs * 1000;
    }
  }
  return rules;
}

export function isAllowed(pathname: string, rules: RobotsRules): boolean {
  return !rules.disallow.some((prefix) => prefix !== "" && pathname.startsWith(prefix));
}

/**
 * Every fetch the crawler makes, through the shared SSRF guard.
 *
 * Lower risk than the feed path — `crawlHelpCenter` is reachable only from the
 * `crawl-kb` CLI, so no route lets a stranger choose the origin — but not zero, and the
 * two holes were both in URLs the crawler did NOT get from the operator:
 *
 *  - `redirect: "follow"` handed the whole chain to undici, so a page at the operator's
 *    own origin (which the `parsed.origin !== opts.origin` filter does check) could 302
 *    anywhere at all, and THAT response is what gets ingested.
 *  - nested sitemaps are fetched from whatever `<loc>` entries the remote sitemap lists,
 *    before the origin filter applies. The body is discarded, so it is a blind request —
 *    which against `169.254.169.254` is exactly the request worth making.
 *
 * Fixing it here is mostly about the invariant: "anything that fetches a URL somebody
 * else chose goes through `safeFetch`" has to be true, or it is one more piece of
 * written-down reasoning with a path around it.
 */
async function fetchText(url: string): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await safeFetch(url, {
    maxBytes: MAX_CRAWL_BYTES,
    timeoutMs: FETCH_TIMEOUT_MS,
    userAgent: USER_AGENT,
    accept: "text/html,text/plain,*/*",
  });
  const ok = res.status >= 200 && res.status < 300;
  return { ok, status: res.status, body: ok ? res.buf.toString("utf8") : "" };
}

/** Pull <loc> entries out of a sitemap or sitemap index. */
export function parseSitemap(xml: string): string[] {
  const urls: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) urls.push(m[1].trim());
  return urls;
}

/**
 * Strip help-centre chrome that survived extraction, at the TEXT level.
 *
 * `extractMainContent` below already argues the case — "every article carries the same
 * boilerplate, which poisons ranking (every article matches every query)" — and then the
 * corpus walked straight into it: none of its container patterns match a Freshdesk portal,
 * so 424 of 1,190 crawled articles (36%) fell through to `<body>` and were stored with the
 * whole page. Measured on the live corpus, every one of them opens:
 *
 *   • Home • Knowledge base • X • Y • <title> All Articles Recent Searches Clear all
 *   No recent searches Popular Articles Articles View all Topics View all Tickets View all
 *   Sorry! nothing found for <title> Modified on: Thu, 4 Dec, 2025 at 4:59 PM
 *
 * …and only then the article. Archiving those 424 took "the wanted article is in the top 5"
 * from 20/30 to 24/30, so the boilerplate demonstrably crowds out real answers.
 *
 * Done on TEXT, not markup, deliberately. A markup fix needs the portal's live HTML in
 * front of you and only helps the next crawl; this also repairs what is already stored, and
 * it works whatever wrapper the vendor ships next. It is narrow on purpose:
 *
 *   - the nav markers must be present, so a normal article is never touched;
 *   - the cut is anchored to Freshdesk's own "Modified on: <date>" line, which is the last
 *     thing before the prose and cannot be confused with body text;
 *   - it refuses to cut more than MAX_CHROME_CHARS or to leave less than MIN_BODY_CHARS,
 *     because a stripper that can empty an article is worse than the chrome.
 */
const MAX_CHROME_CHARS = 2000;
const CHROME_MARKERS = ["Recent Searches", "All Articles", "Popular Articles"];
const MODIFIED_ON = /Modified on:\s*[A-Za-z]{3},\s*\d{1,2}\s+[A-Za-z]{3},\s*\d{4}\s+at\s+\d{1,2}:\d{2}\s*[AP]M/;

export function stripHelpCentreChrome(text: string): string {
  let out = text;

  const head = out.slice(0, MAX_CHROME_CHARS);
  const marked = CHROME_MARKERS.filter((m) => head.includes(m)).length;
  const m = MODIFIED_ON.exec(head);
  // Two independent signals, because either alone has a plausible innocent explanation:
  // an article may mention "Popular Articles", and a changelog may print a modified date.
  if (marked >= 2 && m) {
    const cut = out.slice(m.index + m[0].length).replace(/^[\s•]+/, "");
    if (cut.length >= MIN_BODY_CHARS) out = cut;
  }

  // The portal's search overlay leaves this on the end of every page.
  out = out.replace(/\s*X\s+0 of 0\s*$/, "");
  return out.trim();
}

/**
 * Freshdesk serves the portal name in <title>, so the stored title reads
 * "Text-To-Pay Links: {{PLATFORM}} Support Portal". Titles are weighted A — the highest
 * weight in the tsvector — so this is the most expensive place in the row to carry three
 * words that say nothing about the article.
 *
 * Handles both separators seen live: a colon, and a title that already ends in "?".
 */
export function stripPortalSuffix(title: string): string {
  const cut = title.replace(/[\s:|–—-]*\{\{PLATFORM\}\}\s+Support Portal\s*$/, "").trim();
  return cut.length ? cut.replace(/[:\s]+$/, "") : title;
}

/** Best-effort <title>, falling back to the first heading. */
export function extractTitle(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (title?.trim()) return title.trim();
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  return h1?.replace(/<[^>]+>/g, " ").trim() || "Untitled";
}

/**
 * Narrow an article page to its main content.
 *
 * Help centres wrap the article in navigation, footers and "related articles" blocks.
 * Ingesting those means every article carries the same boilerplate, which poisons
 * ranking (every article matches every query) far more than it helps. Falls back to
 * the whole body when no known container is present.
 */
export function extractMainContent(html: string): string {
  const containers = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<div\b[^>]*class="[^"]*\b(?:article-body|article__body|content-body|post-content)\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];
  for (const re of containers) {
    const m = re.exec(html);
    if (m && m[1].length > MIN_BODY_CHARS) return m[1];
  }
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  return body?.[1] ?? html;
}

export interface CrawlOptions {
  /** Origin to crawl, e.g. "https://help.example.com". */
  origin: string;
  /** Only ingest URLs whose path starts with one of these. */
  pathPrefixes?: string[];
  /**
   * Skip URLs already crawled within this many days, WITHOUT fetching them.
   *
   * `ingestArticle` already short-circuits an unchanged article on its content hash — but
   * only after the page has been downloaded, so a resumed run still spends one request per
   * article it is about to discard. That is what makes a large help centre uncrawlable:
   * help.gohighlevel.com rate-limits by requests-per-hour, so a resume that re-fetches
   * 1,062 known articles exhausts the budget before reaching a single new one, and the
   * crawl can never finish however many times it is run.
   *
   * Skipping them here makes the crawl RESUMABLE — each run picks up where the last
   * stopped — and is also simply politer: re-downloading a thousand pages to learn nothing
   * is the behaviour that got us blocked in the first place.
   *
   * Defaults to 7 days, so a periodic re-crawl still refreshes content that has changed.
   * `0` disables skipping and re-fetches everything.
   */
  refetchAfterDays?: number;
  /**
   * Where the sitemap actually lives, when it is not at `/sitemap.xml`.
   *
   * Assuming the root is wrong for a large share of real help centres: Freshdesk (which is
   * what help.gohighlevel.com runs) publishes at `/support/sitemap.xml` and returns 404 at
   * the root. The failure was quiet in the worst way — "no sitemap - nothing to crawl",
   * summary all zeros, exit 0 — which reads as "that site has no crawlable content"
   * rather than "we looked in one place".
   *
   * Must be same-origin as `origin`: it selects what gets ingested, so accepting an
   * arbitrary host would let one site's sitemap direct the crawl of another.
   */
  sitemapUrl?: string;
  /** Hard cap, so a misconfigured run can't hammer a host or fill the database. */
  maxPages: number;
  /** Parse and normalize but write nothing. Use this first, always. */
  dryRun?: boolean;
  onProgress?: (msg: string) => void;
}

/**
 * Freshdesk publishes every article as JSON at `<article-url>.json`, and on a JS-rendered
 * portal that is the ONLY way to get the actual text.
 *
 * help.gohighlevel.com is exactly that: 172KB of HTML per article containing no article
 * body at all — the prose arrives via JS. `extractMainContent` therefore returned the
 * portal shell ("• Home • Knowledge base • Surveys … All Articles Recent Searches … Sorry!
 * nothing found"), which is 4KB of text and sails past the 200-char nav-stub floor.
 *
 * THAT IS THE DANGEROUS PART. The chrome contains no vendor name and no URL, so it passed
 * every gate: 60 articles ingested `ready`, 0 quarantined, and the corpus would have gained
 * 2,854 rows of navigation furniture that retrieval happily serves to real clients. The
 * brand gates prove an article is SAFE; nothing proved it was an ARTICLE.
 */
interface StructuredArticle {
  title: string;
  body: string;
}

/** Freshdesk `status`: 1 = draft, 2 = published. A draft must never reach a client. */
const FRESHDESK_PUBLISHED = 2;

/**
 * Absent and REFUSED are different answers and must never collapse into one.
 *
 * The first version returned `null` for both, and that was the most damaging bug in this
 * whole crawl: once the host started rate-limiting, every `.json` came back 403, every
 * article read as "this one has no JSON", and the caller marked it `archived` with
 * `lastCrawledAt` set — which the resume filter then skips FOREVER. A rate limit silently
 * and permanently retired 584 perfectly good articles, and because that path never calls
 * `fetchText`, the consecutive-refusal guard never saw a single refusal to count.
 *
 * A crawler must be able to tell "there is nothing here" from "you are not allowed to ask".
 */
type StructuredResult =
  | { kind: "article"; article: StructuredArticle }
  /** Genuinely no JSON for this URL (404), or it is not an article endpoint. */
  | { kind: "absent" }
  /** The host refused us — rate limit, block, or an outage. Applies to every URL. */
  | { kind: "refused"; status: number };

async function fetchStructuredArticle(url: string): Promise<StructuredResult> {
  if (!/\/solutions\/articles\//.test(url)) return { kind: "absent" };
  let parsed: unknown;
  try {
    const res = await fetchText(`${url}.json`);
    if (!res.ok) {
      // 404/410 mean this article has no JSON. Anything else — 401, 403, 429, 5xx — is the
      // host declining to answer, which says nothing about the article.
      return res.status === 404 || res.status === 410
        ? { kind: "absent" }
        : { kind: "refused", status: res.status };
    }
    parsed = JSON.parse(res.body);
  } catch {
    // Not a Freshdesk portal, or it does not expose JSON. The HTML path still applies.
    return { kind: "absent" };
  }
  const article = (parsed as { article?: Record<string, unknown> })?.article;
  if (!article) return { kind: "absent" };
  if (typeof article.status === "number" && article.status !== FRESHDESK_PUBLISHED) {
    return { kind: "absent" };
  }
  const title = typeof article.title === "string" ? article.title : "";
  // `description` is the authored HTML; `desc_un_html` is its flattened twin. Prefer the
  // HTML so the existing normalizer sees list and heading structure rather than a wall.
  const body =
    typeof article.description === "string" && article.description.trim()
      ? article.description
      : typeof article.desc_un_html === "string"
        ? article.desc_un_html
        : "";
  if (!title || !body) return { kind: "absent" };
  return { kind: "article", article: { title, body } };
}

export interface CrawlSummary {
  discovered: number;
  attempted: number;
  created: number;
  updated: number;
  unchanged: number;
  quarantined: number;
  skipped: number;
  failed: number;
  /** Set when the run stopped at maxPages, so a silent truncation is never implied. */
  truncated: boolean;
  /** Why the run stopped early, when it did. Absent on a run that reached the end. */
  abortReason?: string;
  /** Skipped without a request because they were crawled recently. */
  alreadyHave?: number;
}

/**
 * Crawl a help centre via its sitemap and ingest what it finds.
 *
 * Sitemap-driven rather than link-following: it's what the site publishes as its own
 * index, it avoids crawling the same page through five different paths, and it makes
 * the work bounded and predictable.
 */
export async function crawlHelpCenter(opts: CrawlOptions): Promise<CrawlSummary> {
  const log = opts.onProgress ?? ((m: string) => console.log(`[kb] ${m}`));
  const summary: CrawlSummary = {
    discovered: 0, attempted: 0, created: 0, updated: 0,
    unchanged: 0, quarantined: 0, skipped: 0, failed: 0, truncated: false,
  };

  let rules: RobotsRules = { disallow: [], crawlDelayMs: CRAWL_DELAY_MS };
  try {
    const robots = await fetchText(new URL("/robots.txt", opts.origin).toString());
    if (robots.ok) {
      rules = parseRobots(robots.body);
      log(`robots.txt: ${rules.disallow.length} disallow rule(s), delay ${rules.crawlDelayMs}ms`);
    } else {
      log(`robots.txt returned ${robots.status}; proceeding with default delay`);
    }
  } catch (e) {
    log(`robots.txt fetch failed (${describeError(e)}); proceeding with default delay`);
  }

  // Sitemap, then any nested sitemaps one level deep.
  const seen = new Set<string>();
  const queue: string[] = [];
  try {
    const sitemapUrl = new URL(opts.sitemapUrl ?? "/sitemap.xml", opts.origin);
    if (sitemapUrl.origin !== new URL(opts.origin).origin) {
      throw new Error(
        `sitemap ${sitemapUrl.origin} is not on ${opts.origin} — the sitemap chooses what gets ingested, so it must belong to the site being crawled`
      );
    }
    const sm = await fetchText(sitemapUrl.toString());
    if (!sm.ok) {
      // Name the URL actually tried. "No sitemap" for a site that has one somewhere else
      // reads as "nothing to crawl here", which is a different and wrong conclusion.
      log(`no sitemap at ${sitemapUrl.pathname} (HTTP ${sm.status}) - nothing to crawl`);
      log(`  if this site publishes one elsewhere, pass --sitemap <path> (Freshdesk uses /support/sitemap.xml)`);
      return summary;
    }
    for (const url of parseSitemap(sm.body)) {
      if (/\.xml($|\?)/i.test(url)) {
        await new Promise((r) => setTimeout(r, rules.crawlDelayMs));
        // Its own try: these URLs come from the REMOTE sitemap, not the operator, so one
        // entry the guard refuses (or one dead link) must skip that entry rather than
        // abort the crawl from the outer catch. Previously only a network error could
        // land here; now a blocked host can, which makes the difference matter.
        try {
          const nested = await fetchText(url);
          if (nested.ok) for (const u of parseSitemap(nested.body)) queue.push(u);
        } catch (e) {
          log(`nested sitemap skipped (${describeError(e)}): ${url}`);
        }
      } else {
        queue.push(url);
      }
    }
  } catch (e) {
    log(`sitemap fetch failed: ${describeError(e)}`);
    return summary;
  }

  const candidates = queue.filter((u) => {
    try {
      const parsed = new URL(u);
      if (parsed.origin !== new URL(opts.origin).origin) return false;
      if (!isAllowed(parsed.pathname, rules)) return false;
      if (opts.pathPrefixes?.length && !opts.pathPrefixes.some((p) => parsed.pathname.startsWith(p))) return false;
      if (seen.has(parsed.toString())) return false;
      seen.add(parsed.toString());
      return true;
    } catch {
      return false;
    }
  });

  summary.discovered = candidates.length;

  // Drop what we already have, BEFORE spending a request on it. See `refetchAfterDays`.
  const refetchAfterDays = opts.refetchAfterDays ?? 7;
  let fresh = candidates;
  if (refetchAfterDays > 0) {
    const cutoff = new Date(Date.now() - refetchAfterDays * 86_400_000);
    const known = await prisma.kbArticle.findMany({
      where: { sourceUrl: { in: candidates }, lastCrawledAt: { gte: cutoff } },
      select: { sourceUrl: true },
    });
    const skip = new Set(known.map((k) => k.sourceUrl));
    fresh = candidates.filter((u) => !skip.has(u));
    if (skip.size > 0) {
      summary.alreadyHave = skip.size;
      log(`${skip.size} already crawled within ${refetchAfterDays}d - skipping without fetching`);
    }
  }

  const targets = fresh.slice(0, opts.maxPages);
  summary.truncated = fresh.length > targets.length;
  log(`${candidates.length} candidate URL(s), ${fresh.length} not yet crawled; crawling ${targets.length}${summary.truncated ? " (capped)" : ""}`);

  /*
   * TEMPLATE DETECTOR — the guard for the failure above, in the general case.
   *
   * When extraction silently returns page furniture instead of content, every page yields
   * nearly the SAME text. Nothing else notices: it is long enough to clear the nav-stub
   * floor, it names no vendor, it carries no link, so it ingests `ready` and retrieval
   * serves it. The single reliable signal is the repetition itself.
   *
   * So: fingerprint each body's opening, and if one fingerprint dominates the run, stop.
   * Aborting mid-crawl is right — the alternative is thousands of rows that must then be
   * identified and deleted, and a corpus nobody trusts in the meantime.
   */
  const shapes = new Map<string, { n: number; sample: string }>();
  const SHAPE_MIN_SAMPLE = 8;
  const SHAPE_DOMINANCE = 0.6;
  let structuredHits = 0;
  /**
   * Set when the run must stop for a reason that applies to EVERY remaining URL.
   *
   * It has to live outside the per-article `try`, because that block's `catch` counts a
   * failure and moves to the next URL — which is right for one dead link and exactly wrong
   * for "the host is refusing us". The first version threw from inside it, so the abort was
   * swallowed and the crawl made **217 further requests to a server that had already said
   * stop**. Being told to back off and continuing anyway is the one crawler behaviour that
   * earns a permanent block.
   */
  let abort: string | null = null;
  /** Consecutive non-2xx responses — the shape of a rate limit, not of a broken link. */
  let consecutiveRefusals = 0;
  const MAX_CONSECUTIVE_REFUSALS = 5;

  for (const url of targets) {
    if (abort) break;
    // Serialised, with a delay. Concurrency here would be rude and would get us
    // blocked; the whole run is a background job, so wall-clock cost is irrelevant.
    await new Promise((r) => setTimeout(r, rules.crawlDelayMs));
    summary.attempted++;
    try {
      // Structured first: on a JS-rendered portal the HTML has no article in it at all.
      const structured = await fetchStructuredArticle(url);

      // A refusal is about the HOST, not this article. Count it and let the same guard that
      // watches HTML refusals stop the run — otherwise a rate limit is read as "none of
      // these articles exist" and permanently retires every one of them.
      if (structured.kind === "refused") {
        summary.failed++;
        log(`HTTP ${structured.status} for ${url}.json`);
        if (++consecutiveRefusals >= MAX_CONSECUTIVE_REFUSALS) {
          abort =
            `${consecutiveRefusals} consecutive refusals from the host (last: HTTP ${structured.status}). ` +
            `That is a rate limit or a block, not a bad link — stopping rather than making it worse. ` +
            `Re-run later; already-ingested articles short-circuit on their content hash, so nothing is redone.`;
        }
        continue;
      }

      let title: string;
      let body: string;
      if (structured.kind === "article") {
        // Reset ONLY on content actually obtained. An unconditional reset here (which is
        // what I first wrote) runs before the HTML branch below has had a chance to count
        // its own refusal, so the counter is zeroed every iteration and never reaches the
        // threshold — the guard looks present and can never fire.
        consecutiveRefusals = 0;
        structuredHits++;
        ({ title, body } = structured.article);
      } else if (structuredHits > 0) {
        /*
         * The portal publishes JSON — it has done so for every article so far — and this
         * URL did not answer with any. Do NOT fall back to HTML here: on a JS-rendered
         * portal the HTML carries no article at all, so the fallback can only ever return
         * the page shell, which is long enough to pass the length floor and clean enough to
         * pass every brand gate.
         *
         * Measured: a 600-article resume produced 41 shells out of 68 pages and tripped the
         * template detector, which aborted the whole run. The pages were not the problem —
         * the fallback was. Skipping them lets the crawl continue past a handful of
         * articles that simply have no JSON, instead of stopping on them.
         */
        summary.skipped++;
        log(`no JSON for ${url} on a portal that publishes it - skipping rather than storing the page shell`);
        if (!opts.dryRun) {
          await prisma.kbArticle
            .upsert({
              where: { sourceUrl: url },
              create: {
                source: "ghl", sourceUrl: url, titleNormalized: url, bodyNormalized: "",
                contentHash: `no-json:${url}`, featureTags: [], status: "archived",
                lastCrawledAt: new Date(),
              },
              update: { lastCrawledAt: new Date() },
            })
            .catch(() => {});
        }
        continue;
      } else {
        const page = await fetchText(url);
        if (!page.ok) {
          summary.failed++;
          log(`HTTP ${page.status} for ${url}`);
          // A run of refusals is a host saying stop — a rate limit, a block, an outage —
          // and it applies to every URL left, not just this one. Measured: GHL answers
          // `403 "You have exceeded the limit of requests per hour"` after a few hundred
          // requests in an hour, and the old code read each one as a single dead link and
          // kept going. One dead link among successes still costs nothing: any 2xx resets
          // the counter.
          if (++consecutiveRefusals >= MAX_CONSECUTIVE_REFUSALS) {
            abort =
              `${consecutiveRefusals} consecutive refusals from the host (last: HTTP ${page.status}). ` +
              `That is a rate limit or a block, not a bad link — stopping rather than making it worse. ` +
              `Re-run later; already-ingested articles short-circuit on their content hash, so nothing is redone.`;
          }
          continue;
        }
        consecutiveRefusals = 0;
        // Both strippers run on the HTML path only. A JSON body carries no chrome, so
        // applying them there would be a no-op that still has to be reasoned about.
        title = stripPortalSuffix(extractTitle(page.body));
        body = stripHelpCentreChrome(extractMainContent(page.body));
      }

      const normalisedOpening = body.replace(/\s+/g, " ").trim().slice(0, 300);
      const shape = createHash("sha256").update(normalisedOpening).digest("hex");
      const seenShape = shapes.get(shape) ?? { n: 0, sample: normalisedOpening };
      seenShape.n++;
      shapes.set(shape, seenShape);
      if (summary.attempted >= SHAPE_MIN_SAMPLE) {
        const [worstHash, worst] = [...shapes.entries()].sort((a, b) => b[1].n - a[1].n)[0];
        if (worst.n / summary.attempted >= SHAPE_DOMINANCE) {
          // Report the DOMINANT shape's own text, not whatever page happened to be in hand
          // when the threshold tripped. The first version printed the current page, which
          // showed a perfectly good article beside a claim that everything looked alike —
          // so the report argued against itself and I misread a true positive as a false one.
          abort =
            `${worst.n} of ${summary.attempted} pages produced near-identical text, so extraction is ` +
            `returning the same thing for every URL rather than articles. This can pass every brand gate — ` +
            `it names no vendor and carries no link — so nothing downstream would catch it. ` +
            `The repeated text (shape ${worstHash.slice(0, 8)}): ${JSON.stringify(worst.sample.slice(0, 160))}`;
          continue;
        }
      }

      const result = await ingestArticle(
        { url, title, body, isHtml: true },
        { source: "ghl", dryRun: opts.dryRun }
      );
      if (opts.dryRun) {
        log(`[dry-run] would ${result.status}: ${url}${result.reason ? ` (${result.reason})` : ""}`);
        // Counted even on a dry run — the summary is the whole point of doing one, and
        // reporting all zeros made a dry run look like it had found nothing to do.
      }
      summary[result.status === "created" ? "created"
        : result.status === "updated" ? "updated"
        : result.status === "unchanged" ? "unchanged"
        : result.status === "quarantined" ? "quarantined"
        : "skipped"]++;

      /*
       * REMEMBER what we decided not to keep, or the crawl never finishes.
       *
       * A quarter of this help centre is video-only — the body is a bare Loom iframe — and
       * those are correctly skipped, since a text-retrieval bot cannot use a video. But a
       * skip writes no row, so the resume filter sees them as "not yet crawled" and fetches
       * them again on every pass, forever. They keep their place near the front of the
       * remaining list, so each run spends more of a rate-limited budget re-discovering
       * them, and a later pass would fetch nothing but articles already known to be
       * unusable. The crawl would stop converging while still reporting progress.
       *
       * Stored `archived` — "manually retired", already in the enum — which retrieval skips
       * exactly like a quarantine. Deliberately done HERE and not in `ingestArticle`: a
       * too-short article from the dashboard or a feed must still be rejected outright
       * rather than quietly filed, and only the crawler has a resume to protect.
       */
      if (result.status === "skipped" && !opts.dryRun) {
        const marker = {
          source: "ghl" as const,
          sourceUrl: url,
          titleNormalized: title.slice(0, 300) || url,
          bodyNormalized: "",
          contentHash: `skipped:${createHash("sha256").update(body).digest("hex")}`,
          featureTags: [],
          status: "archived" as const,
          lastCrawledAt: new Date(),
        };
        await prisma.kbArticle
          .upsert({ where: { sourceUrl: url }, create: marker, update: { lastCrawledAt: marker.lastCrawledAt } })
          .catch(() => {
            // A marker is an optimisation, never the point of the run. Losing one costs a
            // re-fetch next time, which is exactly the status quo.
          });
      }
    } catch (e) {
      summary.failed++;
      log(`failed ${url}: ${describeError(e)}`);
    }
  }

  if (abort) {
    // Must be louder than the summary and must set `truncated`, or a run that stopped a
    // quarter of the way through reads as complete coverage of a small help centre.
    summary.truncated = true;
    summary.abortReason = abort;
    log(`ABORTED: ${abort}`);
  }
  if (summary.truncated && !abort) {
    // Never let a capped run read as complete coverage.
    log(`NOTE: stopped at maxPages=${opts.maxPages}; ${summary.discovered - targets.length} URL(s) not crawled.`);
  }
  // Which path the text actually came from. Worth stating rather than inferring: on a
  // JS-rendered portal the HTML route yields furniture that passes every gate, so "did we
  // get real article bodies" is the question a reader of this summary is really asking.
  if (summary.attempted > 0) {
    // Say what the REMAINDER actually did. Subtracting and calling it "HTML extraction" was
    // arithmetic dressed as a fact: once a portal is known to publish JSON the HTML route is
    // never taken, so those pages were skipped, refused or aborted — not extracted.
    const others = summary.attempted - structuredHits;
    log(
      structuredHits === summary.attempted
        ? `all ${structuredHits} article(s) came from the portal's JSON — real article bodies`
        : structuredHits > 0
          ? `${structuredHits}/${summary.attempted} from the portal's JSON; the other ${others} had none and were not scraped from HTML`
          : `${summary.attempted} page(s) via HTML extraction — this portal published no article JSON`
    );
  }
  return summary;
}

/**
 * Dry-run variant: normalize everything and report what WOULD happen, writing nothing.
 * Run this before any real ingest - it surfaces bad extraction and residual leaks
 * while they are still cheap to fix.
 */
export async function previewNormalization(raw: RawArticle) {
  const normalized = normalizeArticle({ title: raw.title, body: raw.body, isHtml: raw.isHtml });
  return {
    ...normalized,
    wouldQuarantine: normalized.residualLeaks.length > 0,
    bodyLength: normalized.bodyNormalized.length,
  };
}
