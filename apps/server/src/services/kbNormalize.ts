import { replaceBrandTerms, findBrandLeaks, BrandLeak } from "./brandLexicon";
import {
  GHL_SIDEBAR_FEATURES,
  GHL_AGENCY_SIDEBAR_FEATURES,
  GHL_SETTINGS_SIDEBAR_FEATURES,
} from "./ghlSidebarFeatures";

/**
 * Turn a crawled help article into ONE canonical, brand-neutral copy.
 *
 *   "In GoHighLevel, open Opportunities and drag the card."
 *        ↓
 *   "In {{PLATFORM}}, open {{FEATURE:opportunities}} and drag the card."
 *
 * This is where the white-label guarantee is actually won. A model cannot emit a term
 * it never saw, so stripping brand names at INGEST turns leak prevention from
 * "instruction following" (probabilistic) into "the token isn't in the context"
 * (deterministic). The outbound gate in answerGuard.ts is the second line of defence,
 * for what Claude knows from training rather than from us.
 *
 * Pure functions - no I/O, no DB - so the whole thing is cheap to test exhaustively.
 */

export const PLATFORM_PLACEHOLDER = "{{PLATFORM}}";

/** All three sidebars' features, deduped by key. */
const ALL_FEATURES = [
  ...GHL_SIDEBAR_FEATURES,
  ...GHL_AGENCY_SIDEBAR_FEATURES,
  ...GHL_SETTINGS_SIDEBAR_FEATURES,
];

/**
 * Feature label → key, sorted LONGEST LABEL FIRST.
 *
 * Order is load-bearing for multi-word labels: "App Marketplace" must be matched
 * before "Marketing"-style shorter entries could chop it up, and "Calendars
 * (Settings)" before "Calendars". Sorting by length gives that for free without
 * hand-maintaining an order.
 */
const FEATURE_MATCHERS: { key: string; label: string; re: RegExp }[] = ALL_FEATURES
  // Labels carrying a parenthetical disambiguator ("Calendars (Settings)") are an
  // admin-UI affordance, not text that appears in prose. Match on the bare label.
  .map((f) => ({ key: f.key, label: f.label.replace(/\s*\(.*\)$/, "").trim() }))
  .filter((f) => f.label.length >= 4) // "Sites"/"Tags" are fine; nothing shorter is safe.
  .sort((a, b) => b.label.length - a.label.length)
  .map((f) => ({
    ...f,
    // Capitalised occurrences ONLY (case-SENSITIVE). In help-doc prose a capitalised
    // "Contacts" means the nav item, while "your contacts will receive" is ordinary
    // English. Replacing the latter would rewrite half of every article. Hyphen/space
    // tolerant so "App-Marketplace" still matches.
    re: new RegExp(`\\b${f.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]?")}\\b`, "g"),
  }));

/**
 * Case-INSENSITIVE detector used only for tagging (not replacement).
 *
 * Deliberately more aggressive than the replacer. Tags drive the hiddenFeatures
 * filter - "don't serve this article to a client who can't see Memberships" - so the
 * costs are asymmetric: over-tagging hides an article that was merely tangential
 * (mild), under-tagging explains a feature the client doesn't have (a visible
 * white-label failure).
 */
const FEATURE_TAGGERS = FEATURE_MATCHERS.map((f) => ({
  key: f.key,
  re: new RegExp(f.re.source, "gi"),
}));

export interface NormalizedArticle {
  /** Brand-neutral body with {{PLATFORM}} / {{FEATURE:key}} placeholders. */
  bodyNormalized: string;
  /** Title, normalized the same way. */
  titleNormalized: string;
  /** Feature keys this article touches, for hiddenFeatures filtering at retrieval. */
  featureTags: string[];
  /**
   * Brand terms that SURVIVED normalization. Non-empty means the article is not safe
   * to serve - the caller must store it as `needs_review`, never `ready`.
   */
  residualLeaks: BrandLeak[];
}

/**
 * Strip HTML to readable text.
 *
 * Deliberately hand-rolled rather than adding a parser dependency: help pages are
 * simple, and the codebase consistently prefers a few lines over new supply-chain
 * surface (see security.ts choosing this over helmet). Order matters - script/style
 * bodies must go before generic tag removal, or their contents land in the text.
 */
export function htmlToText(html: string): string {
  return (
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      // Keep block structure as newlines so steps stay separate lines.
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<[^>]+>/g, " ")
      // Entities, commonest first. &amp; LAST so "&amp;lt;" can't become "<".
      .replace(/&nbsp;/gi, " ")
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;|&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n\s*\n+/g, "\n\n")
      .split("\n")
      .map((l) => l.trim())
      .join("\n")
      .trim()
  );
}

/**
 * Strip every URL.
 *
 * Not just brand URLs - ALL of them. The bot never emits a link to anyone (that's gate
 * 2), so a URL sitting in the knowledge base is pure liability: it can only ever be
 * repeated by the model into text a client reads. Removing them at ingest means the
 * gate has nothing to catch.
 */
