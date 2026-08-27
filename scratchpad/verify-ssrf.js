/**
 * The server fetches user-supplied URLs from TWO boxes, and only one of them was guarded.
 *
 * `brandScan.ts` had the full defence — scheme and port allowlist, `net.BlockList` address
 * check in every spelling, manual per-hop redirect re-validation, connect-time DNS guard,
 * size and time caps — written after a real bypass and documented at length.
 *
 * Then feeds shipped. "Your content → Add feed" takes a URL, the route checked the SCHEME
 * and nothing else, and `feedPoll.ts` fetched it with a bare
 * `fetch(url, { redirect: "follow" })`: no address check, no port check, no per-hop
 * validation on a chain handed wholesale to undici, and an unbounded `res.text()`.
 *
 * It is the worse of the two paths. A brand scan turns the response into a colour and an
 * image; a feed response is parsed and INGESTED as knowledge-base articles, which
 * retrieval can then put into a client's chat window. Pasting
 * `http://169.254.169.254/latest/meta-data/iam/security-credentials/` was the whole
 * exploit — and it needs no DNS control, so the connect-time guard could not have helped
 * even if this path had had one.
 *
 * Both boxes are checked here against the same payloads, because the point is not that
 * one file was fixed — it is that the guard is now SHARED and a third box would get it.
 *
 * Run this with `npx tsx`, not `node`: it imports TypeScript sources directly.
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);

const BASE = process.env.VERIFY_BASE ?? "http://localhost:3210";
const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) {
  console.error("REFUSING: this suite writes KbFeed rows. DATABASE_URL must be localhost.");
  process.exit(1);
}

const p = new PrismaClient();
let pass = 0,
  fail = 0;
const check = (n, ok, d) => {
  if (ok) {
    console.log(`  ok    ${n}`);
    pass++;
  } else {
    console.log(`  FAIL  ${n}`);
    if (d !== undefined) console.log(`        ${String(d).slice(0, 250)}`);
    fail++;
  }
};

/**
 * Every one of these is a way to reach something this server must never fetch. The three
 * hex-spelled forms are the ones that defeated the ORIGINAL guard by spelling alone.
 */
const PAYLOADS = [
  ["the cloud metadata endpoint", "http://169.254.169.254/latest/meta-data/"],
  ["  ↳ the same address as v4-mapped IPv6 in hex", "http://[::ffff:a9fe:a9fe]/latest/meta-data/"],
  ["  ↳ and fully expanded", "http://[0:0:0:0:0:ffff:a9fe:a9fe]/"],
  ["loopback, where our own admin API answers", "http://127.0.0.1:3210/admin/api/x/locations"],
  ["  ↳ loopback spelled as IPv6", "http://[::1]/"],
  ["  ↳ and as v4-mapped hex", "http://[::ffff:7f00:1]/"],
  ["a private LAN address", "http://192.168.1.1/"],
  ["6to4, which embeds an arbitrary IPv4", "http://[2002:a9fe:a9fe::]/"],
  ["a non-web port on a public name", "http://example.com:22/"],
  ["credentials smuggled into the authority", "http://user:pass@example.com/feed.xml"],
  ["a non-http scheme", "file:///etc/passwd"],
];

let agencyId = null;
const madeFeedIds = [];

