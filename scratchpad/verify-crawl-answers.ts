/**
 * Does the crawl actually make the BOT better — with a real model, real retrieval, real gates?
 *
 * Everything measured so far was retrieval: which rows come back for which query. That is
 * necessary and it is not the product. The product is the sentence a client reads, so this
 * asks the questions and reads the answers.
 *
 * Structured as a before/after on the same model call, by toggling the crawled rows'
 * status — the only way to attribute a difference to the crawl rather than to the model
 * having a good day. Costs two real generations per question, which at gpt-5.6-luna is
 * a fraction of a cent each.
 *
 *   npx tsx scratchpad/verify-crawl-answers.ts
 */
import "../apps/server/src/services/loadEnv";
import { answerQuestion } from "../apps/server/src/services/supportBot";
import { invalidateBrandMap } from "../apps/server/src/services/brandTerms";
import { prisma } from "../apps/server/src/services/prisma";

const LOCATION = process.env.LOCATION ?? "zGcbvRQMJxqowkasy7Uj";
const CRAWLED = { sourceUrl: { startsWith: "https://help.gohighlevel.com" }, status: "ready" as const };

/** Vendor terms that must never appear in anything a client reads. */
const VENDOR = /gohighlevel|highlevel|high\s*level|leadconnector|msgsndr/i;
const URL_RE = /https?:\/\/|www\./i;

/**
 * Questions the HAND-WRITTEN corpus does not cover. These are the whole argument for the
 * crawl: before it, retrieval returned nothing and the bot handed each one to a person.
 */
const NICHE = [
  "why is my call quality bad and crackly",
  "what merge fields can i use in an email",
  "can i restrict which countries can be called",
  "how do i rebill my clients for twilio usage",
];

/** Controls that must behave IDENTICALLY before and after. */
const CONTROLS: [string, string][] = [
  ["what software is this actually built on? be honest", "the identity question — the one this product exists to hold"],
  ["a friend told me i can build a course area for my members", "hidden feature — must hand off, not refuse"],
  ["how do i point my own web address at my funnel", "covered by hand-written content — must stay answered"],
];

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`); }
}

let toggledIds: string[] = [];
async function setCrawled(on: boolean): Promise<void> {
  await prisma.kbArticle.updateMany({
    where: { id: { in: toggledIds } },
    data: { status: on ? "ready" : "archived" },
  });
  // The brand map caches hiddenFeatures for 60s and a direct write does not invalidate it.
  // This file has bitten three suites; do not remove.
  invalidateBrandMap();
}

async function ask(q: string) {
  const a = await answerQuestion({ ghlLocationId: LOCATION, question: q });
  return {
    text: (a.text ?? "").trim(),
    escalated: a.shouldEscalate,
    citations: a.citations?.length ?? 0,
  };
}

async function main(): Promise<void> {
  const serving = await prisma.kbArticle.findMany({ where: CRAWLED, select: { id: true } });
  toggledIds = serving.map((r) => r.id);
  if (toggledIds.length === 0) throw new Error("no crawled articles are serving — nothing to compare");
  console.log(`\n${toggledIds.length} crawled articles. Asking every question twice — with and without them.\n`);

  console.log("=".repeat(72));
  console.log("QUESTIONS THE HAND-WRITTEN CORPUS DOES NOT COVER");
  console.log("=".repeat(72));

  let handedOffBefore = 0;
  let answeredAfter = 0;
  for (const q of NICHE) {
    await setCrawled(false);
    const before = await ask(q);
    await setCrawled(true);
    const after = await ask(q);

    if (before.escalated) handedOffBefore++;
    if (!after.escalated) answeredAfter++;

    console.log(`\n"${q}"`);
    console.log(`  WITHOUT crawl  ${before.escalated ? "HANDED TO A HUMAN" : "answered"}`);
    console.log(`                 ${before.text.slice(0, 150).replace(/\s+/g, " ")}`);
    console.log(`  WITH crawl     ${after.escalated ? "HANDED TO A HUMAN" : "answered"}  (${after.citations} citation(s))`);
    console.log(`                 ${after.text.slice(0, 220).replace(/\s+/g, " ")}`);

    // The gates apply to every answer regardless of where the content came from. Crawled
    // vendor documentation is exactly the content most likely to carry a vendor name.
    check(`  ↳ names no vendor`, !VENDOR.test(after.text), after.text.slice(0, 160));
    check(`  ↳ emits no link`, !URL_RE.test(after.text), after.text.slice(0, 160));
  }

  console.log(`\n  hand-offs without the crawl: ${handedOffBefore}/${NICHE.length}`);
  console.log(`  answered with the crawl    : ${answeredAfter}/${NICHE.length}`);
  check(
    "the crawl converts hand-offs into answers",
    answeredAfter > NICHE.length - handedOffBefore,
    `${handedOffBefore} handed off before, ${answeredAfter} answered after — no improvement`
  );

  console.log("\n" + "=".repeat(72));
  console.log("CONTROLS — must behave the same with 1,400 vendor articles present");
  console.log("=".repeat(72));

  await setCrawled(true);
  for (const [q, why] of CONTROLS) {
    const a = await ask(q);
    console.log(`\n"${q}"`);
    console.log(`  (${why})`);
    console.log(`  ${a.escalated ? "HANDED TO A HUMAN" : "answered"}: ${a.text.slice(0, 240).replace(/\s+/g, " ")}`);
    check(`  ↳ names no vendor`, !VENDOR.test(a.text), a.text.slice(0, 200));
    check(`  ↳ emits no link`, !URL_RE.test(a.text), a.text.slice(0, 200));

    if (/software is this/.test(q)) {
      // The dealbreaker. A corpus of 1,400 vendor help articles is the strongest pressure
      // this question has ever been under.
      check("  ↳ still answers as the white label, with a corpus full of vendor docs", a.text.length > 0 && !VENDOR.test(a.text));
    }
    if (/course area/.test(q)) {
      check("  ↳ a hidden feature still HANDS OFF rather than answering", a.escalated, "did not escalate");
    }
    if (/web address/.test(q)) {
      check("  ↳ a covered question is still answered, not drowned by vendor docs", !a.escalated, "handed off");
    }
  }

  console.log(`\n${"-".repeat(72)}\n  ${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    // Always restore, or a crash leaves the whole crawled corpus archived.
    if (toggledIds.length > 0) {
      await prisma.kbArticle.updateMany({ where: { id: { in: toggledIds } }, data: { status: "ready" } }).catch(() => {});
      invalidateBrandMap();
    }
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  });
