/**
 * The canonical list of terms that must never reach a sub-account client.
 *
 * ONE source of truth, used by BOTH ends of the pipeline:
 *   - kbNormalize.ts   strips them at ingest, so the model never sees them
 *   - answerGuard.ts   scans outbound text, because Claude knows GoHighLevel from
 *                      training and can name it from a spotless context
 *
 * TWO LAYERS, with different jobs:
 *
 *   1. REPLACEMENT (BRAND_PATTERNS) - literal, precise, longest-first. Used to rewrite
 *      article text into {{PLATFORM}}. Precision matters here: a sloppy pattern
 *      mangles legitimate prose in every article.
 *
 *   2. DETECTION (findBrandLeaks) - deliberately paranoid. Runs the literal patterns
 *      AND a "defanged" scan that folds homoglyphs, strips separators and ignores
 *      case, so "G0HighLeveI", "G.H.L.", "High­Level" (soft hyphen) and "H i g h L e v
 *      e l" are all caught. Detection has no cost when it over-fires - the article is
 *      quarantined for review, or the answer is regenerated - so it errs hard toward
 *      catching things.
 *
 * The asymmetry is the whole point: replacement must be surgical, detection must be
 * merciless. A term detection misses is a term rendered verbatim into a client's chat
 * window, in the agency's own voice.
 */

export interface BrandPattern {
  /** Stable id, used in logs so you can see WHICH term leaked. */
  id: string;
  pattern: RegExp;
}

/**
 * Ordered LONGEST/MOST-SPECIFIC FIRST. This matters: if "HighLevel" ran before
 * "GoHighLevel", the input "GoHighLevel" would become "Go{{PLATFORM}}" - which still
 * leaks the "Go" and reads as nonsense. Replacement walks this list in order.
 *
 * Every pattern is global. Do NOT add the `y` flag - these are reused across calls and
 * a sticky flag carries lastIndex between them.
 */
