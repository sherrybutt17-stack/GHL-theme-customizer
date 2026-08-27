/**
 * What does one queue poll actually cost?
 *
 * The widget polls `/queue` every 20s for every client waiting, and the desk board
 * polls its own every 15s for every agent signed in. Both call the same desk-wide
 * aggregates — capacity across all agents, and first-response samples over a 7-day
 * window. Those are per-DESK numbers that every caller recomputes from scratch.
 *
 * Measured before deciding anything: the fix for a cost that isn't there is just more
 * code to be wrong.
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);
const { createHash, randomBytes } = require("node:crypto");

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing: DATABASE_URL is not local.");
  process.exit(1);
}

const BASE = "http://localhost:3210";
const made = { conversationIds: [], locationId: null, configCreated: false };
let queries = 0;

const p = new PrismaClient({ log: [{ emit: "event", level: "query" }] });

// Snapshot every support policy before anything is written, so cleanup can put them back.
let __configsBefore = null;
p.$on("query", () => queries++);

const HISTORY = Number(process.argv[2] ?? 400); // settled conversations in the window
const WAITING = Number(process.argv[3] ?? 40);  // clients queued right now

async function seed(agencyId, locationInstallId) {
  const rows = [];
  for (let i = 0; i < HISTORY; i++) {
    rows.push({
      agencyInstallId: agencyId,
      locationInstallId,
      accessTokenHash: createHash("sha256").update(randomBytes(24)).digest("hex"),
      status: "resolved",
      startedAt: new Date(Date.now() - 3 * 86400000),
      queuedAt: new Date(Date.now() - 3 * 86400000 + 60000),
      firstAgentReplyAt: new Date(Date.now() - 3 * 86400000 + 300000),
      lastMessageAt: new Date(),
    });
  }
  for (let i = 0; i < WAITING; i++) {
    rows.push({
      agencyInstallId: agencyId,
      locationInstallId,
      accessTokenHash: createHash("sha256").update(randomBytes(24)).digest("hex"),
      status: "escalated",
      priority: "normal",
      queuedAt: new Date(Date.now() - (i + 1) * 60000),
      lastMessageAt: new Date(),
    });
  }
  await p.conversation.createMany({ data: rows });
  const ids = await p.conversation.findMany({
    where: { locationInstallId, OR: [{ status: "resolved" }, { status: "escalated" }] },
    select: { id: true },
  });
  made.conversationIds = ids.map((r) => r.id);
}

async function timeIt(label, fn, n = 20) {
  await fn(); // warm
  const before = queries;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) await fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / n;
  const q = (queries - before) / n;
  console.log(`  ${label.padEnd(34)} ${ms.toFixed(1).padStart(7)} ms/call   ${q.toFixed(1).padStart(5)} queries/call`);
  return ms;
}

(async () => {
  __configsBefore = await p.supportConfig.findMany();
  const agency = await p.agencyInstall.findFirst({ select: { id: true } });
  const location = await p.locationInstall.findFirst({
    where: { agencyInstallId: agency.id, status: "active" },
    select: { id: true, ghlLocationId: true, supportEnabled: true },
  });
  made.locationId = location.id;
  // Snapshotted, never assumed. Turning this back OFF is not restoring it: `supportEnabled`
  // is the agency's own per-sub-account switch, and hardcoding false silently withdraws the
  // client-facing widget from whichever real sub-account findFirst() happened to pick.
  made.supportWas = location.supportEnabled;

  made.configCreated = !(await p.supportConfig.findUnique({ where: { agencyInstallId: agency.id } }));
  await fetch(`${BASE}/admin/api/${agency.id}/support`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true, escalationEmails: ["ops@agency.test"] }),
  });
  await p.locationInstall.update({ where: { id: location.id }, data: { supportEnabled: true } });

  console.log(`\nseeding ${HISTORY} settled + ${WAITING} waiting conversations…`);
  await seed(agency.id, location.id);

  // A real waiting client, with its own bearer.
  const convRes = await fetch(`${BASE}/support/api/${agency.id}/${location.ghlLocationId}/conversation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageUrl: "https://app.example.com/v2/location/x/contacts" }),
  });
  const conv = await convRes.json();
  made.conversationIds.push(conv.conversationId);
  await fetch(`${BASE}/support/api/${agency.id}/${location.ghlLocationId}/conversation/${conv.conversationId}/escalate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mosaic-conversation": conv.token },
    body: JSON.stringify({ note: "bench" }),
  });

  console.log(`\nqueue depth is now ${await p.conversation.count({ where: { status: "escalated", assignedToId: null } })}\n`);

  // Assert the endpoint actually takes the expensive path before timing it.
  //
  // `/queue` returns early with waiting:false when the conversation is not queued — no
  // capacity read, no 7-day sample scan. Timing that is timing nothing, and it reads as
  // a REASSURING number: an earlier run of this script reported 6,000 rows of history
  // as *faster* than 200, which is the shape of a benchmark measuring its own
  // short-circuit.
  const poll = () =>
    fetch(`${BASE}/support/api/${agency.id}/${location.ghlLocationId}/conversation/${conv.conversationId}/queue`, {
      headers: { "x-mosaic-conversation": conv.token },
    }).then((r) => r.json());

  const probe = await poll();
  if (probe?.waiting !== true) {
    throw new Error(`the bench client is not queued, so nothing expensive runs: ${JSON.stringify(probe)}`);
  }
  console.log(`  (verified: waiting=true, position=${probe.position} — the full path runs)\n`);

  await timeIt("widget /queue (one client poll)", poll);

  console.log("\n  For scale: every waiting client polls this every 20s, and the desk");
  console.log("  board polls its own equivalent every 15s per signed-in agent.\n");
})()
  .catch((e) => console.error("\nERROR:", e.stack))
  .finally(async () => {
    await p.message.deleteMany({ where: { conversationId: { in: made.conversationIds } } }).catch(() => {});
    await p.conversation.deleteMany({ where: { id: { in: made.conversationIds } } }).catch(() => {});
    if (made.locationId) {
      await p.locationInstall.update({ where: { id: made.locationId }, data: { supportEnabled: made.supportWas ?? false } }).catch(() => {});
    }
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
    console.log(`cleanup: conversations=${await p.conversation.count()}`);
    await p.$disconnect();
  });
