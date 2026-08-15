/**
 * Parse an RSS 2.0 or Atom feed into items we can ingest.
 *
 * Hand-rolled rather than adding a parser dependency, consistent with the rest of this
 * codebase (kbNormalize strips HTML the same way, security.ts prefers a few lines to
 * helmet). Feeds are simple, well-formed by necessity — a broken feed breaks every reader
 * — and the failure mode we care about is "found nothing", not "parsed subtly wrong".
 *
 * Pure functions, no I/O, so the awkward real-world shapes are cheap to test exhaustively.
 */

export interface FeedItem {
  /** Canonical link. The upsert key for ingestion, so an item without one is dropped. */
  url: string;
  title: string;
  /** Best available body: full content where the feed offers it, else the summary. */
  body: string;
  /** Publication or update time, when the feed states one. */
  publishedAt: Date | null;
}

export interface ParsedFeed {
  /** The feed's own title, used to label it in the review queue. */
  title: string | null;
  items: FeedItem[];
}

/** Decode the five XML entities plus numeric references. */
export function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    // &amp; LAST, so "&amp;lt;" decodes to the literal text "&lt;" rather than to "<".
    .replace(/&amp;/gi, "&");
}

function safeCodePoint(code: number): string {
  // A malformed reference must not throw inside a scheduled job.
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/**
 * Read one element's text, unwrapping CDATA.
 *
 * `namespaced` allows the prefixed forms feeds actually use — `content:encoded`,
 * `dc:date` — without hardcoding every publisher's chosen prefix.
 */
export function tagText(xml: string, name: string, opts: { namespaced?: boolean } = {}): string | null {
  const tag = opts.namespaced ? `(?:[a-z0-9]+:)?${name}` : name;
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const raw = re.exec(xml)?.[1];
  if (raw === undefined) return null;
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  const text = cdata ? cdata[1] : decodeXml(raw);
  return text.trim() || null;
}

/**
 * Atom puts the URL in an attribute, and offers several.
 *
 * `rel="alternate"` is the human-readable page — the one we want. `rel="self"` points at
 * the feed itself, and taking it would make every item in the feed share one URL, which
 * (because `sourceUrl` is the upsert key) would collapse the whole feed into a single
 * article that overwrites itself on every poll.
 */
export function atomLink(xml: string): string | null {
  const links = [...xml.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  const attr = (s: string, name: string): string | null =>
    new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(s)?.[1] ?? null;

  const candidates = links
    .map((l) => ({ rel: attr(l, "rel") ?? "alternate", href: attr(l, "href") }))
    .filter((l): l is { rel: string; href: string } => !!l.href && l.rel !== "self");

  return candidates.find((l) => l.rel === "alternate")?.href ?? candidates[0]?.href ?? null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Split a document into the repeated blocks for one element name.
 *
 * Regex rather than a real parser is safe here only because feed entries do not nest
 * inside each other — `<item>` never contains another `<item>`.
 */
function blocks(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "gi");
  return [...xml.matchAll(re)].map((m) => m[1]);
}

export function parseFeed(xml: string): ParsedFeed {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);

  // The channel/feed title, read from the document HEAD only. Taken from the whole
  // document it would match the first ITEM's title instead, mislabelling every feed.
  const head = xml.slice(0, Math.max(0, xml.search(/<(?:item|entry)[\s>]/i) >>> 0) || xml.length);
  const feedTitle = tagText(head, "title");

  const items: FeedItem[] = [];
  for (const block of blocks(xml, isAtom ? "entry" : "item")) {
    const url = isAtom ? atomLink(block) : tagText(block, "link") ?? atomLink(block);
    const title = tagText(block, "title");
    // Prefer the fullest body a feed offers. `content:encoded` carries the whole article
    // where publishers bother; description/summary is usually a teaser, and a teaser
    // ingested as an article makes the bot answer from an advert for the answer.
    const body =
      tagText(block, "encoded", { namespaced: true }) ??
      tagText(block, "content") ??
      tagText(block, "description") ??
      tagText(block, "summary") ??
      null;

    if (!url || !title || !body) continue;

    items.push({
      url: url.trim(),
      title,
      body,
      publishedAt:
        parseDate(tagText(block, "pubDate")) ??
        parseDate(tagText(block, "published")) ??
        parseDate(tagText(block, "updated")) ??
        parseDate(tagText(block, "date", { namespaced: true })),
    });
  }

  return { title: feedTitle, items };
}
