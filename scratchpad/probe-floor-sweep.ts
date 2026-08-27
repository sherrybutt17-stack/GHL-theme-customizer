/**
 * Re-sweep `DEFAULT_MIN_RANK` on BOTH axes, at the width the question sets actually have.
 *
 * The table recorded above the constant in `kbSearch.ts` swept two axes — off-topic leaks
 * and "answerable questions still retrieving" — but the second axis was TEN questions, and
 * `verify-kb-coverage` asks THIRTY. At thirty, 0.25 silences four of them completely:
 *
 *   coupons-and-discounts · the-chat-widget-on-your-website · custom-fields · products-and-prices
 *
 * Zero rows is not a soft failure. `supportBot` reads it as thin retrieval and hands the
 * client to a human, so "i want to give someone ten percent off at checkout" files a
 * support ticket while the article answering it sits in the corpus, `ready`. That is the
 * shape this file calls the worst bug the bot has had, and the two-pass retrieval that
 * fixed it was signed off at "0 retrieving nothing".
 *
 * Neither axis is optional: drop the floor and off-topic questions stop reaching a person,
 * which is the failure the floor exists to prevent. So this prints both, and the choice has
 * to be made on both.
 *
 * FOUR LEVERS WERE TESTED. Only the first two are swept here; the other two are recorded
 * because the negative results are the useful part and re-deriving them costs an hour:
 *
 *   1. minRank              swept below. The zero-leak window (>= 0.25) and the
 *                           zero-silence window (<= 0.20) NO LONGER OVERLAP. They did at
 *                           412 articles, which is when the table above the constant was
 *                           written — and that table is now stale in the dangerous
 *                           direction: it records 0.20 as 0/6 leaks, measured 2/6.
 *   2. MIN_LOOSE_TERM_HITS  swept below. Raising it to 4 buys 0 leaks at floor 0.10 with
 *                           2 silenced instead of 4 — better on the axis that matters and
 *                           worse on "answered from the right article first" (9 vs 11).
 *   3. ts_rank NORMALISATION (0 / 1 / 16 / 32 / 33). Length normalisation is the textbook
 *                           answer here, because every leaking article is LONG — 42k, 23k,
 *                           20k, 18k chars — and unnormalised ts_rank rewards documents
 *                           that contain more of everything. It NARROWS the overlap (32%
 *                           of the wanted articles' range at norm 0, 11% at norm 1) and
 *                           never inverts it. No floor separates the two sets under any
 *                           normalisation.
 *   4. THE 424 HTML-FALLBACK ARTICLES (36% of the crawl: `<title>` ends "Support Portal"
 *                           and the body still carries portal chrome). Archiving them
 *                           changes off-topic leaks by ZERO at every floor — so they are
 *                           not the leak source, which was my hypothesis and was wrong.
 *                           They DO crowd out real answers: "in top 5" went 20 -> 24 at
 *                           floor 0.10 without them. A corpus-quality problem, not a
 *                           fail-safe one.
 *
 * What the leaks actually are: ordinary English. "when did the second world war end"
 * matches on when/second/world; "best way to cook a medium rare steak" on best. A CRM help
 * centre says "wait 30 seconds", "worldwide", "when the workflow runs", "best practices" —
 * so a large corpus of verbose vendor documentation defeats a two-distinct-terms rule that
 * held comfortably over 253 hand-written articles.
 *
 *   npx tsx scratchpad/probe-floor-sweep.ts
 */
import "../apps/server/src/services/loadEnv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { looseTerms, searchKb, toLooseQuery } from "../apps/server/src/services/kbSearch";
import { prisma } from "../apps/server/src/services/prisma";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Both question sets are read OUT OF the suites that own them, so this cannot drift into
 * sweeping a private copy and reporting a number the suites disagree with — the same rule
 * that made the keep-warm harness extract its script from the workflow file.
 */
