/**
 * What happens to the TICKETS when a support agent is offboarded.
 *
 * `routes/desk.ts` already knows this failure mode and says so in a comment one door
 * over: assigning a ticket to a disabled account "silently parks the ticket where nobody
 * will see it, which is worse than refusing" — so `/assign` and `/transfer` both 400.
 * The identical state is reachable the other way round: assign to a live agent, then
 * disable them. Nothing released what they were holding.
 *
 * The result is a ticket held by a ghost. `queueWhere` requires `assignedToId: null`, so
 * it is not in the queue: "take next" cannot reach it, "distribute" skips it, the board's
 * depth does not count it, and no living agent has it on their list. And the client is
 * told the BEST version of the news — `queuePosition` returns null for an assigned
 * conversation, so the widget stops showing a place in line and reports that somebody has
 * picked it up. Forever.
 *
 * Offboarding is the moment this happens: disabling an account is what you do when
 * somebody leaves or their laptop is lost, and both are unplanned.
 *
 * Run this with `npx tsx`, not `node`: it imports TypeScript sources directly.
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);
const { createHash, randomBytes, scryptSync } = require("node:crypto");

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL is not local. This script writes and deletes rows.");
  process.exit(1);
}

const p = new PrismaClient();
const BASE = "http://localhost:3210";
let pass = 0,
  fail = 0;

function check(name, ok, detail) {
  if (ok) {
    console.log(`  ok    ${name}`);
    pass++;
  } else {
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${String(detail).slice(0, 300)}`);
    fail++;
  }
}

function hashPassword(pw) {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 64, { N: 16384 }).toString("hex")}`;
}

const PASSWORD = "correct horse battery staple";
const stamp = Date.now();
const made = { userIds: [], conversationIds: [], locationId: null, configCreated: false };

function jar() {
  return { cookie: "" };
}

async function desk(j, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-mosaic-desk": "1",
      ...(j.cookie ? { Cookie: j.cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) j.cookie = setCookie.split(";")[0];
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function makeUser(name, extra) {
  const u = await p.deskUser.create({
    data: {
      email: `offboard-${name}-${stamp}@mosaic.test`.toLowerCase(),
      name,
      passwordHash: hashPassword(PASSWORD),
      ...extra,
    },
  });
  made.userIds.push(u.id);
  const j = jar();
  const res = await desk(j, "POST", "/desk/api/login", { email: u.email, password: PASSWORD });
  // 10/min on /desk/api/login. A 429 becomes a missing cookie and reads like a routing
  // bug three checks later, so name it here.
  if (res.status !== 200 || !j.cookie) {
    throw new Error(`login for ${name} failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
  return { ...u, jar: j };
}

let agency, location;

/** A ticket in a known state, with a client token so the widget half can be checked. */
async function makeTicket({ minutesWaiting, status, assignedToId = null }) {
  const token = randomBytes(24).toString("hex");
  const at = new Date(Date.now() - minutesWaiting * 60_000);
  const c = await p.conversation.create({
    data: {
      agencyInstallId: agency.id,
      locationInstallId: location.id,
      accessTokenHash: createHash("sha256").update(token).digest("hex"),
      status,
      priority: "normal",
      tier: 1,
      queuedAt: at,
      lastMessageAt: at,
      ...(assignedToId ? { assignedToId, assignedAt: at } : {}),
    },
  });
  made.conversationIds.push(c.id);
  await p.message.create({
    data: { conversationId: c.id, role: "user", body: "My calendar bookings are not syncing." },
  });
  return { ...c, token };
}

const widget = async (conv, path) => {
  const res = await fetch(
    `${BASE}/support/api/${agency.id}/${location.ghlLocationId}/conversation/${conv.id}${path}`,
    { headers: { "Content-Type": "application/json", "x-mosaic-conversation": conv.token } }
  );
  return { status: res.status, json: await res.json().catch(() => null) };
};