function stripUrls(text: string): string {
  const withoutUrls = text
    .replace(/https?:\/\/[^\s<>"')\]]+/gi, "")
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, "");

  // Removing a URL leaves the sentence that pointed at it stranded:
  //   "Need help? Visit https://… or email support@…."  →  "Need help? Visit or email ."
  // That fragment is worse than useless - it's confusing input for the model, which
  // then has to reason over a half-sentence and answers with a half-answer.
  //
  // Cleanup runs to a FIXPOINT rather than once, because removing one fragment
  // exposes the next: dropping "or email" above turns "Visit  or email ." into
  // "Visit ." - a dangling lead-in that a single pass has already walked past.
  const CLEANUPS: [RegExp, string][] = [
    // Lead-ins left pointing at nothing. The trailing-punctuation lookahead is what
    // keeps this safe: "See Contacts." has a word after "See" and is untouched.
    [/\b(?:visit|see|go to|navigate to|check out|read more at|available at|click here|learn more at|more info at)\s*(?=[.,;:!?)]|$)/gi, ""],
    // Orphaned connectors between two removed links: "Visit  or email  ."
    [/\b(?:or|and)\s+(?:email|call|contact|visit|see)\s*(?=[.,;:!?)]|$)/gi, ""],
    [/\(\s*\)/g, ""],
    [/\[\s*\]/g, ""],
    [/[ \t]{2,}/g, " "],
    // Whitespace stranded before punctuation.
    [/[ \t]+([.,;:!?])/g, "$1"],
  ];

  /**
   * Collapse a run of ADJACENT DIFFERENT punctuation marks, keeping the strongest.
   * Removing "or email" from "Need help? Visit or email." leaves "Need help?." -
   * visibly broken text. Runs of the SAME mark are left alone so a real ellipsis
   * survives.
   */
  const RANK: Record<string, number> = { "?": 4, "!": 4, ".": 3, ";": 2, ":": 2, ",": 1 };
  const collapsePunctuation = (s: string): string =>
    s.replace(/[.,;:!?]{2,}/g, (run) => {
      if (new Set(run).size === 1) return run; // "..." stays "..."
      return [...run].reduce((best, c) => (RANK[c] > RANK[best] ? c : best), run[0]);
    });

  let out = withoutUrls;
  // Bounded: a runaway loop in a request path is worse than a stray fragment.
  for (let i = 0; i < 5; i++) {
    const before = out;
    for (const [re, sub] of CLEANUPS) out = out.replace(re, sub);
    out = collapsePunctuation(out);
    if (out === before) break;
  }

  // A line that is now nothing but punctuation carries no information.
  return out
    .split("\n")
    .filter((line) => line.trim() === "" || !/^[\s.,;:!?•-]*$/.test(line))
    .join("\n");
}

/** Replace capitalised feature labels with {{FEATURE:key}} placeholders. */
function placeholderFeatures(text: string): string {
  let out = text;
  for (const { key, re } of FEATURE_MATCHERS) {
    out = out.replace(new RegExp(re.source, re.flags), `{{FEATURE:${key}}}`);
  }
  return out;
}

/** Which features does this article talk about (case-insensitive, aggressive)? */
function detectFeatureTags(text: string): string[] {
  const tags = new Set<string>();
  for (const { key, re } of FEATURE_TAGGERS) {
    if (new RegExp(re.source, re.flags).test(text)) tags.add(key);
  }
  return [...tags].sort();
}

/**
 * Normalize one article. `body` may be raw HTML or already-extracted text.
 *
 * Pipeline order is deliberate and should not be rearranged:
 *   1. HTML → text          (so tags can't hide a brand term from the matcher)
 *   2. detect feature tags  (BEFORE placeholdering, while real labels are present)
 *   3. strip URLs           (before brand replacement, so we don't leave "{{PLATFORM}}.com")
 *   4. brand → {{PLATFORM}} (longest-first, per brandLexicon ordering)
 *   5. features → {{FEATURE:key}}
 *   6. residual scan        (the fail-safe: did anything survive?)
 */
export function normalizeArticle(input: { title: string; body: string; isHtml?: boolean }): NormalizedArticle {
  const text = input.isHtml === false ? input.body : htmlToText(input.body);

  const featureTags = detectFeatureTags(`${input.title}\n${text}`);

  const clean = (s: string): string =>
    placeholderFeatures(replaceBrandTerms(stripUrls(s), PLATFORM_PLACEHOLDER))
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  const bodyNormalized = clean(text);
  const titleNormalized = clean(htmlToText(input.title));

  // The fail-safe. If anything brand-shaped survived every pattern above, this
  // article must NOT become retrievable - a single missed term would be rendered
  // verbatim into a client's chat window, in the agency's own voice.
  const residualLeaks = findBrandLeaks(`${titleNormalized}\n${bodyNormalized}`);

  return { bodyNormalized, titleNormalized, featureTags, residualLeaks };
}

/**
 * Render a normalized article back out for ONE sub-account.
 *
 * `features` maps feature key → the label that client actually sees in their sidebar
 * (from menuLabelOverrides, falling back to GHL's default label). An unmapped key
 * falls back to its default label rather than leaving a raw placeholder on screen.
 */
export function renderForBrand(
  normalized: string,
  brandName: string,
  features: Record<string, string>
): string {
  const defaults = Object.fromEntries(ALL_FEATURES.map((f) => [f.key, f.label.replace(/\s*\(.*\)$/, "")]));
  return normalized
    .replace(/\{\{PLATFORM\}\}/g, brandName)
    .replace(/\{\{FEATURE:([a-zA-Z0-9_-]+)\}\}/g, (_all, key: string) => features[key] ?? defaults[key] ?? key);
}
