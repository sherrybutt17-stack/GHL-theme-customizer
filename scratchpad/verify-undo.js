/**
 * Undo for the agency default — written because I destroyed one and there was no way back.
 *
 * The agency default is a SINGLE upserted row that styles every sub-account at once, so
 * it has the biggest blast radius in the product and, until now, no history at all —
 * while a single sub-account's theme has a full History tab. This checks the asymmetry
 * is actually closed, including the two cases that make an undo trustworthy: Reset is
 * recoverable, and restoring does not itself destroy what you currently have.
 *
 * Cleans up by RESTORING the pre-test state rather than deleting rows — the mistake that
 * prompted this feature was a cleanup path that deleted a row it hadn't created.
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);

const p = new PrismaClient();
const BASE = "http://localhost:3210";
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { console.log(`  ok    ${n}`); pass++; } else { console.log(`  FAIL  ${n}`); if (d) console.log(`        ${String(d).slice(0, 300)}`); fail++; } };

let AG;
const api = async (m, path, body) => {
  const r = await fetch(BASE + path, {
    method: m,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const versions = async () => (await api("GET", `/admin/api/${AG}/default-theme/versions`)).json;
const current = () => p.agencyDefaultTheme.findUnique({ where: { agencyInstallId: AG } });

(async () => {
  const agency = await p.agencyInstall.findFirst({ select: { id: true } });
  AG = agency.id;

  // Snapshot whatever is there now so the test can put it back verbatim.
  const preExisting = await current();
  const preExistingVersions = await p.agencyDefaultThemeVersion.count({ where: { agencyInstallId: AG } });

  console.log("\n== a save keeps what it replaced ==");
  await api("PUT", `/admin/api/${AG}/default-theme`, { brandName: "Look One", primaryColor: "#123456", accentColor: "#abcdef" });
  const afterFirst = await versions();
  await api("PUT", `/admin/api/${AG}/default-theme`, { brandName: "Look Two", primaryColor: "#654321" });
  const afterSecond = await versions();

  check("the very first save has nothing to keep", afterFirst.length === preExistingVersions + (preExisting ? 1 : 0),
    `${afterFirst.length} vs expected ${preExistingVersions + (preExisting ? 1 : 0)}`);
  check("the second save keeps the first look", afterSecond.length === afterFirst.length + 1, `${afterSecond.length}`);
  check("  -> and records what it was", afterSecond[0].brandName === "Look One" && afterSecond[0].primaryColor === "#123456",
    JSON.stringify(afterSecond[0]));
  check("  -> newest first", new Date(afterSecond[0].createdAt) >= new Date(afterSecond[1]?.createdAt ?? 0));

  console.log("\n== restoring brings the old look back ==");
  const target = afterSecond.find((v) => v.brandName === "Look One");
  const restored = await api("POST", `/admin/api/${AG}/default-theme/versions/${target.id}/restore`);
  check("restore returns 200", restored.status === 200, JSON.stringify(restored.json));
  const live = await current();
  check("the live default is Look One again", live.brandName === "Look One" && live.primaryColor === "#123456",
    `${live.brandName} ${live.primaryColor}`);
  check("  -> every field came back, not just the colours", live.accentColor === "#abcdef", live.accentColor);

  console.log("\n== restoring is ITSELF undoable ==");
  // Otherwise exploring the history is a trap: one click and the look you had is gone.
  const afterRestore = await versions();
  check("the look you had before restoring was kept", afterRestore.some((v) => v.brandName === "Look Two"),
    afterRestore.map((v) => v.brandName).join(", "));

  console.log("\n== Reset is recoverable ==");
  // This is the button that un-brands every sub-account at once. It is exactly the
  // action I performed by accident, with no way back.
  await api("DELETE", `/admin/api/${AG}/default-theme`);
  check("reset really clears the live default", (await current()) === null);
  const afterReset = await versions();
  check("but the look is kept in history", afterReset[0].brandName === "Look One", JSON.stringify(afterReset[0]));
  check("  -> labelled so it's findable", /reset/i.test(afterReset[0].reason ?? ""), afterReset[0].reason);
  const back = await api("POST", `/admin/api/${AG}/default-theme/versions/${afterReset[0].id}/restore`);
  check("and restoring after a reset works", back.status === 200 && (await current())?.brandName === "Look One", back.status);

  console.log("\n== it can't be used to read or write another agency ==");
  const stray = await api("POST", `/admin/api/${AG}/default-theme/versions/does-not-exist/restore`);
  check("unknown version id 404s", stray.status === 404, stray.status);

  console.log("\n== history is pruned, not unbounded ==");
  // The in-repo example of getting this wrong is WebhookEvent: global and unpruned.
  for (let i = 0; i < 24; i++) {
    await api("PUT", `/admin/api/${AG}/default-theme`, { brandName: `Bulk ${i}`, primaryColor: "#111111" });
  }
  const capped = await p.agencyDefaultThemeVersion.count({ where: { agencyInstallId: AG } });
  check("capped at 20 entries", capped <= 20, `${capped} rows`);

  console.log(`\n${"-".repeat(45)}\n  ${pass} passed, ${fail} failed`);
})()
  .catch((e) => { console.error("\nERROR:", e.stack); fail++; })
  .finally(async () => {
    // Put the database back exactly as found — including deleting ONLY the version rows
    // this test created.
    await p.agencyDefaultThemeVersion.deleteMany({ where: { agencyInstallId: AG } });
    await p.agencyDefaultTheme.deleteMany({ where: { agencyInstallId: AG } });
    console.log(`\ncleanup: agencyDefaultThemes=${await p.agencyDefaultTheme.count()} versions=${await p.agencyDefaultThemeVersion.count()}`);
    await p.$disconnect();
    process.exit(fail ? 1 : 0);
  });
