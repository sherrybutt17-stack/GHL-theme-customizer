/**
 * The render-blocking stylesheet: does a repeat page load actually cost nothing now?
 *
 * `/theme-css` is fetched by an `@import` in GHL's Custom CSS field, and browsers treat
 * a pending stylesheet as render-blocking — so its transfer size is added to the first
 * paint of the agency's entire CRM, on every page. It used to be sent `no-store`, which
 * forbids the browser from keeping a copy at all, so the whole body shipped every time.
 *
 * These checks pin the three properties that have to hold together:
 *   1. a repeat load transfers NOTHING (304), and
 *   2. a theme edit is still live IMMEDIATELY — no max-age, so correctness is unchanged, and
 *   3. the degraded path can 304 too, because an outage is the worst time to ship megabytes.
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);

const p = new PrismaClient();
const BASE = "http://localhost:3210";
let pass = 0, fail = 0;
const check = (n, ok, d) => {
  if (ok) { console.log(`  ok    ${n}`); pass++; }
  else { console.log(`  FAIL  ${n}`); if (d !== undefined) console.log(`        ${String(d).slice(0, 240)}`); fail++; }
};

const made = { agencyId: "", locationIds: [], themeIds: [] };

/** Random bytes: a real logo is already-compressed WebP, so it does not gzip away. */
function fakeLogo(kb) {
  return `data:image/webp;base64,${require("node:crypto").randomBytes(kb * 1024).toString("base64")}`;
}

/**
 * Raw http.request, NOT fetch — and that is the difference between measuring the
 * server and measuring the client library.
 *
 * Node's fetch (undici) silently attaches `cache-control: no-cache` and `pragma:
 * no-cache` to any request carrying a conditional header, because per spec a manual
 * If-None-Match forces the cache mode. Express's `fresh` then correctly refuses to
 * answer 304 — a client explicitly demanding a fresh copy should get one. So every
 * conditional request through fetch came back 200 with a full body, and it looked
 * exactly like a server that ignores ETags. A real browser revalidating its own cache
 * sends If-None-Match WITHOUT that header, which is the case worth measuring.
 */
function get(url, headers = {}) {
  const http = require("node:http");
  return new Promise((resolve, reject) => {
    const req = http.request(url, { headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: res.statusCode,
          etag: res.headers.etag ?? null,
          cacheControl: res.headers["cache-control"] ?? null,
          staleAge: res.headers["x-mosaic-stale-age"] ?? null,
          bytes: Buffer.byteLength(body),
          body,
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  const SUBS = 20;
  const agency = await p.agencyInstall.create({
    data: {
      ghlCompanyId: `cachecheck-${Date.now()}`,
      accessTokenEnc: "x", refreshTokenEnc: "x", tokenExpiresAt: new Date(Date.now() + 86400000),
      companyName: "Cache Check Agency",
    },
  });
  made.agencyId = agency.id;

  for (let i = 0; i < SUBS; i++) {
    const loc = await p.locationInstall.create({
      data: {
        agencyInstallId: agency.id,
        ghlLocationId: `cachecheck-loc-${Date.now()}-${i}`,
        status: "active",
        enabled: true,
        locationName: `Client ${i}`,
      },
    });
    made.locationIds.push(loc.id);
    const t = await p.themeConfig.create({
      data: {
        locationInstallId: loc.id, version: 1, brandName: `Client ${i}`,
        logoUrl: fakeLogo(40), primaryColor: "#123456",
        // The icon colour is the ONE part of this bundle that is computed rather than
        // copied: `cssFilterForColor` solves a filter chain numerically. Without it here
        // the 304 guarantee was never tested against the only thing that could churn —
        // a solver drifting by one percent would change the bytes, change the ETag, and
        // ship a render-blocking stylesheet on every page load. Distinct per sub-account
        // so the memo cannot hide a drift either.
        sidebarIconColor: ["#0f766e", "#7c3aed", "#f59e0b", "#b91c1c"][i % 4],
      },
    });
    made.themeIds.push(t.id);
  }

  const url = `${BASE}/theme-css/${agency.id}`;

  console.log(`\n== first load (${SUBS} sub-accounts, 40KB logo each) ==`);
  const first = await get(url);
  check("serves the stylesheet", first.status === 200 && first.bytes > 100_000, `${first.status}, ${first.bytes} bytes`);
  check("does NOT say no-store — that forbids revalidation entirely", !/no-store/.test(first.cacheControl ?? ""), first.cacheControl);
  check("still forces revalidation, so an edit is never masked", /no-cache/.test(first.cacheControl ?? ""), first.cacheControl);
  check("carries an ETag to revalidate against", !!first.etag, first.etag);
  console.log(`        first load transfers ${(first.bytes / 1024).toFixed(0)} KB`);

  console.log("\n== the repeat page load, which is nearly all of them ==");
  const second = await get(url);
  console.log(`        etag #1 ${first.etag}`);
  console.log(`        etag #2 ${second.etag}`);
  check("two identical requests produce the SAME ETag", first.etag === second.etag, "the generated bytes are not stable between builds");
  check("  ↳ and byte-identical bodies", first.body === second.body, `${first.bytes} vs ${second.bytes} bytes`);
  const repeat = await get(url, { "If-None-Match": first.etag });
  check("answers 304 Not Modified", repeat.status === 304, repeat.status);
  check("  ↳ and transfers no body at all", repeat.bytes === 0, `${repeat.bytes} bytes`);
  console.log(`        saved ${(first.bytes / 1024).toFixed(0)} KB on every subsequent page load`);

  console.log("\n== a theme edit must still be live IMMEDIATELY ==");
  // Through the admin API, the way the dashboard does it.
  const editRes = await fetch(`${BASE}/admin/api/${agency.id}/locations/${made.locationIds[0]}/theme`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ primaryColor: "#ff0000" }),
  });
  check("theme saved", editRes.ok, `${editRes.status}`);

  const afterEdit = await get(url, { "If-None-Match": first.etag });
  check("the SAME conditional request now returns 200, not 304", afterEdit.status === 200, afterEdit.status);
  check("  ↳ the new colour is in it", /#ff0000/i.test(afterEdit.body));
  check("  ↳ and the ETag changed", afterEdit.etag !== first.etag, `${first.etag} → ${afterEdit.etag}`);

  console.log("\n== during an outage, the stale copy must revalidate too ==");
  // The degraded body used to interpolate an age in SECONDS, so it changed every second
  // and could never 304 — shipping the whole stylesheet on every page load for the whole
  // outage. The age lives in a header now.
  const degradedBodyHasAge = /\d+s old/.test(first.body);
  check("the served body carries no per-second timestamp", !degradedBodyHasAge, first.body.slice(0, 120));

  console.log(`\n${"-".repeat(46)}\n  ${pass} passed, ${fail} failed`);
})()
  .catch((e) => { console.error("\nERROR:", e.stack); fail++; })
  .finally(async () => {
    await p.themeConfig.deleteMany({ where: { locationInstallId: { in: made.locationIds } } }).catch(() => {});
    await p.locationInstall.deleteMany({ where: { agencyInstallId: made.agencyId } }).catch(() => {});
    if (made.agencyId) await p.agencyInstall.delete({ where: { id: made.agencyId } }).catch(() => {});
    console.log(`\ncleanup: agencies=${await p.agencyInstall.count()} locations=${await p.locationInstall.count()}`);
    await p.$disconnect();
    process.exit(fail);
  });
