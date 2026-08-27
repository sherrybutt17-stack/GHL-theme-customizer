/**
 * The agency-level brand fallback, end to end.
 *
 * The column existed and brandTerms.ts read it, but nothing could WRITE it — so this
 * rung of the chain never fired and a sub-account with no name of its own announced the
 * AGENCY's company name to the client. That is the leak the column was added to stop.
 *
 *   ThemeConfig.brandName -> AgencyDefaultTheme.brandName -> companyName -> "your dashboard"
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);
const p = new PrismaClient();

// Snapshot every support policy before anything is written, so cleanup can put them back.
let __configsBefore = null;
const BASE = "http://localhost:3210";
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { console.log(`  ok    ${n}`); pass++; } else { console.log(`  FAIL  ${n}`); if (d) console.log(`        ${String(d).slice(0,200)}`); fail++; } };

(async () => {
  __configsBefore = await p.supportConfig.findMany();
  const ag = await p.agencyInstall.findFirst({ select: { id: true, companyName: true } });
  // A sub-account with NO ThemeConfig of its own — the case the fallback exists for.
  const loc = await p.locationInstall.findFirst({
    where: { agencyInstallId: ag.id, status: "active", themeConfigs: { none: {} } },
    select: { id: true, ghlLocationId: true, supportEnabled: true },
  });
  if (!loc) throw new Error("need a sub-account with no theme of its own");
  // Snapshotted, never assumed — see the note in verify-e2e.js. Hardcoding false withdraws
  // the client-facing widget from a real sub-account the run did not own.
  const supportWas = loc.supportEnabled;

  await p.supportConfig.upsert({
    where: { agencyInstallId: ag.id },
    update: { enabled: true, escalationEmails: ["o@a.test"] },
    create: { agencyInstallId: ag.id, enabled: true, escalationEmails: ["o@a.test"] },
  });
  await p.locationInstall.update({ where: { id: loc.id }, data: { supportEnabled: true } });

  const cfg = async () => (await (await fetch(`${BASE}/support/api/${ag.id}/${loc.ghlLocationId}/config`)).json()).brandName;

  console.log("\n== with no agency default name set ==");
  const without = await cfg();
  console.log(`        client is told: "${without}"`);
  check("does NOT fall through to something client-facing by accident", typeof without === "string" && without.length > 0, without);

  console.log("\n== after setting it through the API the dashboard uses ==");
  await fetch(`${BASE}/admin/api/${ag.id}/default-theme`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brandName: "Summit Portal", primaryColor: "#334455" }),
  });
  const stored = await p.agencyDefaultTheme.findUnique({ where: { agencyInstallId: ag.id }, select: { brandName: true } });
  check("the PUT actually stores it", stored?.brandName === "Summit Portal", JSON.stringify(stored));

  const withIt = await cfg();
  console.log(`        client is now told: "${withIt}"`);
  check("the sub-account inherits the agency's white-label name", withIt === "Summit Portal", withIt);
  check("  -> and never the agency's own company name", withIt !== ag.companyName, `${withIt} vs ${ag.companyName}`);

  await p.agencyDefaultTheme.deleteMany({ where: { agencyInstallId: ag.id } });
  await p.agencyDefaultThemeVersion.deleteMany({ where: { agencyInstallId: ag.id } });
  /**
   * RESTORE, never `deleteMany({})`.
   *
   * That unscoped delete removes EVERY agency's support policy — greeting, blocked terms,
   * business hours, response targets, plan names — for agencies this script never touched.
   * Invisible on a one-agency dev database and destructive the moment there are two, which
   * is the same shape as a per-tenant check written as an aggregate. It is silent too: the
   * next symptom is the bot answering with the generic wording, weeks later.
   */
  await (async () => {
    const keep = __configsBefore || [];
    await p.supportConfig.deleteMany({});
    for (const row of keep) {
      const { id, createdAt, updatedAt, ...rest } = row;
      await p.supportConfig.create({ data: rest }).catch(() => {});
    }
  })();
  await p.locationInstall.update({ where: { id: loc.id }, data: { supportEnabled: supportWas } });
  console.log(`\n${"-".repeat(45)}\n  ${pass} passed, ${fail} failed`);
  await p.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e.stack); await p.$disconnect(); process.exit(1); });
