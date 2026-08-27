import "../services/loadEnv";
import { writeFileSync, readFileSync } from "node:fs";
import { prisma } from "../services/prisma";
import { stripHelpCentreChrome, stripPortalSuffix } from "../services/kbIngest";

/**
 * Repair crawled articles that were stored with the help centre's own page furniture.
 *
 *   npm run repair-kb-chrome --workspace @ghl-theme-builder/server -- --dry-run
 *   npm run repair-kb-chrome --workspace @ghl-theme-builder/server
 *
 * `extractMainContent` states the case in its own doc comment — "Ingesting those means
 * every article carries the same boilerplate, which poisons ranking (every article matches
 * every query)" — and none of its container patterns match a Freshdesk portal, so it fell
 * through to `<body>` and kept the whole page. Measured on this corpus: 424 of 1,190
 * crawled articles (36%), each opening with ~350 characters of navigation and carrying the
 * portal's name in the TITLE, which is weighted A.
 *
 * The pipeline is fixed, so nothing new arrives this way. That does not repair what is
 * already stored, and re-crawling would mean 424 requests to a host that has rate-limited
 * us before — for text we already hold. This edits in place instead.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH:
 *
 *  - `contentHash`. It is the hash of the SOURCE, and leaving it means a later crawl still
 *    short-circuits on an unchanged page, so this repair survives rather than being undone
 *    by the next run.
 *  - `featureTags`. They were computed before placeholdering, from text this script does
 *    not have, so recomputing them from the stored body would UNDER-tag — and under-tagging
 *    is the failure that matters (an article that should be hidden from a client reaches
 *    them), while over-tagging is mild. Drift is reported, never acted on.
 *  - `status` and `residualLeaks`. Removing text cannot introduce a brand term, so the
 *    quarantine decision made at ingest still holds.
 *
 * `searchVector` is a GENERATED column, so it recomputes itself on write — which is the
 * whole point, and the reason it is generated rather than maintained by a trigger.
 */

const DRY = process.argv.includes("--dry-run");
const LIMIT = Number(process.argv[process.argv.indexOf("--limit") + 1]) || Infinity;
const RESTORE = process.argv.includes("--restore") ? process.argv[process.argv.indexOf("--restore") + 1] : null;

/**
 * A real run writes every row it is about to change to a backup file FIRST, and refuses to
 * start if it cannot. This edits text that exists nowhere else — re-crawling to recover it
 * would mean 424 requests to a host that has rate-limited us before — so "undo" has to be a
 * file on disk rather than a plan.
 */
const BACKUP = process.argv.includes("--backup")
  ? process.argv[process.argv.indexOf("--backup") + 1]
  : `kb-chrome-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

async function restore(file: string): Promise<void> {
  const rows: { id: string; titleNormalized: string; bodyNormalized: string }[] = JSON.parse(readFileSync(file, "utf8"));
  let n = 0;
  for (const r of rows) {
    await prisma.kbArticle.update({
      where: { id: r.id },
      data: { titleNormalized: r.titleNormalized, bodyNormalized: r.bodyNormalized },
    }).then(() => n++).catch(() => {});
  }
  console.log(`\nrestored ${n} of ${rows.length} article(s) from ${file}`);
  await prisma.$disconnect();
}

function tagsWithNoEvidence(body: string, tags: string[]): string[] {
  return tags.filter((t) => !body.includes(`{{FEATURE:${t}}}`) && !body.toLowerCase().includes(t.replace(/-/g, " ")));
}

async function main(): Promise<void> {
  if (RESTORE) return restore(RESTORE);

  const rows = await prisma.kbArticle.findMany({
    where: {
      OR: [
        { bodyNormalized: { contains: "Recent Searches" } },
        { titleNormalized: { endsWith: "Support Portal" } },
      ],
    },
    select: { id: true, sourceUrl: true, titleNormalized: true, bodyNormalized: true, featureTags: true, status: true },
  });

  console.log(`\n${DRY ? "DRY RUN — nothing will be written" : "REPAIRING"}`);
  console.log(`${rows.length} article(s) match the furniture signature.\n`);

  if (!DRY && rows.length) {
    // Before the first write, not after the last: a backup taken at the end is missing
    // exactly when the run dies part way.
    writeFileSync(BACKUP, JSON.stringify(rows.map(({ id, titleNormalized, bodyNormalized }) =>
      ({ id, titleNormalized, bodyNormalized })), null, 1));
    console.log(`backup written: ${BACKUP}`);
    console.log(`undo with:  npm run repair-kb-chrome --workspace @ghl-theme-builder/server -- --restore ${BACKUP}\n`);
  }

  let changedBody = 0, changedTitle = 0, unchanged = 0, refused = 0, bytes = 0;
  const tagDrift: string[] = [];
  const samples: string[] = [];
  let n = 0;

  for (const r of rows) {
    if (n++ >= LIMIT) break;
    const title = stripPortalSuffix(r.titleNormalized);
    const body = stripHelpCentreChrome(r.bodyNormalized);
    const bodyMoved = body !== r.bodyNormalized;
    const titleMoved = title !== r.titleNormalized;

    if (!bodyMoved && !titleMoved) { unchanged++; continue; }
    // The stripper's own floor already refuses this, so a shrink to nothing here would be
    // a bug in it rather than a bad article. Counted separately so it cannot hide.
    if (body.length < 200) { refused++; continue; }

    if (bodyMoved) { changedBody++; bytes += r.bodyNormalized.length - body.length; }
    if (titleMoved) changedTitle++;

    const orphaned = tagsWithNoEvidence(body, r.featureTags);
    if (orphaned.length) tagDrift.push(`${orphaned.join(",")}  ${(r.sourceUrl ?? "(no url)").slice(-58)}`);

    if (samples.length < 3 && bodyMoved) {
      samples.push(
        `  ${r.sourceUrl}\n` +
        `    title  ${JSON.stringify(r.titleNormalized.slice(0, 78))}\n` +
        `        -> ${JSON.stringify(title.slice(0, 78))}\n` +
        `    body   ${JSON.stringify(r.bodyNormalized.slice(0, 78))}\n` +
        `        -> ${JSON.stringify(body.slice(0, 78))}`
      );
    }

    if (!DRY) {
      await prisma.kbArticle.update({ where: { id: r.id }, data: { titleNormalized: title, bodyNormalized: body } });
    }
  }

  if (samples.length) console.log("what changes:\n" + samples.join("\n\n") + "\n");
  console.log(`  bodies repaired : ${changedBody}`);
  console.log(`  titles repaired : ${changedTitle}`);
  console.log(`  already clean   : ${unchanged}`);
  console.log(`  refused (too short after the cut): ${refused}`);
  console.log(`  navigation removed: ${(bytes / 1024).toFixed(1)} KB total, ${changedBody ? Math.round(bytes / changedBody) : 0} chars/article`);
  if (tagDrift.length) {
    console.log(`\n  ${tagDrift.length} article(s) keep a featureTag with no evidence left in the body.`);
    console.log(`  REPORTED, NOT FIXED: tags were derived before placeholdering, so recomputing`);
    console.log(`  them here would under-tag, and under-tagging is the failure that reaches a client.`);
    for (const d of tagDrift.slice(0, 8)) console.log(`    ${d}`);
    if (tagDrift.length > 8) console.log(`    …and ${tagDrift.length - 8} more`);
  }
  console.log(DRY ? "\nRe-run without --dry-run to apply." : "\nDone. searchVector recomputed itself (GENERATED column).");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
