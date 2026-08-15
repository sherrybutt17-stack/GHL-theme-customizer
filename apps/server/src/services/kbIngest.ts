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
  }
): Promise<IngestResult> {
  const contentHash = hashContent(raw);

  if (raw.url) {
    const existing = await prisma.kbArticle.findUnique({ where: { sourceUrl: raw.url } });
    if (existing && existing.contentHash === contentHash) {
      // Unchanged upstream. Touch the crawl timestamp so staleness reporting stays
      // honest, but skip re-normalizing and (importantly) skip re-quarantining an
      // article a human already reviewed.
      await prisma.kbArticle.update({
        where: { id: existing.id },
        data: { lastCrawledAt: new Date() },
      });
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
  /** Hard cap, so a misconfigured run can't hammer a host or fill the database. */
  maxPages: number;
  /** Parse and normalize but write nothing. Use this first, always. */
  dryRun?: boolean;
  onProgress?: (msg: string) => void;
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
    const sm = await fetchText(new URL("/sitemap.xml", opts.origin).toString());
    if (!sm.ok) {
      log(`no sitemap at /sitemap.xml (HTTP ${sm.status}) - nothing to crawl`);
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
  const targets = candidates.slice(0, opts.maxPages);
  summary.truncated = candidates.length > targets.length;
  log(`${candidates.length} candidate URL(s); crawling ${targets.length}${summary.truncated ? " (capped)" : ""}`);

  for (const url of targets) {
    // Serialised, with a delay. Concurrency here would be rude and would get us
    // blocked; the whole run is a background job, so wall-clock cost is irrelevant.
    await new Promise((r) => setTimeout(r, rules.crawlDelayMs));
    summary.attempted++;
    try {
      const page = await fetchText(url);
      if (!page.ok) {
        summary.failed++;
        log(`HTTP ${page.status} for ${url}`);
        continue;
      }
      const result = await ingestArticle(
        { url, title: extractTitle(page.body), body: extractMainContent(page.body), isHtml: true },
        { source: "ghl" }
      );
      if (opts.dryRun) {
        log(`[dry-run] ${result.status} ${url}${result.reason ? ` (${result.reason})` : ""}`);
        continue;
      }
      summary[result.status === "created" ? "created"
        : result.status === "updated" ? "updated"
        : result.status === "unchanged" ? "unchanged"
        : result.status === "quarantined" ? "quarantined"
        : "skipped"]++;
    } catch (e) {
      summary.failed++;
      log(`failed ${url}: ${describeError(e)}`);
    }
  }

  if (summary.truncated) {
    // Never let a capped run read as complete coverage.
    log(`NOTE: stopped at maxPages=${opts.maxPages}; ${summary.discovered - targets.length} URL(s) not crawled.`);
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
