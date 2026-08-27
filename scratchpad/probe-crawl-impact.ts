/**
 * What do the crawled articles do to RETRIEVAL? Measured as a true A/B on one database.
 *
 * The plan calls this the highest-risk step, and the risk runs in a direction nobody
 * notices: adding thousands of articles gives an off-topic question far more chances to
 * find two matching terms, and if the floor degrades then "we found nothing" stops being
 * reachable. That is exactly what `supportBot` reads as thin retrieval and hands to a
 * human — so the failure is not a wrong answer, it is a client who never reaches a person.
 *
 * WHY A/B AND NOT A BEFORE-READING. My first attempt read the "baseline" while a crawl was
 * already running in the background and 15 rows had landed, so it measured neither state.
 * Toggling the crawled rows' status is the only way to compare the identical probe, on the
 * identical code, against the identical hand-written corpus.
 *
 *   npx tsx scratchpad/probe-crawl-impact.ts
 */
import "../apps/server/src/services/loadEnv";
import { searchKb } from "../apps/server/src/services/kbSearch";
import { prisma } from "../apps/server/src/services/prisma";

/**
 * Only rows that are actually SERVING.
 *
 * The crawler also stores `archived` markers for URLs it fetched and rejected (video-only
 * articles, which are a quarter of this help centre) so a resumed run does not re-fetch
 * them forever. Those have an empty body. A blanket toggle on sourceUrl would flip them to
 * `ready` when restoring, quietly making empty articles retrievable — and the probe that
 * exists to catch retrieval damage would be the thing causing it.
 */
const CRAWLED = {
  sourceUrl: { startsWith: "https://help.gohighlevel.com" },
  status: "ready" as const,
};
/** The same rows once this probe has hidden them — matched by id, never by status. */
let toggledIds: string[] = [];

/** Must retrieve NOTHING. The last three share a word with the corpus, which is the case a
 *  bare rank floor cannot separate from relevance. */
const OFF_TOPIC = [
  "capital city of portugal",
  "replace the alternator on a transit van",
  "who won the football last night",
  "what is the boiling point of water in fahrenheit",
  "best way to cook a medium rare steak",
  "when did the second world war end",
];

/** Real client phrasings, with the hand-written slug that should still win. */
const COVERAGE: [string, string][] = [
  ["how do i point my own web address at my funnel", "connecting-your-own-domain"],
  ["my text messages arent going through to anyone", "texts-not-sending"],
  ["people keep not turning up to their appointments", "appointment-reminders"],
  ["can i charge a deposit before someone books a slot", "taking-payment-at-booking"],
  ["why does my email keep landing in junk", "why-emails-go-to-spam"],
  ["a customer got the exact same message twice", "an-automation-sent-twice"],
  ["how do i copy my whole setup into a new client account", "copying-a-setup-into-another-account"],
  ["i need a client to sign an agreement electronically", "documents-and-contracts"],
  ["they paid me and never received what they bought", "customer-paid-but-nothing-happened"],
  ["how do i put a video lesson behind a login", "building-a-course"],
];

interface Measurement {
  label: string;
  corpus: number;
  offTopicLeaks: { q: string; hits: number; sample: string }[];
  coverageTop1: number;
  coverageTop3: number;
  coverageMissing: string[];
}

async function measure(label: string): Promise<Measurement> {
  const corpus = await prisma.kbArticle.count({ where: { status: "ready" } });
  const offTopicLeaks: Measurement["offTopicLeaks"] = [];
  for (const q of OFF_TOPIC) {
    const hits = await searchKb({ query: q, limit: 5 });
    if (hits.length > 0) {
      offTopicLeaks.push({ q, hits: hits.length, sample: String((hits[0] as any).titleNormalized ?? "").slice(0, 48) });
    }
  }
  let top1 = 0;
  let top3 = 0;
  const missing: string[] = [];
  for (const [q, slug] of COVERAGE) {
    const hits = await searchKb({ query: q, limit: 3 });
    const urls = hits.map((h: any) => String(h.sourceUrl ?? ""));
    const at = urls.findIndex((u) => u.endsWith(`/${slug}`));
    if (at === 0) top1++;
    if (at >= 0) top3++;
    else missing.push(slug);
  }
  return { label, corpus, offTopicLeaks, coverageTop1: top1, coverageTop3: top3, coverageMissing: missing };
}