function probesFrom(file: string, startMarker: string): [string, string][] {
  const src = readFileSync(join(HERE, file), "utf8");
  const at = src.indexOf(startMarker);
  if (at < 0) throw new Error(`no ${JSON.stringify(startMarker)} in ${file}`);
  const body = src.slice(at, src.indexOf("];", at));
  const out: [string, string][] = [];
  for (const m of body.matchAll(/\["([^"]+)",\s*"([^"]+)"\]/g)) out.push([m[1], m[2]]);
  if (out.length < 10) throw new Error(`only ${out.length} probes parsed from ${file} — extractor is wrong`);
  return out;
}
function listFrom(file: string, startMarker: string): string[] {
  const src = readFileSync(join(HERE, file), "utf8");
  const at = src.indexOf(startMarker);
  if (at < 0) throw new Error(`no ${JSON.stringify(startMarker)} in ${file}`);
  const body = src.slice(at, src.indexOf("];", at));
  const out = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((s) => s.includes(" "));
  if (out.length < 4) throw new Error(`only ${out.length} entries parsed from ${file} — extractor is wrong`);
  return out;
}

const COVERAGE = probesFrom("verify-kb-coverage.ts", "const PROBES:");
const OFF_TOPIC = listFrom("probe-floor.ts", "const OFF_TOPIC = [");

const FLOORS = [0.1, 0.15, 0.2, 0.25, 0.3];
/** The shipped value is 2. Swept because the diagnosis points here, not at the floor. */
const TERM_HITS = [2, 3, 4];

/**
 * The shipped WHERE clauses with the two knobs varied. Reproduced rather than called,
 * because `MIN_LOOSE_TERM_HITS` is a module constant with no option to override it — and
 * the strict pass is included so this measures the same two-pass result `searchKb` returns,
 * not just the loose half.
 */
async function search(q: string, termHits: number, floor: number, take = 5): Promise<string[]> {
  const text = toLooseQuery(q);
  const terms = looseTerms(q);
  // The floor is compared against the SAME expression the ordering uses — provenance
  // multiplier included — because that is what `searchKb` does. It did not, until the
  // reproduction below caught it: the WHERE clause floored the RAW ts_rank while the
  // ORDER BY ranked the boosted one, so the provenance decision applied only to rows that
  // had already survived a bar set as if it did not exist.
  const RANK = `(ts_rank("searchVector", websearch_to_tsquery('english',$1))
      * CASE WHEN "source"='agency' THEN 1.5 WHEN "sourceUrl" LIKE 'mosaic:kb/%' THEN 1.25 ELSE 1.0 END)`;
  const strict = await prisma.$queryRawUnsafe<{ sourceUrl: string }[]>(
    `SELECT "sourceUrl" FROM "KbArticle"
     WHERE status='ready' AND "searchVector" @@ websearch_to_tsquery('english', $1)
     ORDER BY ${RANK} DESC LIMIT ${take}`, q);
  const loose = await prisma.$queryRawUnsafe<{ sourceUrl: string }[]>(
    `SELECT "sourceUrl" FROM "KbArticle"
     WHERE status='ready' AND "searchVector" @@ websearch_to_tsquery('english', $1)
       AND ${RANK} >= ${floor}
       AND (cardinality($2::text[]) < 3 OR (
         SELECT count(*) FROM unnest($2::text[]) AS t(term)
         WHERE "searchVector" @@ websearch_to_tsquery('english', t.term)) >= ${termHits})
     ORDER BY ${RANK} DESC LIMIT ${take}`, text, terms);
  const seen = new Set(strict.map((r) => r.sourceUrl));
  return [...strict, ...loose.filter((r) => !seen.has(r.sourceUrl))].slice(0, take).map((r) => String(r.sourceUrl));
}

/**
 * THE CONTROL, and it is not optional.
 *
 * `search()` above REPRODUCES the shipped query rather than calling it, because
 * `MIN_LOOSE_TERM_HITS` is a module constant with no option to override — and a
 * reproduction is a copy, so it drifts. It did, within one turn: the floor basis was fixed
 * in `kbSearch.ts` and this file went on quietly reporting the old numbers as if they were
 * current, which is worse than not measuring at all.
 *
 * So before sweeping anything, the reproduction must AGREE with the real `searchKb` at the
 * shipped settings. It throws rather than warns: a sweep whose baseline disagrees with the
 * product is a table of numbers about nothing.
 */
async function selfCheck(): Promise<void> {
  const sample = COVERAGE.slice(0, 8).map(([q]) => q).concat(OFF_TOPIC.slice(0, 3));
  for (const q of sample) {
    const mine = await search(q, 2, 0.25);
    const real = (await searchKb({ query: q, agencyInstallId: null, minRank: 0.25, limit: 5 }))
      .map((h) => String(h.sourceUrl ?? ""));
    if (JSON.stringify(mine) !== JSON.stringify(real)) {
      throw new Error(
        `the reproduction has drifted from searchKb — this sweep would report numbers the product does not produce.\n` +
        `  question: ${q}\n  probe:    ${JSON.stringify(mine)}\n  searchKb: ${JSON.stringify(real)}`
      );
    }
  }
  console.log(`\nself-check: the reproduced query matches searchKb on ${sample.length} questions at the shipped settings.`);
}