(async () => {
  agency = await p.agencyInstall.findFirst({ select: { id: true } });
  location = await p.locationInstall.findFirst({
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

  const stale = await p.deskUser.findMany({ where: { email: { startsWith: "offboard-" } }, select: { id: true } });
  if (stale.length) {
    const ids = stale.map((u) => u.id);
    await p.deskSession.deleteMany({ where: { deskUserId: { in: ids } } });
    await p.deskUser.deleteMany({ where: { id: { in: ids } } });
    console.log(`  (cleared ${stale.length} desk users left by an earlier run)`);
  }

  /**
   * MEASURE THE DELTA, AND PRINT THE BASELINE.
   *
   * This asserted `before === 0` and then exact depths, so any conversation somebody had
   * left waiting on the dev database failed four checks at once and read as the release
   * putting the wrong things in the queue. Found 2026-08-19 against a genuinely escalated
   * tier-2 ticket from two days earlier — the same one the queue-reach alarm is there to
   * report, i.e. intended data, not dirt.
   *
   * The queue is desk-wide by design, exactly like `firstResponseStats` and the ticket
   * automations, so "empty" was never what was meant: what these checks are about is that
   * the release adds the right rows and leaves the rest alone. That is true on any
   * database. Fourth occurrence of this trap — treat it as the default suspect.
   */
  const baseline = await p.conversation.count({ where: { status: "escalated", assignedToId: null } });
  console.log(`  (baseline: ${baseline} ticket(s) already waiting on this database — every depth below is measured from there)`);

  const ada = await makeUser("Ada", { tier: 1, maxConcurrent: 3 });
  const bo = await makeUser("Bo", { tier: 1, maxConcurrent: 3 });
  const mgr = await makeUser("Mgr", { tier: 3, maxConcurrent: 5, role: "mosaic_admin" });

  // Ada is holding two: one a client is still waiting on for a first human reply, and
  // one live conversation she had already answered.
  const waiting = await makeTicket({ minutesWaiting: 47, status: "escalated", assignedToId: ada.id });
  const live = await makeTicket({ minutesWaiting: 20, status: "open", assignedToId: ada.id });
  // And one nobody has touched, as a control: it must come back untouched.
  const untouched = await makeTicket({ minutesWaiting: 5, status: "escalated" });

  console.log("\n== before: two clients are Ada's problem and nobody else's ==");
  let board = (await desk(bo.jar, "GET", "/desk/api/queue")).json;
  check(
    "the queue gains only the unclaimed ticket",
    board.depth === baseline + 1,
    `depth=${board.depth}, expected ${baseline} + 1 — Ada's two are hers, so they must not be in it`
  );
  const w = await widget(waiting, "/updates");
  check(
    "the waiting client is told somebody has it, not a place in line",
    w.json?.waiting === false && w.json?.position === null,
    JSON.stringify(w.json && { waiting: w.json.waiting, position: w.json.position })
  );

  console.log("\n== Ada leaves: disabling her must not take the tickets with her ==");
  const disable = await desk(mgr.jar, "POST", `/desk/api/users/${ada.id}/disable`, {});
  check("an admin can disable her", disable.status === 200, `${disable.status} ${JSON.stringify(disable.json)}`);
  check(
    "  ↳ and the response says how many tickets that released",
    disable.json?.releasedTickets === 2,
    JSON.stringify(disable.json)
  );
  check("  ↳ her live session is refused immediately", (await desk(ada.jar, "GET", "/desk/api/me")).status === 401);

  const after = await p.conversation.findMany({
    where: { id: { in: [waiting.id, live.id, untouched.id] } },
    select: { id: true, status: true, assignedToId: true, queuedAt: true },
  });
  const row = (id) => after.find((c) => c.id === id);

  check(
    "the ticket she had not answered is back in the queue",
    row(waiting.id).assignedToId === null && row(waiting.id).status === "escalated",
    JSON.stringify(row(waiting.id))
  );
  check(
    "  ↳ keeping its place: 47 minutes of waiting is not the client's fault",
    Math.abs(row(waiting.id).queuedAt.getTime() - waiting.queuedAt.getTime()) < 1000,
    `${row(waiting.id).queuedAt.toISOString()} vs ${waiting.queuedAt.toISOString()}`
  );
  check(
    "the live conversation she was mid-way through is queued too",
    row(live.id).assignedToId === null && row(live.id).status === "escalated",
    JSON.stringify(row(live.id))
  );
  check(
    "  ↳ with a FRESH clock, because this is a new wait for a new person",
    row(live.id).queuedAt.getTime() > Date.now() - 60_000,
    row(live.id).queuedAt.toISOString()
  );
  check(
    "the ticket nobody held is untouched",
    row(untouched.id).assignedToId === null &&
      Math.abs(row(untouched.id).queuedAt.getTime() - untouched.queuedAt.getTime()) < 1000,
    JSON.stringify(row(untouched.id))
  );

  console.log("\n== and the desk can actually work them again ==");
  board = (await desk(bo.jar, "GET", "/desk/api/queue")).json;
  check(
    "all three are in the queue",
    board.depth === baseline + 3,
    `depth=${board.depth}, expected ${baseline} + 3`
  );
  /**
   * Ordered among OUR THREE, not against the whole board. A ticket already waiting on
   * this database may legitimately be older than any fixture, and demanding first place
   * outright would be asserting that the dev database is empty in a second costume.
   * What the release must not do is send a 47-minute wait to the back of the line.
   */
  const ours = board.queue.filter((q) => [waiting.id, live.id, untouched.id].includes(q.id));
  check(
    "  ↳ the longest-waiting one is first of the three, ahead of the ticket nobody held",
    ours[0]?.id === waiting.id,
    ours.map((q) => q.id).join(",") + `  (full board: ${board.queue.map((q) => q.id).join(",")})`
  );
  const took = await desk(bo.jar, "POST", "/desk/api/queue/next", {});
  check("'take next' reaches it — it was unreachable before", took.json?.conversationId === waiting.id, JSON.stringify(took.json));
  check(
    "  ↳ Ada is gone from the agent list, so the board is not counting a seat she cannot fill",
    !board.agents.some((a) => a.id === ada.id),
    board.agents.map((a) => a.name).join(",")
  );

  console.log("\n== who had it before me is answerable, and the client never sees the answer ==");
  const notes = await p.message.findMany({
    where: { conversationId: { in: [waiting.id, live.id] }, role: "system" },
    select: { conversationId: true, role: true, body: true },
  });
  check("both released tickets carry a note in the transcript", notes.length === 2, JSON.stringify(notes));
  // `.every` on an empty array is true, so each of these asserts the count too — a check
  // that cannot fail is worse than no check.
  check(
    "  ↳ naming the person, so the next agent knows who to ask",
    notes.length === 2 && notes.every((n) => n.body.includes("Ada")),
    JSON.stringify(notes.map((n) => n.body))
  );
  check(
    "  ↳ written as `system`, never as something the client was sent",
    notes.length === 2 && notes.every((n) => n.role === "system")
  );

  const seen = await widget(waiting, "/updates?replay=1");
  const bodies = (seen.json?.messages ?? []).map((m) => m.body);
  check(
    "the client's own replay contains no staff name and no offboarding note",
    !bodies.some((b) => /Ada|disabled|account/i.test(b)),
    JSON.stringify(bodies)
  );
  check(
    "  ↳ and they are told they are waiting again, with a real position",
    // Bo claimed `waiting` above, so check the one still queued.
    (await widget(live, "/updates")).json?.position >= 1,
    JSON.stringify((await widget(live, "/updates")).json)
  );

  console.log("\n== re-enabling gives her the account back, not the tickets ==");
  await desk(mgr.jar, "POST", `/desk/api/users/${ada.id}/enable`, {});
  const reWaiting = await p.conversation.findUnique({ where: { id: waiting.id }, select: { assignedToId: true } });
  check(
    "a ticket someone else has since taken is not handed back",
    reWaiting.assignedToId !== ada.id,
    JSON.stringify(reWaiting)
  );

  console.log("\n== and a stranded ticket is reported, wherever it came from ==");
  // Rows can reach this state without the route: a psql session, or any deploy of the
  // code that predates the release above. Readiness exists for exactly the facts that
  // boot clean and answer nobody.
  await p.deskUser.update({ where: { id: bo.id }, data: { status: "disabled" } });
  /*
   * Imports the SOURCE under tsx, not `dist`. A suite that reads the built artifact is
   * asserting about whatever was there at the last `npm run build:server` — found 2026-08-26
   * when two deliberate mutations to `readiness.ts` left `verify-readiness` 34/34 green and
   * the build turned out to be a day old. Run these with `npx tsx`, not `node`.
   *
   * The `dist/assets` reads elsewhere are a different thing and stay: those deliberately
   * inspect the SHIPPED browser bundle, which is the artifact under test.
   */
  const { checkReadiness } = require(`${ROOT}/apps/server/src/services/readiness.ts`);
  const r = await checkReadiness();
  const stranded = r.findings.find((f) => f.id === "stranded-tickets");
  check("readiness names the ticket parked on a disabled account", !!stranded, r.findings.map((f) => f.id).join(","));
  check("  ↳ as a blocker, since a client is waiting on it", stranded?.severity === "blocker", stranded?.severity);
  check(
    "  ↳ and says what the reader is actually looking at",
    /queue|waiting|invisible/i.test(`${stranded?.what} ${stranded?.why}`),
    stranded?.what
  );

  await p.conversation.updateMany({ where: { assignedToId: bo.id }, data: { assignedToId: null } });
  const clean = await checkReadiness();
  check(
    "  ↳ and stops reporting it once released",
    !clean.findings.some((f) => f.id === "stranded-tickets"),
    clean.findings.map((f) => f.id).join(",")
  );

  console.log(`\n${"-".repeat(48)}\n  ${pass} passed, ${fail} failed`);
})()
  .catch((e) => {
    console.error("\nERROR:", e.stack);
    fail++;
  })
  .finally(async () => {
    for (const id of made.conversationIds) {
      await p.message.deleteMany({ where: { conversationId: id } }).catch(() => {});
      await p.conversation.delete({ where: { id } }).catch(() => {});
    }
    await p.deskSession.deleteMany({ where: { deskUserId: { in: made.userIds } } }).catch(() => {});
    await p.deskUser.deleteMany({ where: { id: { in: made.userIds } } }).catch(() => {});
    if (made.locationId) {
      await p.locationInstall.update({ where: { id: made.locationId }, data: { supportEnabled: made.supportWas ?? false } }).catch(() => {});
    }
    if (made.configCreated) {
      await p.supportConfig.deleteMany({ where: { agencyInstallId: agency?.id } }).catch(() => {});
    }
    console.log(`\ncleanup: conversations=${await p.conversation.count()} deskUsers=${await p.deskUser.count()}`);
    await p.$disconnect();
    process.exit(fail);
  });
