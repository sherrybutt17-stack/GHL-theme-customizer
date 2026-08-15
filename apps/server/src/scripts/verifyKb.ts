import "../services/loadEnv";

import { prisma } from "../services/prisma";
import { ingestArticle } from "../services/kbIngest";
import { searchKb, listQuarantined, kbStats } from "../services/kbSearch";
import { renderForBrand } from "../services/kbNormalize";
import { findBrandLeaks } from "../services/brandLexicon";

const pad = (s: string) => s.padEnd(14);

async function main() {
  await prisma.kbArticle.deleteMany({ where: { sourceUrl: { startsWith: "https://verify.test/" } } });

  console.log("=== 1. INGEST ===");
  const clean = await ingestArticle(
    {
      url: "https://verify.test/pipelines",
      title: "How to Create a Pipeline in HighLevel",
      body:
        "<article><p>GoHighLevel makes deal tracking easy. In GHL, open <b>Opportunities</b> from the sidebar. " +
        "Click Opportunities then Pipelines to add stages. Drag a card between stages to update it. " +
        "Your contacts sync automatically from Contacts. For a high-level overview see Reporting. " +
        "Need help? Visit https://help.gohighlevel.com/x or email support@gohighlevel.com.</p></article>",
      isHtml: true,
    },
    { source: "ghl" }
  );
  console.log(`  ${pad("clean article")} → ${clean.status}`);

  const memb = await ingestArticle(
    {
      url: "https://verify.test/memberships",
      title: "Setting Up Memberships",
      body:
        "<article><p>Memberships let you sell courses. Open Memberships from the sidebar and click New Product. " +
        "Add lessons, then publish. Members receive an email invitation. You can also track them in Contacts. " +
        "Pricing is configured per offer and supports one-time or recurring billing options.</p></article>",
      isHtml: true,
    },
    { source: "ghl" }
  );
  console.log(`  ${pad("memberships")} → ${memb.status}`);

  // A lookalike the lexicon cannot repair. MUST be quarantined, not served.
  const quar = await ingestArticle(
    {
      url: "https://verify.test/quarantine-me",
      title: "Support Overview",
      body:
        "<article><p>Welcome to GoHighLeveI support, where the capital i makes this a lookalike the replacer " +
        "cannot fix. This article should be quarantined rather than served to any client whatsoever. " +
        "It contains enough text to pass the minimum body length requirement for ingestion here.</p></article>",
      isHtml: true,
    },
    { source: "ghl" }
  );
  console.log(`  ${pad("lookalike")} → ${quar.status} (${quar.residualCount} residual)`);

  console.log("\n=== 2. SEARCH (no filters) ===");
  const hits = await searchKb({ query: "how do I create a pipeline" });
  for (const h of hits) console.log(`  [${h.rank.toFixed(4)}] ${h.source}  ${h.titleNormalized}`);

  console.log("\n=== 3. QUARANTINED ARTICLE MUST NOT BE RETRIEVABLE ===");
  const q = await searchKb({ query: "GoHighLeveI support overview welcome" });
  console.log(`  hits: ${q.length} → ${q.length === 0 ? "PASS (quarantined, unreachable)" : "FAIL: " + q.map((h) => h.titleNormalized)}`);

  console.log("\n=== 4. hiddenFeatures FILTER ===");
  const withMemb = await searchKb({ query: "memberships courses sell" });
  const withoutMemb = await searchKb({ query: "memberships courses sell", hiddenFeatures: ["memberships"] });
  console.log(`  memberships visible → ${withMemb.length} hit(s)`);
  console.log(`  memberships hidden  → ${withoutMemb.length} hit(s)  ${withoutMemb.length < withMemb.length ? "PASS" : "FAIL"}`);

  console.log("\n=== 5. AGENCY CONTENT OUTRANKS GHL CONTENT ===");
  const agency = await prisma.agencyInstall.findFirst();
  if (agency) {
    await prisma.kbArticle.deleteMany({ where: { sourceUrl: "https://verify.test/our-pipeline-sop" } });
    await ingestArticle(
      {
        url: "https://verify.test/our-pipeline-sop",
        title: "Our Pipeline SOP",
        body:
          "This is our own internal process for creating a pipeline for a new client account. " +
          "Follow the onboarding checklist first, then create the pipeline with our standard stages. " +
          "Always confirm the stage names with the account manager before going live with the client.",
        isHtml: false,
      },
      { source: "agency", agencyInstallId: agency.id }
    );
    const ranked = await searchKb({ query: "create a pipeline", agencyInstallId: agency.id });
    for (const h of ranked) console.log(`  [${h.rank.toFixed(4)}] ${pad(h.source)} ${h.titleNormalized}`);
    console.log(`  top result is agency-authored → ${ranked[0]?.source === "agency" ? "PASS" : "FAIL"}`);

    console.log("\n=== 6. TENANT ISOLATION (other agency must not see it) ===");
    const other = await searchKb({ query: "create a pipeline", agencyInstallId: "some-other-agency-id" });
    const leaked = other.some((h) => h.source === "agency");
    console.log(`  other tenant sees agency content → ${leaked ? "FAIL" : "PASS (only shared GHL content)"}`);
  } else {
    console.log("  (no agency in local DB; skipped)");
  }

  console.log("\n=== 7. RENDER A RETRIEVED CHUNK FOR ONE SUB-ACCOUNT ===");
  const top = (await searchKb({ query: "create a pipeline opportunities" }))[0];
  if (top) {
    const rendered = renderForBrand(top.bodyNormalized, "Acme Portal", { opportunities: "Leads", contacts: "People" });
    console.log("  " + rendered.replace(/\n/g, "\n  ").slice(0, 400));
    const leaks = findBrandLeaks(rendered);
    console.log(`\n  leaks in rendered output: ${leaks.length === 0 ? "NONE (PASS)" : JSON.stringify(leaks)}`);
  }

  console.log("\n=== 8. MALFORMED QUERY MUST NOT THROW ===");
  for (const bad of ["pipeline & ", "'; DROP TABLE \"KbArticle\"; --", "((((", "!@#$%^&*", '"unclosed']) {
    try {
      const r = await searchKb({ query: bad });
      console.log(`  ${pad(JSON.stringify(bad).slice(0, 12))} → ok (${r.length} hits)`);
    } catch (e) {
      console.log(`  ${pad(JSON.stringify(bad).slice(0, 12))} → THREW: ${(e as Error).message.slice(0, 90)}`);
    }
  }

  console.log("\n=== 9. QUARANTINE QUEUE + STATS ===");
  const queue = await listQuarantined();
  console.log(`  quarantined: ${queue.length}`);
  for (const a of queue) console.log(`    ${a.titleNormalized} — ${JSON.stringify(a.residualLeaks).slice(0, 90)}`);
  console.log(`  stats: ${JSON.stringify(await kbStats())}`);

  console.log("\n=== CLEANUP ===");
  const del = await prisma.kbArticle.deleteMany({ where: { sourceUrl: { startsWith: "https://verify.test/" } } });
  console.log(`  removed ${del.count} test article(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
