/**
 * Does a desk agent's reply actually REACH the client?
 *
 * Until now it did not. An agent's message passed all three gates, was stored, set
 * `firstAgentReplyAt` and counted toward the response time shown to the agency — and
 * there was no endpoint that returned messages, and no poller in the widget, so the
 * client never saw a word of it. The metric made it worse than silence: the dashboard
 * reported how fast we answered people we had not actually answered.
 *
 * The second half of this file is the one that would be a disaster to get wrong.
 * Internal notes, transfers and hand-offs live in the SAME Message table as the
 * client's transcript, and they carry Mosaic staff names and our own workflow. One
 * missing role filter and "[transferred from Ada to Bo]" appears in a customer's chat.
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);
const { randomBytes, scryptSync } = require("node:crypto");

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing: DATABASE_URL is not local.");
  process.exit(1);
}

const p = new PrismaClient();

// Snapshot every support policy before anything is written, so cleanup can put them back.
let __configsBefore = null;
const BASE = "http://localhost:3210";
let pass = 0, fail = 0;
const check = (n, ok, d) => {
  if (ok) { console.log(`  ok    ${n}`); pass++; }
  else { console.log(`  FAIL  ${n}`); if (d !== undefined) console.log(`        ${String(d).slice(0, 260)}`); fail++; }
};

const made = { userId: null, conversationId: null, locationId: null, configCreated: false };
const PASSWORD = "correct horse battery staple";
let deskCookie = "";

function hashPassword(pw) {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 64, { N: 16384 }).toString("hex")}`;
}

async function desk(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "x-mosaic-desk": "1", ...(deskCookie ? { Cookie: deskCookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const sc = res.headers.get("set-cookie");
  if (sc) deskCookie = sc.split(";")[0];
  return { status: res.status, json: await res.json().catch(() => null) };
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
  const cfg = await fetch(`${BASE}/admin/api/${agency.id}/support`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true, escalationEmails: ["ops@agency.test"] }),
  });
  if (!cfg.ok) throw new Error(`support config save failed: ${cfg.status}`);
  await p.locationInstall.update({ where: { id: location.id }, data: { supportEnabled: true } });

  // Clear anything a previous run left, so the queue below is ours.
  const stale = await p.deskUser.findMany({ where: { email: { startsWith: "delivery-" } }, select: { id: true } });
  if (stale.length) {
    await p.deskSession.deleteMany({ where: { deskUserId: { in: stale.map((u) => u.id) } } });
    await p.deskUser.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
  }

  const agent = await p.deskUser.create({
    data: {
      email: `delivery-${Date.now()}@mosaic.test`,
      name: "Dana",
      passwordHash: hashPassword(PASSWORD),
      role: "mosaic_admin",
      tier: 3,
    },
  });
  made.userId = agent.id;
  const login = await desk("POST", "/desk/api/login", { email: agent.email, password: PASSWORD });
  if (login.status === 429) {
    // Named, not left as a status code: /desk/api/login is 10/min per IP and every desk
    // suite spends several. A bare "login failed: 429" sends the reader to the auth code.
    throw new Error(
      "rate-limited by /desk/api/login (10/min per IP), not a product failure. " +
        "Another desk suite ran in the same minute — wait one and re-run."
    );
  }
  if (login.status !== 200) throw new Error(`desk login failed: ${login.status} ${JSON.stringify(login.json)}`);

  // --- a real client conversation ---
  const startRes = await fetch(`${BASE}/support/api/${agency.id}/${location.ghlLocationId}/conversation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageUrl: "https://app.example.com/v2/location/x/contacts" }),
  });
  const conv = await startRes.json();
  made.conversationId = conv.conversationId;

  const widget = async (path) => {
    const res = await fetch(
      `${BASE}/support/api/${agency.id}/${location.ghlLocationId}/conversation/${conv.conversationId}${path}`,
      { headers: { "Content-Type": "application/json", "x-mosaic-conversation": conv.token } }
    );
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  // A real exchange first: the client asks something and the bot answers. Without this
  // the only client-visible message in the whole conversation is the agent's reply —
  // the escalation note the client types is stored as `system`, so it is invisible to
  // them by design (and the shipped widget never sends one).
  await fetch(`${BASE}/support/api/${agency.id}/${location.ghlLocationId}/conversation/${conv.conversationId}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mosaic-conversation": conv.token },
    body: JSON.stringify({ text: "How do I add a new contact?" }),
  });

  // The client asks for a person.
  await fetch(`${BASE}/support/api/${agency.id}/${location.ghlLocationId}/conversation/${conv.conversationId}/escalate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mosaic-conversation": conv.token },
    body: JSON.stringify({ note: "I need help with my calendar" }),
  });

  console.log("\n== the widget syncs without replaying the transcript ==");
  let u = await widget("/updates");
  check("first poll returns a cursor", !!u.json.cursor, JSON.stringify(u.json).slice(0, 160));
  check("  ↳ and NO messages, so nothing is duplicated on screen", u.json.messages.length === 0, JSON.stringify(u.json.messages));
  check("reports the client is waiting", u.json.waiting === true, JSON.stringify(u.json));
  const cursor = u.json.cursor;

  console.log("\n== an agent replies, and the client actually receives it ==");
  await desk("POST", `/desk/api/conversations/${made.conversationId}/assign`, { assigneeId: agent.id });
  const reply = await desk("POST", `/desk/api/conversations/${made.conversationId}/reply`, {
    text: "Happy to help with your calendar — which part is giving you trouble?",
  });
  check("the agent's reply was accepted", reply.status === 201, JSON.stringify(reply.json));

  u = await widget(`/updates?after=${encodeURIComponent(cursor)}`);
  check("THE FIX: the reply reaches the client", u.json.messages.length === 1, JSON.stringify(u.json.messages));
  check("  ↳ with the agent's words, intact", /which part is giving you trouble/i.test(u.json.messages[0]?.body ?? ""), u.json.messages[0]?.body);
  check("  ↳ marked as coming from a person", u.json.messages[0]?.role === "agent", u.json.messages[0]?.role);
  check(
    "polling continues after the ticket is claimed",
    u.json.waiting === false && u.json.status !== "resolved",
    JSON.stringify({ waiting: u.json.waiting, status: u.json.status })
  );

  console.log("\n== the same poll again must not deliver it twice ==");
  const again = await widget(`/updates?after=${encodeURIComponent(u.json.cursor)}`);
  check("nothing new", again.json.messages.length === 0, JSON.stringify(again.json.messages));

  console.log("\n== INTERNAL notes must never reach the client ==");
  // Everything the desk writes as `system`: an internal note, a transfer, a hand-off.
  await desk("POST", `/desk/api/conversations/${made.conversationId}/reply`, {
    text: "Client sounds annoyed, check their billing before replying.",
    internal: true,
  });
  const other = await p.deskUser.create({
    data: { email: `delivery-2-${Date.now()}@mosaic.test`, name: "Sam", passwordHash: hashPassword(PASSWORD), tier: 3 },
  });
  await desk("POST", `/desk/api/conversations/${made.conversationId}/transfer`, { deskUserId: other.id, note: "over to you" });

  const systemRows = await p.message.findMany({
    where: { conversationId: made.conversationId, role: "system" },
    select: { body: true },
  });
  check(`${systemRows.length} internal rows were written`, systemRows.length >= 2, systemRows.map((r) => r.body).join(" | "));

  const afterInternal = await widget(`/updates?after=${encodeURIComponent(again.json.cursor)}`);
  const delivered = (afterInternal.json.messages ?? []).map((m) => m.body).join("\n");
  check("ZERO of them are delivered", afterInternal.json.messages.length === 0, delivered);
  check("  ↳ no Mosaic staff name reaches the client", !/\b(Dana|Sam)\b/.test(delivered), delivered);
  check("  ↳ no internal marker reaches the client", !/\[internal\]|transferred|handed to agency/i.test(delivered), delivered);
  check("  ↳ and the private note itself never leaves", !/billing before replying/i.test(delivered), delivered);

  console.log("\n== a reload must not lose the thread ==");
  // What a restored widget does: empty panel, so it asks for the whole visible
  // transcript rather than "everything since my cursor", which would paint the second
  // half of a conversation into a blank window.
  const replayed = await widget("/updates?replay=1");
  const bodies = (replayed.json.messages ?? []).map((m) => m.body);
  check("replay returns the conversation so far", bodies.length >= 3, `${bodies.length} messages: ${JSON.stringify(bodies).slice(0, 200)}`);
  check("  ↳ the client's own question", bodies.some((b) => /add a new contact/i.test(b)), JSON.stringify(bodies).slice(0, 200));
  check("  ↳ the bot's answer", bodies.length >= 2);
  check("  ↳ and the agent's reply", bodies.some((b) => /which part is giving you trouble/i.test(b)), JSON.stringify(bodies).slice(0, 200));
  check(
    "  ↳ and STILL no internal note, transfer or staff name",
    !bodies.some((b) => /\[internal\]|transferred|handed to agency|\bDana\b|\bSam\b|billing before replying/i.test(b)),
    JSON.stringify(bodies).slice(0, 300)
  );
  check("  ↳ replay hands back a cursor to continue from", !!replayed.json.cursor, replayed.json.cursor);

  // The default is still "nothing": a poller that lost its cursor must not replay the
  // conversation on top of what the client is already reading.
  const noCursor = await widget("/updates");
  check("without replay=1, a cursorless poll still returns nothing", noCursor.json.messages.length === 0, JSON.stringify(noCursor.json.messages));

  console.log("\n== a wrong bearer gets nothing ==");
  const noToken = await fetch(
    `${BASE}/support/api/${agency.id}/${location.ghlLocationId}/conversation/${conv.conversationId}/updates`
  );
  check("401 without the conversation token", noToken.status === 401, noToken.status);

  console.log("\n== resolving stops the widget polling for good ==");
  await desk("PATCH", `/desk/api/conversations/${made.conversationId}`, { status: "resolved" });
  const done = await widget(`/updates?after=${encodeURIComponent(afterInternal.json.cursor)}`);
  check("status says resolved", done.json.status === "resolved", done.json.status);

  await p.deskUser.delete({ where: { id: other.id } }).catch(() => {});

  console.log(`\n${"-".repeat(46)}\n  ${pass} passed, ${fail} failed`);
})()
  .catch((e) => { console.error("\nERROR:", e.stack); fail++; })
  .finally(async () => {
    if (made.conversationId) {
      await p.message.deleteMany({ where: { conversationId: made.conversationId } }).catch(() => {});
      await p.conversation.delete({ where: { id: made.conversationId } }).catch(() => {});
    }
    await p.deskSession.deleteMany({ where: { deskUser: { email: { startsWith: "delivery-" } } } }).catch(() => {});
    await p.deskUser.deleteMany({ where: { email: { startsWith: "delivery-" } } }).catch(() => {});
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
    console.log(`\ncleanup: conversations=${await p.conversation.count()} deskUsers=${await p.deskUser.count()}`);
    await p.$disconnect();
    process.exit(fail);
  });
