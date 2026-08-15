import "../services/loadEnv";
import { ingestArticle, previewNormalization } from "../services/kbIngest";
import { prisma } from "../services/prisma";
import { AREAS, ARTICLES, findDuplicateSlugs, seedKey } from "./kb";

/**
 * Seed the knowledge base with original, hand-written help content.
 *
 *   npm run seed-kb --workspace @ghl-theme-builder/server
 *   npm run seed-kb --workspace @ghl-theme-builder/server -- --dry-run
 *   npm run seed-kb --workspace @ghl-theme-builder/server -- --replace
 *
 * WHY THIS EXISTS rather than a crawl. The safest corpus is content we wrote ourselves:
 * it carries no crawl-legality question, needs no takedown story, and can be written
 * brand-neutral from the start instead of relying on normalization to strip a vendor
 * name out afterwards. Every article is written from scratch, describes generic CRM
 * workflows, and names no vendor at any point.
 *
 * Stored SHARED (agencyInstallId = null) so every agency benefits, and ranked BELOW an
 * agency's own articles at retrieval — theirs describe their actual process, ours only
 * describe the platform.
 *
 * They still go through the same normalization as anything else, which is the point:
 * feature names become {{FEATURE:key}} placeholders, so a client whose sidebar says
 * "Leads" is told to click Leads, not Opportunities.
 *
 * IDEMPOTENT SINCE THE SLUG EXISTED. Each article is ingested under a synthetic
 * `mosaic:kb/<slug>` source key, so a second run updates in place and an unchanged
 * article short-circuits on its content hash. Before that, seeding twice duplicated the
 * whole corpus (11 articles became 32 exactly this way) because `ingestArticle` upserts
 * on `sourceUrl` and plain-creates when there isn't one. `--replace` is consequently no
 * longer needed for routine re-seeding; it remains for a deliberate reset.
 */

const DRY_RUN = process.argv.includes("--dry-run");
const REPLACE = process.argv.includes("--replace");

/**
 * Check every article WITHOUT writing anything.
 *
 * Worth having as its own mode because the two failure modes are silent in different
 * ways: a quarantined article is stored but invisible to retrieval, and a too-short one
 * is skipped entirely. Both read as "the bot doesn't know that" weeks later, which is
 * the hardest kind of gap to trace back to its cause.
 */
async function lint(): Promise<number> {
  let problems = 0;

  const dupes = findDuplicateSlugs();
  if (dupes.length) {
    console.error(`DUPLICATE SLUGS (each would overwrite the other): ${dupes.join(", ")}\n`);
    problems += dupes.length;
  }

  for (const { area, articles } of AREAS) {
    console.log(`\n${area} (${articles.length})`);
    for (const a of articles) {
      const p = await previewNormalization({ title: a.title, body: a.body, isHtml: false });
      const flags: string[] = [];
      if (p.wouldQuarantine) {
        flags.push(`QUARANTINE: ${p.residualLeaks.map((l) => `${l.id}:"${l.match}"`).join(", ")}`);
      }
      // 40 rather than the crawler's 200: the floor exists to reject nav stubs, and a
      // genuinely short answer is legitimate here. Anything under 300 is still worth a
      // look, since a thin article ranks poorly and answers thinly.
      if (p.bodyLength < 300) flags.push(`THIN (${p.bodyLength} chars)`);

      /**
       * A tag with no matching placeholder anywhere in the text.
       *
       * Tagging is case-INSENSITIVE and replacement is case-SENSITIVE, deliberately —
       * so a tag with no `{{FEATURE:key}}` beside it means the ONLY match was ordinary
       * lowercase English. "that is worth reporting" tagged an article about branding
       * with `reporting`, and `featureTags && hiddenFeatures` then hides it from every
       * client whose agency hid the Reporting menu. Silent, and impossible to notice
       * from the article itself.
       *
       * The fix is always the prose, never the tagger: case-insensitive tagging is what
       * stops "you can sell memberships to your course" reaching a client who has no
       * Memberships menu, and that failure is far worse than a missing article.
       */
      const placeholdered = `${p.titleNormalized}\n${p.bodyNormalized}`;
      const looseTags = p.featureTags.filter((k) => !placeholdered.includes(`{{FEATURE:${k}}}`));
      if (looseTags.length) flags.push(`tagged from lowercase prose only: ${looseTags.join(",")}`);

      if (flags.length) problems += flags.filter((f) => f.startsWith("QUARANTINE")).length;

      console.log(
        `  ${String(p.bodyLength).padStart(5)}ch  ${p.featureTags.length ? p.featureTags.join(",") : "-"}` +
          `\n         ${a.slug}${flags.length ? `\n         ⚠ ${flags.join(" · ")}` : ""}`
      );
    }
  }
  return problems;
}