function report(m: Measurement): void {
  console.log(`\n--- ${m.label} (${m.corpus} retrievable) ---`);
  console.log(`  off-topic leaks   : ${m.offTopicLeaks.length}/${OFF_TOPIC.length}`);
  for (const l of m.offTopicLeaks) console.log(`      "${l.q}" -> ${l.hits} hit(s), e.g. ${l.sample}`);
  console.log(`  right article #1  : ${m.coverageTop1}/${COVERAGE.length}`);
  console.log(`  right article top3: ${m.coverageTop3}/${COVERAGE.length}`);
  if (m.coverageMissing.length) console.log(`      missing: ${m.coverageMissing.join(", ")}`);
}

async function main(): Promise<void> {
  // Capture the exact ids first, so the restore cannot pick up anything else.
  const serving = await prisma.kbArticle.findMany({ where: CRAWLED, select: { id: true } });
  toggledIds = serving.map((r) => r.id);
  if (toggledIds.length === 0) throw new Error("no crawled rows are serving — nothing to measure");
  console.log(`\n${toggledIds.length} crawled article(s) serving. Toggling them to isolate their effect.`);

  // BEFORE: hide the crawled rows from retrieval without deleting them.
  await prisma.kbArticle.updateMany({ where: { id: { in: toggledIds } }, data: { status: "archived" } });
  const before = await measure("WITHOUT crawled articles");

  await prisma.kbArticle.updateMany({ where: { id: { in: toggledIds } }, data: { status: "ready" } });
  const after = await measure("WITH crawled articles");

  report(before);
  report(after);

  console.log(`\n${"=".repeat(58)}`);
  const leakDelta = after.offTopicLeaks.length - before.offTopicLeaks.length;
  const top1Delta = after.coverageTop1 - before.coverageTop1;
  console.log(`  corpus        ${before.corpus} -> ${after.corpus}`);
  console.log(`  off-topic     ${before.offTopicLeaks.length} -> ${after.offTopicLeaks.length} leaks  (${leakDelta >= 0 ? "+" : ""}${leakDelta})`);
  console.log(`  right-first   ${before.coverageTop1} -> ${after.coverageTop1}          (${top1Delta >= 0 ? "+" : ""}${top1Delta})`);

  if (leakDelta > 0) {
    console.log(
      `\n  ⚠ THE FAIL-SAFE DEGRADED because of the crawl. Off-topic questions that used to\n` +
        `    reach a human now get an answer assembled from whatever shared two words with\n` +
        `    them. Raise DEFAULT_MIN_RANK / MIN_LOOSE_TERM_HITS in kbSearch.ts, re-run this,\n` +
        `    and record the new measured numbers above the constant.`
    );
  }
  if (top1Delta < 0) {
    console.log(
      `\n  ⚠ DILUTION: ${-top1Delta} question(s) no longer surface the hand-written article first.\n` +
        `    Agency + hand-written content is meant to outrank crawled vendor docs.`
    );
  }
  if (leakDelta <= 0 && top1Delta >= 0) {
    console.log(`\n  ✓ No degradation in either direction at this corpus size.`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    // Restore even on a crash. Dying midway would otherwise leave the whole crawled corpus
    // archived, which reads as "the crawl did nothing" the next time anybody looks.
    if (toggledIds.length > 0) {
      await prisma.kbArticle
        .updateMany({ where: { id: { in: toggledIds } }, data: { status: "ready" } })
        .catch(() => {});
    }
    await prisma.$disconnect();
  });
