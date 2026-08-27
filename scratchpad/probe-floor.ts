/**
 * The retrieval FLOOR — the fail-safe direction, measured at whatever size the corpus is now.
 *
 * `DEFAULT_MIN_RANK` and `MIN_LOOSE_TERM_HITS` in kbSearch.ts were measured against 150
 * articles and re-checked at 253. Every article added past that gives an off-topic question
 * more chances to find two matching terms somewhere, and if the floor degrades then
 * "we found nothing" stops being reachable — which is exactly what `supportBot` reads as
 * thin retrieval and hands to a human.
 *
 * So the failure this file exists to catch is the OPPOSITE of the obvious one. Nobody
 * notices a bot that answers too eagerly: it looks like it is working. What actually
 * happens is that genuinely unanswerable questions stop reaching a person, and the client
 * gets a confident answer assembled from whatever shared two words with their question.
 *
 *   npx tsx scratchpad/probe-floor.ts
 */
import "../apps/server/src/services/loadEnv";
import { readFileSync } from "node:fs";
import { searchKb } from "../apps/server/src/services/kbSearch";
import { prisma } from "../apps/server/src/services/prisma";
// The REAL regex, not a copy of it — a copy would keep passing after the original changed.
import { ANSWERED_WITHOUT_KB_RE } from "../apps/server/src/services/supportBot";

/**
 * Questions the corpus MUST NOT answer. Two kinds, deliberately:
 *  - plainly off-topic (nothing in a CRM help centre is about alternators), and
 *  - off-topic but sharing a word with the corpus, which is the case a bare rank floor
 *    cannot separate: "who won the football last night" matched an article on deal status
 *    through the single word "won", above any threshold high enough to admit real matches.
 */
const OFF_TOPIC = [
  "capital city of portugal",
  "replace the alternator on a transit van",
  "who won the football last night",
  "what is the boiling point of water in fahrenheit",
  "best way to cook a medium rare steak",
  "when did the second world war end",
];

/** Questions the prompt answers alone; retrieval SHOULD stay empty (strictOnly). */
const ANSWERED_WITHOUT_KB = [
  "what software is this built on",
  "send me a documentation link",
];

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`); }
}

async function main(): Promise<void> {
  const total = await prisma.kbArticle.count({ where: { status: "ready" } });
  const crawled = await prisma.kbArticle.count({
    where: { status: "ready", sourceUrl: { startsWith: "https://" } },
  });
  console.log(`\ncorpus: ${total} retrievable (${crawled} crawled, ${total - crawled} hand-written)\n`);

  console.log("== off-topic questions must still retrieve NOTHING ==");
  let leaked = 0;
  for (const q of OFF_TOPIC) {
    const hits = await searchKb({ query: q, limit: 5 });
    const ok = hits.length === 0;
    if (!ok) leaked++;
    check(
      `"${q}"`,
      ok,
      ok ? "" : `returned ${hits.length}: ${hits.map((h: any) => h.titleNormalized?.slice(0, 50)).join(" | ")}`
    );
  }

  console.log("\n== the identity questions never reach retrieval at all ==");
  /*
   * A NOTE ON WHAT THIS DOES *NOT* TEST, because I got it wrong twice here.
   *
   * First I asserted `searchKb({strictOnly:true})` returns nothing for these. It does not,
   * and never did: strictOnly skips the LOOSE pass, while the strict pass (every term must
   * match) still runs. With crawled content present it returned a vendor page — "what
   * software is this built on" led with "How to Fix Bad Call Quality", at 228x the rank of
   * our own "What this software is for", because the strict pass runs with NO floor.
   *
   * That looked like a real regression and it is not reachable: `supportBot` never calls
   * searchKb for these questions at all. `needsNoReferenceMaterial` short-circuits
   * retrieval to `Promise.resolve([])` one level above, so the identity question gets zero
   * context by construction — a stronger guarantee than any floor.
   *
   * So the thing worth pinning is the SHORT-CIRCUIT, not the search. Asserting against
   * searchKb here would test a path production does not take, and would have sent me
   * redesigning the strict pass to fix a bug that cannot occur.
   */
  const promptOnly = readFileSync(
    new URL("../apps/server/src/services/supportBot.ts", import.meta.url),
    "utf8"
  );
  check(
    "supportBot skips retrieval entirely when the prompt answers alone",
    /answeredFromPromptAlone\s*\?\s*Promise\.resolve\(\[\]/.test(promptOnly),
    "the short-circuit is gone — identity questions would now be given retrieved context"
  );
  for (const q of ANSWERED_WITHOUT_KB) {
    // Sanity: these really are classified as prompt-answerable. If the regex stops
    // matching, the short-circuit above is real but never fires for them.
    check(`"${q}" is still classified as prompt-answerable`, ANSWERED_WITHOUT_KB_RE.test(q));
  }

  console.log(`\n${"-".repeat(56)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  if (leaked > 0) {
    console.log(
      `\n  ⚠ THE FAIL-SAFE HAS DEGRADED. ${leaked} off-topic question(s) now retrieve.\n` +
        `    Raise DEFAULT_MIN_RANK or MIN_LOOSE_TERM_HITS in kbSearch.ts, re-run, and record\n` +
        `    the new measured numbers in the comment above the constant. Do NOT ship this:\n` +
        `    a question nobody can answer must still reach a human.`
    );
  }
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fail ? 1 : 0); });