async function main(): Promise<void> {
  await selfCheck();
  const total = await prisma.kbArticle.count({ where: { status: "ready" } });
  const crawled = await prisma.kbArticle.count({ where: { status: "ready", sourceUrl: { startsWith: "https://" } } });
  console.log(`\ncorpus: ${total} retrievable (${crawled} crawled, ${total - crawled} hand-written)`);
  console.log(`sets:   ${COVERAGE.length} coverage questions, ${OFF_TOPIC.length} off-topic controls`);
  console.log(`\n  A LEAK is an unanswerable question that retrieved something — the client gets a`);
  console.log(`  confident answer assembled from two shared words. SILENCED is an answerable one`);
  console.log(`  that retrieved NOTHING — supportBot reads that as thin retrieval and files a`);
  console.log(`  ticket, with the article that answers it sitting in the corpus, ready.\n`);

  console.log("  termHits | floor | leaks | silenced | wanted 1st | in top 5");
  console.log("  ---------+-------+-------+----------+------------+---------");
  const rows: { termHits: number; floor: number; leaks: number; empty: number; first: number; top5: number; silenced: string[] }[] = [];
  for (const termHits of TERM_HITS) {
    for (const floor of FLOORS) {
      let leaks = 0;
      for (const q of OFF_TOPIC) if ((await search(q, termHits, floor)).length) leaks++;
      let empty = 0, first = 0, top5 = 0;
      const silenced: string[] = [];
      for (const [q, want] of COVERAGE) {
        const urls = await search(q, termHits, floor);
        if (!urls.length) { empty++; silenced.push(want); continue; }
        const slugs = urls.map((u) => u.replace("mosaic:kb/", ""));
        if (slugs[0] === want) first++;
        if (slugs.includes(want)) top5++;
      }
      rows.push({ termHits, floor, leaks, empty, first, top5, silenced });
      const shipped = termHits === 2 && floor === 0.25 ? "  <- shipped" : "";
      const clean = leaks === 0 && empty === 0 ? "  <== CLEAN ON BOTH" : "";
      console.log(
        `      ${termHits}    |  ${floor.toFixed(2)} |  ${String(leaks).padStart(2)}/${OFF_TOPIC.length}  |` +
        `   ${String(empty).padStart(2)}/${COVERAGE.length}   |    ${String(first).padStart(2)}/${COVERAGE.length}    |  ${String(top5).padStart(2)}/${COVERAGE.length}${shipped}${clean}`
      );
    }
  }

  const clean = rows.filter((r) => r.leaks === 0 && r.empty === 0);
  console.log("\n== verdict ==");
  if (clean.length) {
    console.log(`  ${clean.length} setting(s) clean on both axes: ` +
      clean.map((r) => `termHits=${r.termHits}/floor=${r.floor}`).join(", "));
  } else {
    console.log("  NO setting is clean on both axes. The windows have stopped overlapping:");
    const noLeak = rows.filter((r) => r.leaks === 0);
    const noSilence = rows.filter((r) => r.empty === 0);
    console.log(`    zero leaks    : ${noLeak.map((r) => `${r.termHits}/${r.floor}`).join(", ") || "none"}`);
    console.log(`    zero silenced : ${noSilence.map((r) => `${r.termHits}/${r.floor}`).join(", ") || "none"}`);
    const best = rows.reduce((a, b) => (b.leaks + b.empty < a.leaks + a.empty ? b : a));
    const ship = rows.find((r) => r.termHits === 2 && r.floor === 0.25)!;
    console.log(`  fewest total failures: termHits=${best.termHits} floor=${best.floor} ` +
      `(${best.leaks} leaks + ${best.empty} silenced), against shipped ${ship.leaks} + ${ship.empty}`);
    console.log(`  shipped currently silences: ${ship.silenced.join(", ")}`);
    console.log("\n  This is a JUDGEMENT, not a tuning: leaking answers an unanswerable question");
    console.log("  wrongly; silencing files a ticket for one the corpus can answer. Both are");
    console.log("  real costs and no setting avoids both, so it is not mine to pick.");
  }
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