(async () => {
  const agency = await p.agencyInstall.findFirst({ where: { status: "active" }, select: { id: true } });
  agencyId = agency.id;

  const before = await p.kbFeed.count();

  console.log("\n== Add feed refuses every one, at paste time ==");
  for (const [name, url] of PAYLOADS) {
    const res = await fetch(`${BASE}/admin/api/${agencyId}/kb/feeds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const json = await res.json().catch(() => null);
    if (json?.feed?.id) madeFeedIds.push(json.feed.id);
    check(name, res.status === 400, `${res.status} ${JSON.stringify(json)}`);
  }

  check(
    "  ↳ and not one of them was stored",
    (await p.kbFeed.count()) === before,
    `${await p.kbFeed.count()} vs ${before}`
  );

  console.log("\n== the refusal says nothing about what is behind the address ==");
  // Distinguishing "blocked host" from "bad port" from "bad scheme" tells the caller which
  // internal hosts exist, which is the reconnaissance the guard exists to deny.
  const messages = new Set();
  for (const [, url] of PAYLOADS) {
    const res = await fetch(`${BASE}/admin/api/${agencyId}/kb/feeds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    messages.add((await res.json().catch(() => ({})))?.error ?? "");
  }
  check("one identical message for all of them", messages.size === 1, JSON.stringify([...messages]));

  console.log("\n== the brand-scan box refuses the same payloads ==");
  for (const [name, url] of PAYLOADS.slice(0, 8)) {
    const res = await fetch(`${BASE}/admin/api/${agencyId}/brand-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    check(name, res.status === 400, `${res.status} ${await res.text().catch(() => "")}`);
  }

  console.log("\n== and a guard that blocks the feature is not a fix ==");
  // A real public feed still has to work, through the same code path.
  const ok = await fetch(`${BASE}/admin/api/${agencyId}/kb/feeds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://github.blog/changelog/feed/" }),
  });
  const okJson = await ok.json().catch(() => null);
  if (okJson?.feed?.id) madeFeedIds.push(okJson.feed.id);
  check("a real public feed URL is accepted", ok.status === 201, `${ok.status} ${JSON.stringify(okJson)}`);

  if (okJson?.feed?.id) {
    /*
     * Imports the SOURCE under tsx, not `dist`. A suite that reads the built artifact is
     * asserting about whatever was there at the last `npm run build:server` — found 2026-08-26
     * when two deliberate mutations to `readiness.ts` left `verify-readiness` 34/34 green and
     * the build turned out to be a day old. Run these with `npx tsx`, not `node`.
     *
     * The `dist/assets` reads elsewhere are a different thing and stay: those deliberately
     * inspect the SHIPPED browser bundle, which is the artifact under test.
     */
    const { pollFeed } = require(`${ROOT}/apps/server/src/services/feedPoll.ts`);
    const r = await pollFeed(okJson.feed.id, { dryRun: true, log: () => {} });
    check(
      "  ↳ and polling it over the network actually reaches the publisher",
      !r.error && r.itemsSeen > 0,
      JSON.stringify({ error: r.error, itemsSeen: r.itemsSeen })
    );
  }

  console.log("\n== the poller refuses a blocked address even if a row exists ==");
  // Rows predating the route check, or written straight to the database. The fetch itself
  // has to refuse, or the route check is the only thing standing there.
  //
  // Aimed at LOOPBACK, deliberately, and not at 169.254.169.254: that address is not
  // routable from a laptop, so an unguarded fetch fails there by accident and the check
  // would pass for the wrong reason — reporting a guard that isn't running. Our own
  // /health answers on 127.0.0.1:3210 and returns a 200 with a body, so anything other
  // than a refusal here means the request really was made.
  const planted = await p.kbFeed.create({
    data: { url: `${BASE}/health`, agencyInstallId: agencyId, source: "agency" },
  });
  madeFeedIds.push(planted.id);
  const { pollFeed } = require(`${ROOT}/apps/server/src/services/feedPoll.ts`);
  const blockedPoll = await pollFeed(planted.id, { log: () => {} });
  check("the poll fails rather than fetching it", !!blockedPoll.error, JSON.stringify(blockedPoll));
  check("  ↳ nothing was ingested from it", blockedPoll.created === 0 && blockedPoll.held === 0);
  check(
    "  ↳ and the failure is recorded against the feed, not swallowed",
    (await p.kbFeed.findUnique({ where: { id: planted.id } })).consecutiveErrors === 1
  );

  console.log(`\n${"-".repeat(52)}\n  ${pass} passed, ${fail} failed`);
})()
  .catch((e) => {
    console.error("\nERROR:", e.stack);
    fail++;
  })
  .finally(async () => {
    if (madeFeedIds.length) await p.kbFeed.deleteMany({ where: { id: { in: madeFeedIds } } }).catch(() => {});
    await p.$disconnect();
    process.exit(fail);
  });
