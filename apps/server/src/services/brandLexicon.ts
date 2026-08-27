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
/**
 * One folded character, and the span of the ORIGINAL text that produced it.
 *
 * Most folds are one character to one character, but three are not: invisible characters
 * and stripped separators produce nothing, and the punctuation letters ("|-|" -> "h",
 * "/-\\" -> "a") collapse three source characters into one. Carrying the span is what
 * lets a hit in the folded string be reported as the text somebody actually typed.
 */
interface Piece {
  out: string;
  from: number;
  /** Exclusive, so a collapsed trigraph reports all three characters. */
  to: number;
}

const INVISIBLE = /[\u00ad\u200b-\u200d\ufeff]/;

/**
 * Fold `text` the way `defang` does, and return the map back to where each folded
 * character came from.
 *
 * `defang` is implemented ON TOP of this rather than beside it. Two functions applying
 * "the same" rules is how the folded string and its index map drift apart, and the drift
 * would be silent: the scan would still find the term and would then quote the wrong span
 * of the agency's article back at them.
 */
export function defangWithMap(
  text: string,
  opts: { stripSeparators?: boolean } = {}
): { folded: string; pieces: Piece[] } {
  let pieces: Piece[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    pieces.push({ out: INVISIBLE.test(ch) ? "" : ch, from: i, to: i + 1 });
  }

  // Leetspeak letters built from punctuation, BEFORE the single-character folds below
  // (otherwise "|-|" is eaten by the pipe->i rule and never seen as an "h").
  const live = () => pieces.filter((p) => p.out !== "");
  const trigraphs: [string, string][] = [["|-|", "h"], ["/-\\", "a"]];
  for (const [seq, letter] of trigraphs) {
    for (;;) {
      const l = live();
      const at = l.map((p) => p.out).join("").indexOf(seq);
      if (at < 0) break;
      l[at].out = letter;
      l[at].to = l[at + seq.length - 1].to;
      for (let k = 1; k < seq.length; k++) l[at + k].out = "";
    }
  }

  const SINGLE: [RegExp, string][] = [
    // Collapse the i/l/1/| confusable class to one symbol so "GoHighLeveI" (capital i)
    // and "gohighlevel" land on the same string.
    [/[1l|!]/, "i"],
    [/0/, "o"],
    [/5/, "s"],
    [/3/, "e"],
    [/4/, "a"],
    [/7/, "t"],
    [/@/, "a"],
    [/\$/, "s"],
  ];
  for (const p of pieces) {
    if (p.out === "") continue;
    p.out = p.out.toLowerCase();
    for (const [re, to] of SINGLE) {
      if (re.test(p.out)) { p.out = to; break; }
    }
  }

  // Visible separators are stripped only for tokens that cannot collide with English
  // (see the two token lists below). Stripping them universally makes "a high level
  // overview" fold to "ahighleveloverview", which CONTAINS "highlevel" - a false
  // positive that would quarantine most of the corpus.
  const keep = opts.stripSeparators ? /[a-z0-9]/ : /[a-z0-9\s._|/-]/;
  for (const p of pieces) if (p.out !== "" && !keep.test(p.out)) p.out = "";

  pieces = pieces.filter((p) => p.out !== "");
  return { folded: pieces.map((p) => p.out).join(""), pieces };
}

/**
 * Fold homoglyphs, invisible characters and leetspeak so a disguised brand term lands on
 * the same string as the plain one. Detection only - never use this to REWRITE text.
 */
export function defang(text: string, opts: { stripSeparators?: boolean } = {}): string {
  return defangWithMap(text, opts).folded;
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
 * Both layers report the ORIGINAL text and an index into it. The defanged pass used to
 * report its folded token and an index into the FOLDED string, with a note saying that
 * was fine "for its purpose: a hit means quarantine the article or regenerate the answer,
 * never patch this one span". True of the gate, and false of the other consumer: the
 * dashboard shows these to the agency as the words to delete. So an article containing
 * "GoHighLeveI" was answered with `Mentions "gohighievei"` — a canonicalised string that
 * appears nowhere in what they wrote, so searching for it finds nothing. A remedy the
 * reader cannot carry out is the one thing worse than no remedy at all.
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

  const scans: [ReturnType<typeof defangWithMap>, { id: string; token: string }[]][] = [
    [defangWithMap(text, { stripSeparators: true }), DEFANGED_TOKENS_AGGRESSIVE],
    [defangWithMap(text), DEFANGED_TOKENS_STRICT],
  ];
  for (const [{ folded, pieces }, tokens] of scans) {
    for (const { id, token } of tokens) {
      let from = 0;
      for (;;) {
        const at = folded.indexOf(token, from);
        if (at < 0) break;
        // Back to the source span, so what is reported is what somebody can search for.
        const start = pieces[at].from;
        const end = pieces[at + token.length - 1].to;
        leaks.push({ id, match: text.slice(start, end), index: start });
        from = at + token.length;
      }
    }
  }

  return leaks.sort((a, b) => a.index - b.index);
}

/**
 * The terms to SHOW A PERSON, from a stored `residualLeaks` value.
 *
 * `findBrandLeaks` deliberately reports every hit: two lexicon entries firing on one
 * occurrence is diagnostic, and the gate wants all of it. A human reading "we can't use
 * this yet" wants the opposite — the words to delete — and one occurrence of
 * "GoHighLeveI" fires both `defanged-gohighlevel` and `defanged-highlevel`, so the
 * dashboard read `Mentions "GoHighLeveI", "HighLeveI"`. Two entries for one mistake reads
 * as two mistakes, and deleting the first silently removes the second.
 *
 * So spans CONTAINED IN another span are dropped, keeping the longest — which is also the
 * one that matches what they typed rather than a fragment of it. One definition, because
 * three copies of this mapping had already accumulated (both dashboard routes and the
 * shared-queue CLI) and a fourth was about to.
 *
 * Rows quarantined before the source-span fix above still hold a folded token and a
 * folded index; nothing here can recover the original for them, and re-saving the article
 * re-ingests it and repairs the row. Stated rather than papered over.
 */
export function leakTerms(residualLeaks: unknown): string[] {
  if (!Array.isArray(residualLeaks)) return [];
  const spans = residualLeaks
    .map((l) => ({
      match: String((l as any)?.match ?? ""),
      index: Number((l as any)?.index ?? 0),
    }))
    .filter((l) => l.match.length > 0)
    // Longest first at a given start, so a fragment is always tested against the whole.
    .sort((a, b) => a.index - b.index || b.match.length - a.match.length);

  const kept: { match: string; index: number }[] = [];
  for (const s of spans) {
    const end = s.index + s.match.length;
    const covered = kept.some((k) => s.index >= k.index && end <= k.index + k.match.length);
    if (!covered) kept.push(s);
  }
  // De-duplicated by TEXT: the same term twice in one article is one thing to remove.
  return [...new Set(kept.map((k) => k.match))];
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