async function main(): Promise<void> {
  console.log(`${ARTICLES.length} article(s) across ${AREAS.length} area(s).`);

  const dupes = findDuplicateSlugs();
  if (dupes.length) {
    // Fail before touching the database: a duplicate slug means one article silently
    // overwrites another on every run, and the loss is invisible afterwards.
    console.error(`\nDUPLICATE SLUGS: ${dupes.join(", ")}`);
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  if (DRY_RUN) {
    const problems = await lint();
    console.log(`\nDry run: nothing written. ${problems} article(s) would be quarantined.`);
    await prisma.$disconnect();
    if (problems) process.exitCode = 1;
    return;
  }

  if (REPLACE) {
    const removed = await prisma.kbArticle.deleteMany({ where: { agencyInstallId: null, source: "agency" } });
    console.log(`--replace: removed ${removed.count} existing shared article(s).\n`);
  } else {
    // One-time migration off the pre-slug rows. Those were written with a NULL sourceUrl
    // and therefore cannot be upserted; left in place they would sit alongside the
    // slugged copies forever, and retrieval would return the stale text about as often
    // as the current one.
    const legacy = await prisma.kbArticle.deleteMany({
      where: { agencyInstallId: null, source: "agency", sourceUrl: null },
    });
    if (legacy.count) {
      console.log(`Removed ${legacy.count} pre-slug shared article(s) with no upsert key.\n`);
    }
  }

  const counts: Record<string, number> = {};
  const quarantined: string[] = [];

  for (const { area, articles } of AREAS) {
    console.log(`\n${area}`);
    for (const article of articles) {
      // source "agency" with a null agencyInstallId = written by us, shared with
      // everyone. Not "ghl": nothing here is derived from anybody else's documentation.
      const result = await ingestArticle(
        { url: seedKey(article.slug), title: article.title, body: article.body, isHtml: false },
        { source: "agency", agencyInstallId: null, minBodyChars: 40 }
      );
      counts[result.status] = (counts[result.status] ?? 0) + 1;
      if (result.status === "quarantined") quarantined.push(article.slug);

      const flag = result.status === "quarantined" ? "  <-- BRAND TERM SURVIVED, not retrievable" : "";
      console.log(`  ${result.status.padEnd(11)} ${article.slug}${flag}`);
      if (result.reason) console.log(`              ${result.reason}`);
    }
  }

  console.log(`\n${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}`);

  const ready = await prisma.kbArticle.count({ where: { status: "ready" } });
  const held = await prisma.kbArticle.count({ where: { status: "needs_review" } });
  console.log(`knowledge base now: ${ready} retrievable, ${held} held for review`);

  if (held > 0) {
    console.log(
      `\nA held article means normalization left something brand-shaped behind. That is the\n` +
        `fail-safe working - the article is stored but retrieval skips it. Fix the wording or\n` +
        `teach brandLexicon.ts the term, then re-run.` +
        (quarantined.length ? `\nFrom this run: ${quarantined.join(", ")}` : "")
    );
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
