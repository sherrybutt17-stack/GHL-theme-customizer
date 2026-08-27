import { findBrandLeaks, BrandLeak } from "./brandLexicon";

/**
 * The three deterministic gates every outbound message passes before a client sees it.
 *
 * An instruction is a request; a gate is a guarantee. The system prompt tells Claude it
 * has no knowledge of any underlying vendor, and the knowledge base never contains one
 * - but Claude knows what GoHighLevel is from training, so "what CRM is this?" can be
 * answered correctly from its own weights with a spotless context. These gates are what
 * make the white-label claim true rather than likely.
 *
 * They run on HUMAN AGENT MESSAGES TOO, not just bot output. Because the desk is
 * staffed by Mosaic's own team answering on behalf of many agencies, a human is the
 * PRIMARY leak risk: they know the platform is GoHighLevel, they switch between five
 * brands in an afternoon, and they type fast. The bot has a clean context by
 * construction; the human does not.
 *
 * Pure functions, no I/O - which is what makes the compliance harness cheap to run on
 * every change.
 */

export type GateId = "brand" | "link" | "overlap";

export interface GateFinding {
  gate: GateId;
  detail: string;
  /** Matched text, truncated. Safe to log - it is the thing we are refusing to send. */
  sample?: string;
}

export interface GuardOptions {
  /**
   * Domains this agency is allowed to link to (their own site / KB). EMPTY IS THE
   * DEFAULT AND THE SAFE ONE: every URL is stripped.
   */
  allowedLinkDomains?: string[];
  /** Agency-specific extra forbidden words beyond the global brand lexicon. */
  forbiddenTerms?: string[];
  /**
   * Source chunks the answer was generated from. Gate 3 checks the answer isn't
   * reproducing long verbatim runs from these.
   */
  sourceChunks?: string[];
  /** Consecutive-word run that counts as republication rather than rephrasing. */
  overlapThreshold?: number;
}

export interface GuardResult {
  /** Text safe to send. Link stripping is applied; other gates do not rewrite. */
  text: string;
  /** Empty means clean. Non-empty means DO NOT SEND as-is. */
  findings: GateFinding[];
  /** True when only link-stripping changed the text and nothing else tripped. */
  ok: boolean;
}

const DEFAULT_OVERLAP_WORDS = 25;

// --- Gate 1: brand blocklist ----------------------------------------------------