export const BRAND_PATTERNS: BrandPattern[] = [
  // --- URLs and hosts first: they contain the names, so they must be consumed before
  // the bare-name patterns get a chance to mangle them into "{{PLATFORM}}.com".
  { id: "url-brand", pattern: /https?:\/\/[^\s<>"')\]]*(?:gohighlevel|highlevel|leadconnector(?:hq)?|msgsndr)\.[a-z]{2,}[^\s<>"')\]]*/gi },
  { id: "host-gohighlevel", pattern: /\b(?:[a-z0-9-]+\.)*gohighlevel\.[a-z]{2,}\b/gi },
  { id: "host-highlevel", pattern: /\b(?:[a-z0-9-]+\.)*highlevel\.[a-z]{2,}\b/gi },
  { id: "host-leadconnector", pattern: /\b(?:[a-z0-9-]+\.)*leadconnector(?:hq)?\.[a-z]{2,}\b/gi },
  { id: "host-msgsndr", pattern: /\b(?:[a-z0-9-]+\.)*msgsndr\.[a-z]{2,}\b/gi },

  // --- Product names, longest first.
  { id: "gohighlevel", pattern: /\bGo[\s._-]*High[\s._-]*Level\b/gi },
  { id: "leadconnector", pattern: /\bLead[\s._-]*Connector(?:\s*HQ)?\b/gi },
  { id: "msgsndr", pattern: /\bmsgsndr\b/gi },

  // "highlevel" as ONE word is never ordinary English, so it is matched
  // case-INSENSITIVELY. This was a real leak: the separated pattern below is
  // case-sensitive to protect "a high-level overview", and that let plain
  // "highlevel" / "HIGHLEVEL" through untouched.
  { id: "highlevel-oneword", pattern: /\bhighlevel\b/gi },
  {
    id: "highlevel-separated",
    // Case-SENSITIVE on purpose (capital H and capital L). "High Level"/"High-Level"
    // is the brand; "high level" and "high-level" are ordinary English appearing in
    // nearly every help article, and blanket-replacing them would mangle the corpus.
    pattern: /\bHigh[\s._-]+Level\b/g,
  },

  // LeadConnector-branded sub-products. "LC Phone"/"LC Email" are real product names
  // that show up in help content and read as vendor branding to a client.
  { id: "lc-product", pattern: /\bLC[\s-]+(?:Phone|Email|Premium|Number|Messaging)\b/gi },

  // Abbreviations, including separator-padded forms ("G.H.L.", "G H L", "G-H-L") and
  // the leetspeak H ("G|-|L"). Anchored at word boundaries so "GHLX" and "NIGHLIGHT"
  // are untouched.
  { id: "ghl", pattern: /\bG[\s._-]*(?:H|\|-\|)[\s._-]*L\b\.?/gi },
];

/**
 * Fold text into a form where obfuscation collapses.
 *
 *   "G0HighLeveI"  "G.H.L."  "High­Level"(soft hyphen)  →  comparable shapes
 *
 * Steps: drop invisible characters, lowercase, map the classic homoglyph confusables,
 * then remove every non-alphanumeric character so spacing and punctuation can't be
 * used to break a token apart.
 *
 * Exported for testing; callers should use findBrandLeaks.
 */
export function defang(text: string, opts: { stripSeparators?: boolean } = {}): string {
  const folded = text
    // Zero-width space/non-joiner/joiner, BOM, soft hyphen - invisible, and a trivial
    // way to split a word past a naive matcher.
    .replace(/[­​-‍﻿]/g, "")
    // Leetspeak letters built from punctuation, BEFORE the single-char folds below
    // (otherwise "|-|" is eaten by the pipe→i rule and never seen as an "h").
    .replace(/\|-\|/g, "h")
    .replace(/\/-\\/g, "a")
    .toLowerCase()
    // Collapse the i/l/1/| confusable class to one symbol so "GoHighLeveI" (capital i)
    // and "gohighlevel" land on the same string.
    .replace(/[1l|!]/g, "i")
    .replace(/0/g, "o")
    .replace(/5/g, "s")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/7/g, "t")
    .replace(/[@]/g, "a")
    .replace(/\$/g, "s");

  // Visible separators are stripped only for tokens that cannot collide with English
  // (see the two token lists below). Stripping them universally makes "a high level
  // overview" fold to "ahighleveloverview", which CONTAINS "highlevel" - a false
  // positive that would quarantine most of the corpus.
  return opts.stripSeparators ? folded.replace(/[^a-z0-9]/g, "") : folded.replace(/[^a-z0-9\s._|/-]/g, "");
}

/**
 * Tokens matched against SEPARATOR-STRIPPED text, so "g o h i g h l e v e l" and
 * "Go.High.Level" collapse onto them.
 *
 * Only tokens that cannot plausibly collide with English once spacing is removed go
 * here. MINIMUM LENGTH 7: "ghl" folds to "ghi", and "big hint" folds to "bighint",
 * which CONTAINS "ghi" - short abbreviations are left to the word-boundary literal
 * patterns instead.
 */
export const DEFANGED_TOKENS_AGGRESSIVE: { id: string; token: string }[] = [
  "gohighlevel",
  "leadconnector",
  "leadconnectorhq",
  "msgsndr",
].map((raw) => ({ id: `defanged-${raw}`, token: defang(raw, { stripSeparators: true }) }));

/**
 * Tokens matched with visible separators PRESERVED - only invisible characters and
 * homoglyphs are folded.
 *
 * "highlevel" lives here because stripping separators would make it match the ordinary
 * English "high level". Keeping the separators means "High­Level" (soft hyphen),
 * "High​Level" (zero-width space), "h1ghlevel" and "HighLeveI" are still caught, while
 * "a high level overview" is not. The genuinely separated brand forms ("High-Level",
 * "Go High Level") are covered by the literal patterns above, which allow separators
 * explicitly.
 */
export const DEFANGED_TOKENS_STRICT: { id: string; token: string }[] = [
  "highlevel",
].map((raw) => ({ id: `defanged-${raw}`, token: defang(raw) }));

/** A brand term found in text that should not contain one. */
export interface BrandLeak {
  id: string;
  match: string;
  index: number;
}

/**
 * Find every brand term in `text`. Empty array means clean.
 *
 * Runs BOTH layers - literal patterns and the defanged scan - and is the function to
 * use anywhere the question is "is this safe to show a client?": the residual check
 * after ingest normalization, and the outbound gate on every bot and agent message.
 *
 * Note the defanged pass reports an index into the FOLDED string, not the original.
 * That is fine for its purpose: a hit means quarantine the article or regenerate the
 * answer, never "patch this one span".
 */
export function findBrandLeaks(text: string): BrandLeak[] {
  const leaks: BrandLeak[] = [];

  for (const { id, pattern } of BRAND_PATTERNS) {
    // Fresh regex per call: the shared literals carry lastIndex across calls with /g,
    // so reusing them directly makes results depend on call order. That bug is
    // invisible in a single test and chaotic in production.
    const re = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      leaks.push({ id, match: m[0], index: m.index });
      // Zero-length matches can't happen with these patterns, but guard anyway so a
      // future edit can't produce an infinite loop in a request path.
      if (m[0].length === 0) re.lastIndex++;
    }
  }

  const scans: [string, { id: string; token: string }[]][] = [
    [defang(text, { stripSeparators: true }), DEFANGED_TOKENS_AGGRESSIVE],
    [defang(text), DEFANGED_TOKENS_STRICT],
  ];
  for (const [folded, tokens] of scans) {
    for (const { id, token } of tokens) {
      let from = 0;
      for (;;) {
        const at = folded.indexOf(token, from);
        if (at < 0) break;
        leaks.push({ id, match: token, index: at });
        from = at + token.length;
      }
    }
  }

  return leaks.sort((a, b) => a.index - b.index);
}

