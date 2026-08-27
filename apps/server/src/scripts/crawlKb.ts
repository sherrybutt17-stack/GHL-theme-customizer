import "../services/loadEnv";

import { prisma } from "../services/prisma";
import { crawlHelpCenter } from "../services/kbIngest";

/**
 * Crawl a help centre into the knowledge base.
 *
 *   npm run crawl-kb --workspace @ghl-theme-builder/server -- \
 *     --origin https://help.example.com --prefix /support/solutions --max 50 --dry-run
 *
 * ALWAYS do a --dry-run first. It normalizes and reports what would happen without
 * writing anything, which is when bad content extraction and unknown brand phrasings
 * are cheapest to find.
 *
 * The crawl is deliberately slow and serialised (see kbIngest: robots.txt is honoured,
 * requests are spaced, and only excerpts are stored - never a wholesale mirror).
 */
function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(`--${flag}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const origin = arg("origin");
  if (!origin) {
    console.error("Usage: --origin https://help.example.com [--prefix /path] [--sitemap /support/sitemap.xml] [--max 50] [--dry-run]");
    process.exit(1);
  }

  const maxPages = Number(arg("max") ?? 25);
  const dryRun = process.argv.includes("--dry-run");
  const prefixes = arg("prefix") ? [arg("prefix") as string] : undefined;
  const sitemapUrl = arg("sitemap");
  // 0 re-fetches everything; the default skips anything crawled in the last 7 days so a
  // run resumes instead of restarting.
  const refetchAfterDays = arg("refetch-after") !== undefined ? Number(arg("refetch-after")) : undefined;

  console.log(`Crawling ${origin}${prefixes ? ` (prefix ${prefixes.join(", ")})` : ""}`);
  if (sitemapUrl) console.log(`  sitemap:   ${sitemapUrl}`);
  console.log(`  max pages: ${maxPages}${dryRun ? "   DRY RUN - nothing will be written" : ""}\n`);

  const summary = await crawlHelpCenter({ origin, pathPrefixes: prefixes, maxPages, dryRun, sitemapUrl, refetchAfterDays });

  console.log("\n--- summary ---");
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(12)} ${v}`);

  if (summary.quarantined > 0) {
    console.log(
      `\n⚠  ${summary.quarantined} article(s) quarantined: normalization left a brand term behind, so they are ` +
        `NOT retrievable. Review them and extend services/brandLexicon.ts if a new phrasing turned up.`
    );
  }
  if (summary.abortReason) {
    console.log(`\n⚠  THE CRAWL STOPPED EARLY — this is NOT a complete crawl.\n   ${summary.abortReason}`);
  } else if (summary.truncated) {
    console.log(`\n⚠  Coverage was CAPPED at --max ${maxPages}. This is not a complete crawl.`);
  }
}

main()
  .catch((e) => {
    console.error("Crawl failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
