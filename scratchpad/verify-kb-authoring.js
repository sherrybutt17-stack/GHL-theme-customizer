/**
 * Live checks for agency-authored KB articles.
 *
 * The two that matter:
 *  - An agency article is shared across ALL their sub-accounts, which carry DIFFERENT
 *    brand names. Hardcoding "Acme Portal" would announce it inside "Beta Hub"'s chat,
 *    so their own brands must be neutralised at ingest.
 *  - An agency pasting vendor documentation must be quarantined, not silently published.
 *
 * Run this with `npx tsx`, not `node`: it imports TypeScript sources directly.
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);

const p = new PrismaClient();
const BASE = "http://localhost:3210";
let pass = 0, fail = 0;
const made = { articles: [], themes: [], agencyB: null };

const check = (name, ok, detail) => {
  if (ok) { console.log(`  ok    ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}`); if (detail) console.log(`        ${detail}`); fail++; }
};

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

(async () => {
  const agencyA = await p.agencyInstall.findFirst({ select: { id: true } });
  const locs = await p.locationInstall.findMany({
    where: { agencyInstallId: agencyA.id, status: "active" }, select: { id: true }, take: 2,
  });

  // Two sub-accounts under ONE agency, branded differently — the whole point.
  for (const [i, loc] of locs.entries()) {
    const t = await p.themeConfig.create({
      data: { locationInstallId: loc.id, brandName: i === 0 ? "Acme Portal" : "Beta Hub", version: 9100 + i },
    });
    made.themes.push(t.id);
  }

  console.log("\n== the agency's own brand names are neutralised ==");
  let r = await call("POST", `/admin/api/${agencyA.id}/kb`, {
    title: "Getting started with Acme Portal",
    body: "Welcome to Acme Portal. To set up your pipeline, open Opportunities from the sidebar and add your stages. Our team reviews your Acme Portal setup in week one.",
  });
  check("article created", r.status === 201, JSON.stringify(r.json)?.slice(0, 200));
  made.articles.push(r.json?.id);
  check("stored ready (not quarantined)", r.json?.status === "ready", r.json?.status);
  check('"Acme Portal" replaced with {{PLATFORM}}', !r.json?.body.includes("Acme Portal") && r.json?.body.includes("{{PLATFORM}}"), r.json?.body);
  check("  ↳ in the title too", !r.json?.title.includes("Acme Portal"), r.json?.title);
  check('"Opportunities" became a feature placeholder', r.json?.body.includes("{{FEATURE:"), r.json?.body);
  check("  ↳ and was tagged for the hidden-features filter", (r.json?.featureTags ?? []).includes("opportunities"), JSON.stringify(r.json?.featureTags));

  console.log("\n== the same article reads correctly for BOTH brands ==");
  /*
   * Imports the SOURCE under tsx, not `dist`. A suite that reads the built artifact is
   * asserting about whatever was there at the last `npm run build:server` — found 2026-08-26
   * when two deliberate mutations to `readiness.ts` left `verify-readiness` 34/34 green and
   * the build turned out to be a day old. Run these with `npx tsx`, not `node`.
   *
   * The `dist/assets` reads elsewhere are a different thing and stay: those deliberately
   * inspect the SHIPPED browser bundle, which is the artifact under test.
   */
  const { renderForBrand } = require(`${ROOT}/apps/server/src/services/kbNormalize.ts`);
  const stored = await p.kbArticle.findUnique({ where: { id: made.articles[0] } });
  const forA = renderForBrand(stored.bodyNormalized, "Acme Portal", { opportunities: "Leads" });
  const forB = renderForBrand(stored.bodyNormalized, "Beta Hub", { opportunities: "Deals" });
  check('renders "Acme Portal" + "Leads" for sub-account A', forA.includes("Acme Portal") && forA.includes("Leads"), forA.slice(0, 100));
  check('renders "Beta Hub" + "Deals" for sub-account B', forB.includes("Beta Hub") && forB.includes("Deals"), forB.slice(0, 100));
  check("  ↳ B's version carries no trace of A's brand", !forB.includes("Acme"), forB.slice(0, 120));

  console.log("\n== pasted vendor documentation is neutralised, not published as-is ==");
  r = await call("POST", `/admin/api/${agencyA.id}/kb`, {
    title: "Pipeline setup",
    body: "GoHighLevel calls these pipelines. In HighLevel you open the Opportunities tab, then add stages. See help.gohighlevel.com for the official walkthrough of this feature and more detail.",
  });
  made.articles.push(r.json?.id);
  // Known vendor terms are REPLACED, not quarantined — that is the normalizer working.
  // Quarantine is the fail-safe for terms it can't replace (next block).
  check("no vendor name survives", !/gohighlevel|highlevel/i.test(r.json?.body ?? ""), r.json?.body?.slice(0, 140));
  check("  ↳ replaced with the placeholder", r.json?.body.includes("{{PLATFORM}}"));
  check("  ↳ and the URL is gone entirely", !/https?:|\.com/i.test(r.json?.body ?? ""), r.json?.body?.slice(0, 140));
  check("  ↳ usable, because nothing brand-shaped is left", r.json?.status === "ready", r.json?.status);

  console.log("\n== a term the lexicon CAN'T replace is quarantined (the fail-safe) ==");
  // Capital i instead of the final l. The defanged scan folds homoglyphs so it is
  // DETECTED, while literal replacement can't match it — exactly the case quarantine
  // exists for. Cost: one unavailable article. Never a leak.
  r = await call("POST", `/admin/api/${agencyA.id}/kb`, {
    title: "Migration notes",
    body: "We moved everything across from GoHighLeveI last spring, and all your pipeline stages came with it. Nothing else changed for your team.",
  });
  made.articles.push(r.json?.id);
  check("stored but quarantined", r.json?.quarantined === true, JSON.stringify(r.json)?.slice(0, 200));
  check("  ↳ tells them WHICH term tripped it", (r.json?.residualLeaks ?? []).length > 0, JSON.stringify(r.json?.residualLeaks));

  const quarantined = await p.kbArticle.findUnique({ where: { id: r.json.id } });
  check("  ↳ status is needs_review, so retrieval skips it", quarantined?.status === "needs_review", quarantined?.status);

  console.log("\n== short SOPs are allowed; empty ones are not ==");
  r = await call("POST", `/admin/api/${agencyA.id}/kb`, {
    title: "Password resets",
    body: "Click your avatar, choose Settings, then Change password. It takes about ten seconds.",
  });
  check("a two-sentence SOP is accepted (crawler floor doesn't apply)", r.status === 201, JSON.stringify(r.json)?.slice(0, 150));
  if (r.json?.id) made.articles.push(r.json.id);

  r = await call("POST", `/admin/api/${agencyA.id}/kb`, { title: "Too short", body: "Hi." });
  check("a one-liner is refused with a reason", r.status === 400 && /too short/i.test(r.json?.error ?? ""), JSON.stringify(r.json));

  r = await call("POST", `/admin/api/${agencyA.id}/kb`, { title: "", body: "" });
  check("empty is refused", r.status === 400);

  console.log("\n== list, edit, delete ==");
  r = await call("GET", `/admin/api/${agencyA.id}/kb`);
  check("lists the agency's own articles", r.json?.articles.length === 4, `got ${r.json?.articles.length}`);
  check("reports how many shared articles back them up", typeof r.json?.sharedArticles === "number");

  const editId = made.articles[3];
  r = await call("PUT", `/admin/api/${agencyA.id}/kb/${editId}`, {
    title: "Password resets",
    body: "Click your avatar in Acme Portal, choose Settings, then Change password. It takes about ten seconds.",
  });
  check("editing replaces the article", r.status === 200, JSON.stringify(r.json)?.slice(0, 150));
  check("  ↳ and re-neutralises the brand name on save", r.json?.body.includes("{{PLATFORM}}"), r.json?.body);
  const newId = r.json?.id;
  check("  ↳ the old row is gone (no duplicate)", (await p.kbArticle.count({ where: { id: editId } })) === 0);
  made.articles[3] = newId;

  console.log("\n== tenant scoping ==");
  const agencyB = await p.agencyInstall.create({
    data: {
      ghlCompanyId: `verify-kb-${Date.now()}`, accessTokenEnc: "x", refreshTokenEnc: "x",
      tokenExpiresAt: new Date(Date.now() + 86400000), companyName: "Other Agency",
    },
  });
  made.agencyB = agencyB.id;

  r = await call("GET", `/admin/api/${agencyB.id}/kb`);
  check("a different agency sees none of these articles", r.json?.articles.length === 0, `got ${r.json?.articles.length}`);

  r = await call("PUT", `/admin/api/${agencyB.id}/kb/${made.articles[0]}`, { title: "Hijack", body: "x".repeat(60) });
  check("cannot edit another agency's article", r.status === 404, `got ${r.status}`);

  r = await call("DELETE", `/admin/api/${agencyB.id}/kb/${made.articles[0]}`);
  check("cannot delete another agency's article", r.status === 404, `got ${r.status}`);
  check("  ↳ and it still exists", (await p.kbArticle.count({ where: { id: made.articles[0] } })) === 1);

  r = await call("DELETE", `/admin/api/${agencyA.id}/kb/${made.articles[0]}`);
  check("the owner can delete it", r.status === 200 && r.json?.deleted === true);
  made.articles.shift();

  console.log("\n== retrieval only sees ready articles ==");
  const ready = await p.kbArticle.count({ where: { agencyInstallId: agencyA.id, status: "ready" } });
  const held = await p.kbArticle.count({ where: { agencyInstallId: agencyA.id, status: "needs_review" } });
  check(`${ready} retrievable, ${held} held back`, ready === 2 && held === 1, `ready=${ready} held=${held}`);

  console.log(`\n${"-".repeat(45)}\n  ${pass} passed, ${fail} failed`);
})()
  .catch((e) => { console.error("\nERROR:", e.stack); fail++; })
  .finally(async () => {
    await p.kbArticle.deleteMany({ where: { id: { in: made.articles.filter(Boolean) } } });
    await p.themeConfig.deleteMany({ where: { id: { in: made.themes } } });
    if (made.agencyB) await p.agencyInstall.delete({ where: { id: made.agencyB } }).catch(() => {});
    console.log(`\ncleanup: kbArticles=${await p.kbArticle.count()} agencies=${await p.agencyInstall.count()} themeConfigs=${await p.themeConfig.count()}`);
    await p.$disconnect();
    process.exit(fail);
  });