function checkBrand(text: string, extraTerms: string[]): GateFinding[] {
  const findings: GateFinding[] = [];

  for (const leak of findBrandLeaks(text)) {
    findings.push({ gate: "brand", detail: leak.id, sample: leak.match.slice(0, 60) });
  }

  // Agency-specific additions: a former platform name, a competitor, a partner they
  // don't mention. Matched whole-word and case-insensitively.
  for (const term of extraTerms) {
    const clean = term.trim();
    if (!clean) continue;
    const re = new RegExp(`\\b${clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) {
      findings.push({ gate: "brand", detail: "agency-forbidden-term", sample: clean.slice(0, 60) });
    }
  }
  return findings;
}

// --- Gate 2: link strip ---------------------------------------------------------

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const BARE_HOST_RE = /\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|co|app|dev|ai|help|info|biz)\b(?:\/[^\s<>"')\]]*)?/gi;
const MARKDOWN_LINK_RE = /\[([^\]]*)\]\(([^)]*)\)/g;
const ANCHOR_RE = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;

function hostOf(url: string): string | null {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isAllowedHost(host: string | null, allowed: string[]): boolean {
  if (!host) return false;
  return allowed.some((d) => {
    const domain = d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    return domain !== "" && (host === domain || host.endsWith(`.${domain}`));
  });
}

/**
 * Remove every link a client isn't allowed to see.
 *
 * Strips bare URLs, markdown links (keeping their visible text) and <a> tags. Unlike
 * the other gates this one REWRITES rather than refuses: a stray link is not a reason
 * to throw away an otherwise good answer, and the safe transformation is unambiguous.
 */
function stripLinks(text: string, allowed: string[]): { text: string; findings: GateFinding[] } {
  const findings: GateFinding[] = [];
  const note = (sample: string) =>
    findings.push({ gate: "link", detail: "stripped", sample: sample.slice(0, 80) });

  let out = text
    // Markdown first: keep the human-readable label, drop the target.
    .replace(MARKDOWN_LINK_RE, (all, label: string, href: string) => {
      if (isAllowedHost(hostOf(href), allowed)) return all;
      note(href);
      return label;
    })
    .replace(ANCHOR_RE, (all, inner: string) => {
      const href = /href\s*=\s*["']?([^"'\s>]+)/i.exec(all)?.[1] ?? "";
      if (isAllowedHost(hostOf(href), allowed)) return all;
      note(href || all);
      return inner;
    })
    .replace(URL_RE, (url) => {
      if (isAllowedHost(hostOf(url), allowed)) return url;
      note(url);
      return "";
    })
    .replace(BARE_HOST_RE, (host) => {
      if (isAllowedHost(hostOf(host), allowed)) return host;
      note(host);
      return "";
    });

  if (findings.length > 0) {
    // Removing a link strands the sentence that pointed at it ("see  for details"),
    // so tidy the wreckage rather than shipping a half-sentence to a client.
    out = out
      .replace(/\b(?:visit|see|go to|check out|read more at|available at|learn more at)\s*(?=[.,;:!?)]|$)/gi, "")
      .replace(/\(\s*\)/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+([.,;:!?])/g, "$1")
      .replace(/([.,;:!?])[ \t]*([.,;:!?])/g, "$1")
      .trim();
  }
  return { text: out, findings };
}

// --- Gate 3: verbatim overlap ---------------------------------------------------

const wordsOf = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

/**
 * Detect long verbatim runs copied from the source material.
 *
 * This is what makes "always rephrase" a property of the system rather than a hope
 * about the model. Left alone, retrieval-augmented models routinely emit long literal
 * spans from their context - which is not rephrasing, it's republication with extra
 * steps, and it's exactly what the no-links policy is meant to avoid. It is also the
 * mechanical half of the transformative-use argument.
 *
 * Shingling: hash every N-word window of the source, then slide the same window over
 * the answer. Linear in both, no quadratic blowup on long articles.
 */
export function longestVerbatimRun(answer: string, sources: string[]): number {
  const answerWords = wordsOf(answer);
  if (answerWords.length === 0) return 0;

  let longest = 0;
  for (const source of sources) {
    const sourceWords = wordsOf(source);
    if (sourceWords.length === 0) continue;

    // Index every start position by word, so we only compare where a run could begin.
    const starts = new Map<string, number[]>();
    for (let i = 0; i < sourceWords.length; i++) {
      const list = starts.get(sourceWords[i]);
      if (list) list.push(i);
      else starts.set(sourceWords[i], [i]);
    }

    for (let a = 0; a < answerWords.length; a++) {
      for (const s of starts.get(answerWords[a]) ?? []) {
        let run = 0;
        while (a + run < answerWords.length && s + run < sourceWords.length && answerWords[a + run] === sourceWords[s + run]) {
          run++;
        }
        if (run > longest) longest = run;
      }
      // Once a run this long has been found, the answer fails regardless - stop.
      if (longest >= 100) return longest;
    }
  }
  return longest;
}

function checkOverlap(text: string, sources: string[], threshold: number): GateFinding[] {
  if (sources.length === 0) return [];
  const run = longestVerbatimRun(text, sources);
  if (run < threshold) return [];
  return [{ gate: "overlap", detail: `${run} consecutive words match a source chunk (limit ${threshold})` }];
}

// --- The guard ------------------------------------------------------------------

/**
 * Run all three gates over one outbound message.
 *
 * Callers must treat `ok === false` as DO NOT SEND. The intended handling differs per
 * gate and is the caller's decision, not this module's:
 *   brand   → substitute if a clean mapping exists, else regenerate once, else escalate
 *   link    → already stripped; the finding is for metrics
 *   overlap → regenerate with an explicit "in your own words" instruction, then escalate
 *
 * For a HUMAN agent's message the correct handling is warn-and-block in the compose
 * box, never silent rewriting: silently editing someone's words means they never learn,
 * and the stored record stops matching what they actually typed.
 */
export function guardAnswer(text: string, opts: GuardOptions = {}): GuardResult {
  // ORDER MATTERS. The brand check runs on the ORIGINAL text, before links are
  // stripped. Running it after would hide two real problems:
  //
  //   1. "See help.gohighlevel.com for the guide" would have its vendor hostname
  //      removed by gate 2, and the brand check would then see clean text and pass -
  //      so the leak metric never records that THE MODEL TRIED TO NAME THE VENDOR,
  //      which is the signal worth watching per agency.
  //   2. What actually shipped would be the gutted stub "for the guide" - a useless
  //      answer, sent confidently in the agency's voice.
  //
  // Detecting first means the answer is regenerated instead, with the stripped text
  // available as a safe fallback if regeneration also fails.
  const brandFindings = checkBrand(text, opts.forbiddenTerms ?? []);
  const link = stripLinks(text, opts.allowedLinkDomains ?? []);
  const findings: GateFinding[] = [
    ...brandFindings,
    ...link.findings,
    ...checkOverlap(link.text, opts.sourceChunks ?? [], opts.overlapThreshold ?? DEFAULT_OVERLAP_WORDS),
  ];

  // Link stripping is a safe, complete transformation - the text it produces IS
  // sendable. Anything else means the answer must be regenerated or escalated.
  const blocking = findings.filter((f) => f.gate !== "link");
  return { text: link.text, findings, ok: blocking.length === 0 };
}

/** Cheap pre-send check for the agent compose box: does this text trip a hard gate? */
export function checkAgentDraft(
  text: string,
  opts: { forbiddenTerms?: string[]; allowedLinkDomains?: string[] } = {}
): { blocked: boolean; findings: GateFinding[] } {
  const brand = checkBrand(text, opts.forbiddenTerms ?? []);
  const links: GateFinding[] = [];
  for (const m of text.matchAll(URL_RE)) {
    if (!isAllowedHost(hostOf(m[0]), opts.allowedLinkDomains ?? [])) {
      links.push({ gate: "link", detail: "link not allowed", sample: m[0].slice(0, 80) });
    }
  }
  const findings = [...brand, ...links];
  return { blocked: findings.length > 0, findings };
}

export type { BrandLeak };