/** Convenience predicate for hot paths that only need yes/no. */
export function containsBrandTerm(text: string): boolean {
  if (BRAND_PATTERNS.some(({ pattern }) => new RegExp(pattern.source, pattern.flags).test(text))) {
    return true;
  }
  const aggressive = defang(text, { stripSeparators: true });
  if (DEFANGED_TOKENS_AGGRESSIVE.some(({ token }) => aggressive.includes(token))) return true;
  const strict = defang(text);
  return DEFANGED_TOKENS_STRICT.some(({ token }) => strict.includes(token));
}

/**
 * Replace every brand term with `replacement` (normally the {{PLATFORM}} placeholder).
 *
 * Runs the patterns in list order - longest-first - which is what stops "GoHighLevel"
 * from being partially eaten by the shorter "HighLevel" pattern.
 *
 * This is the SURGICAL layer, so it only applies the literal patterns. Anything an
 * obfuscated form leaves behind is caught by findBrandLeaks and quarantined; trying to
 * "repair" obfuscated text automatically would rewrite legitimate prose.
 */
export function replaceBrandTerms(text: string, replacement: string): string {
  let out = text;
  for (const { pattern } of BRAND_PATTERNS) {
    out = out.replace(new RegExp(pattern.source, pattern.flags), replacement);
  }
  // Consecutive replacements collapse: "GoHighLevel (HighLevel)" would otherwise
  // become "{{PLATFORM}} ({{PLATFORM}})", which is odd but harmless - however
  // "GoHighLevel/GHL" becoming "{{PLATFORM}}/{{PLATFORM}}" reads badly enough to fix.
  const escaped = replacement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return out.replace(new RegExp(`(?:${escaped})(?:[\\s/|,-]*(?:${escaped}))+`, "g"), replacement);
}
