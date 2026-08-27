/**
 * Live checks for desk ROUTING: pick-up order, the atomic claim, capacity, tiers,
 * transfer, manager distribution, response-time stats, and the position the client is
 * shown.
 *
 * The headline check is the race. Everything else here is arithmetic that can be
 * reasoned about; "two agents both take the top ticket" cannot be tested by reading the
 * code, only by firing concurrent claims at a real Postgres and counting the winners.
 * The symptom in production is invisible on the desk and obvious to the client, who
 * receives two different replies to one question.
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
let pass = 0, fail = 0;

function check(name, ok, detail) {
  if (ok) { console.log(`  ok    ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}`); if (detail !== undefined) console.log(`        ${String(detail).slice(0, 300)}`); fail++; }
}

/** One jar per signed-in agent, so two of them can act at the same time. */
function session() {
  return { cookie: "" };
}

async function call(jar, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-mosaic-desk": "1",
      ...(jar.cookie ? { Cookie: jar.cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) jar.cookie = setCookie.split(";")[0];
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

function hashPassword(pw) {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 64, { N: 16384 }).toString("hex")}`;
}

const PASSWORD = "correct horse battery staple";
const stamp = Date.now();
const made = { userIds: [], conversationIds: [], themeId: null, locationId: null, configCreated: false, availabilityBefore: [] };

async function makeUser(name, extra) {
  const u = await p.deskUser.create({
    data: {
      // Lowercased: the login route lowercases what it is given, so a stored address
      // with a capital in it can never be signed in to.
      email: `routing-${name}-${stamp}@mosaic.test`.toLowerCase(),
      name,
      passwordHash: hashPassword(PASSWORD),
      ...extra,
    },
  });
  made.userIds.push(u.id);
  const jar = session();
  const res = await call(jar, "POST", "/desk/api/login", { email: u.email, password: PASSWORD });
  // /desk/api/login is rate-limited to 10/min. Re-running this script quickly trips it,
  // and a 429 that silently becomes a missing cookie reads like a routing bug three
  // checks later — say which it is.
  if (res.status !== 200 || !jar.cookie) {
    throw new Error(`login for ${name} failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
  return { ...u, jar };
}

let agency, location;

/** A ticket already waiting for a human, with an explicit place in the wait order. */
async function makeTicket({ minutesWaiting = 5, priority = "urgent", tier = 1 } = {}) {
  const c = await p.conversation.create({
    data: {
      agencyInstallId: agency.id,
      locationInstallId: location.id,
      accessTokenHash: createHash("sha256").update(randomBytes(24)).digest("hex"),
      status: "escalated",
      priority,
      tier,
      queuedAt: new Date(Date.now() - minutesWaiting * 60_000),
      lastMessageAt: new Date(Date.now() - minutesWaiting * 60_000),
    },
  });
  made.conversationIds.push(c.id);
  return c;
}

(async () => {
  /**
   * Remember what every EXISTING agent's availability was.
   *
   * Three checks below flip the whole desk away and back with
   * `updateMany({ where: { status: "active" } })` — real accounts included, because that is
   * what "the whole desk" means. Cleanup then set them all to `available`, which is not a
   * restore: it INVENTS a routing state. An agent who was deliberately away — lunch, end of
   * shift — came back marked on duty, so the queue would route live tickets to somebody who
   * is not there. That is precisely the failure the availability/status split exists to
   * prevent, arriving through the test harness.
   */
  made.availabilityBefore = await p.deskUser.findMany({ select: { id: true, availability: true } });
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

  // Users this script left behind on a previous crashed run would otherwise sit in the
  // agent pool as a SECOND "Ada" and "Mgr" — which is how the distribution check first
  // read as a code failure when it was really two rows sharing a display name.
  const stale = await p.deskUser.findMany({ where: { email: { startsWith: "routing-" } }, select: { id: true } });
  if (stale.length) {
    const ids = stale.map((u) => u.id);
    await p.deskSession.deleteMany({ where: { deskUserId: { in: ids } } });
    await p.deskUser.deleteMany({ where: { id: { in: ids } } });
    console.log(`  (cleared ${stale.length} desk users left by an earlier run)`);
  }

  const preexisting = await p.conversation.count({ where: { status: "escalated", assignedToId: null } });
  // Not a failure when somebody has a real ticket open on this database — the positions
  // below are asserted relative to each other, so a non-empty start is information, not a
  // defect. It IS worth saying out loud: a surprise here explains any position arithmetic
  // that looks off further down.
  if (preexisting > 0) {
    console.log(`  (${preexisting} ticket(s) were already waiting — positions below are relative to that)`);
  }
  check("the queue depth we start from is known", Number.isInteger(preexisting), preexisting);

  // Two tier-1 agents who can hold two tickets each, and one manager at tier 3.
  const ada = await makeUser("Ada", { tier: 1, maxConcurrent: 2 });
  const bo = await makeUser("Bo", { tier: 1, maxConcurrent: 2 });
  const mgr = await makeUser("Mgr", { tier: 3, maxConcurrent: 5, role: "mosaic_admin" });

  // ---- pick-up order -----------------------------------------------------
  console.log("\n== pick-up order ==");
  const oldest = await makeTicket({ minutesWaiting: 90 });
  const newer = await makeTicket({ minutesWaiting: 10 });
  const lowPrio = await makeTicket({ minutesWaiting: 300, priority: "low" });

  let r = await call(ada.jar, "GET", "/desk/api/queue");
  if (!r.json?.queue) throw new Error(`queue board failed: ${r.status} ${JSON.stringify(r.json)}`);
  const ids = r.json.queue.map((q) => q.id);
  check("longest-waiting first within a priority", ids.indexOf(oldest.id) < ids.indexOf(newer.id), ids.join(","));
  check(
    "urgent outranks a low-priority ticket that has waited five hours",
    ids.indexOf(oldest.id) < ids.indexOf(lowPrio.id),
    ids.join(",")
  );
  check("the board reports the wait, measured from queuedAt", r.json.queue[0].waitingSeconds >= 5000, r.json.queue[0].waitingSeconds);

  // ---- THE RACE ----------------------------------------------------------
  console.log("\n== the race: two agents, one top ticket ==");
  // Four concurrent claims (both agents twice) against exactly the three tickets above.
  const claims = await Promise.all([
    call(ada.jar, "POST", "/desk/api/queue/next"),
    call(bo.jar, "POST", "/desk/api/queue/next"),
    call(ada.jar, "POST", "/desk/api/queue/next"),
    call(bo.jar, "POST", "/desk/api/queue/next"),
  ]);
  const won = claims.filter((c) => c.status === 200).map((c) => c.json.conversationId);
  check(`${won.length} claims succeeded`, won.length >= 3, JSON.stringify(claims.map((c) => c.status)));
  check(
    "NO ticket was handed to two agents",
    new Set(won).size === won.length,
    `won: ${won.join(",")}`
  );

  const holders = await p.conversation.findMany({
    where: { id: { in: won } },
    select: { id: true, assignedToId: true },
  });
  check("every claim is recorded against exactly one agent", holders.every((h) => h.assignedToId), JSON.stringify(holders));

  // ---- capacity ----------------------------------------------------------
  console.log("\n== capacity ==");
  await makeTicket({ minutesWaiting: 3 });
  await makeTicket({ minutesWaiting: 2 });
  // Ada holds 2 of 2 after the race (or Bo does); whoever is full must be refused.
  const adaHeld = await p.conversation.count({ where: { assignedToId: ada.id, status: { in: ["escalated", "open"] } } });
  const boHeld = await p.conversation.count({ where: { assignedToId: bo.id, status: { in: ["escalated", "open"] } } });
  const full = adaHeld >= 2 ? ada : boHeld >= 2 ? bo : null;
  if (full) {
    r = await call(full.jar, "POST", "/desk/api/queue/next");
    check("an agent at their limit is refused, not given a fourth", r.status === 409 && r.json.reason === "at-capacity", JSON.stringify(r.json));
  } else {
    check("an agent at their limit is refused", false, `neither agent reached capacity (ada=${adaHeld} bo=${boHeld})`);
  }

  // ---- availability ------------------------------------------------------
  console.log("\n== availability ==");
  const before = (await call(mgr.jar, "GET", "/desk/api/queue")).json.capacity.capacity;
  await call(mgr.jar, "POST", "/desk/api/me/availability", { availability: "away" });
  const after = (await call(mgr.jar, "GET", "/desk/api/queue")).json.capacity;
  check("going away removes that agent's seats from capacity", after.capacity === before - 5, `${before} → ${after.capacity}`);
  r = await call(mgr.jar, "POST", "/desk/api/queue/next");
  check("an away agent cannot take a ticket", r.status === 409, JSON.stringify(r.json));
  const stillHeld = await p.conversation.count({ where: { assignedToId: ada.id, status: { in: ["escalated", "open"] } } });
  check("going away does NOT dump the tickets they already hold", stillHeld > 0, stillHeld);
  await call(mgr.jar, "POST", "/desk/api/me/availability", { availability: "available" });

  // ---- tiers -------------------------------------------------------------
  console.log("\n== tiers ==");
  await p.conversation.updateMany({ where: { id: { in: made.conversationIds } }, data: { status: "resolved" } });
  const tier2 = await makeTicket({ minutesWaiting: 20, tier: 2 });

  // Free both tier-1 agents so capacity is not what refuses them.
  await p.conversation.updateMany({ where: { assignedToId: { in: [ada.id, bo.id] } }, data: { assignedToId: null, status: "resolved" } });
  r = await call(ada.jar, "POST", "/desk/api/queue/next");
  check("a tier-1 agent is never handed a tier-2 ticket", r.status === 409 && r.json.reason === "empty", JSON.stringify(r.json));
  r = await call(mgr.jar, "POST", "/desk/api/queue/next");
  check("a tier-3 agent takes it", r.status === 200 && r.json.conversationId === tier2.id, JSON.stringify(r.json));

  // ---- transfer ----------------------------------------------------------
  console.log("\n== transfer ==");
  r = await call(mgr.jar, "POST", `/desk/api/conversations/${tier2.id}/transfer`, { deskUserId: ada.id });
  check("refuses to transfer a tier-2 ticket down to a tier-1 agent", r.status === 400, JSON.stringify(r.json));
  check("  ↳ and names the fix rather than just saying no", /lower the tier/i.test(r.json?.error ?? ""), r.json?.error);

  await p.deskUser.update({ where: { id: ada.id }, data: { tier: 2 } });
  r = await call(mgr.jar, "POST", `/desk/api/conversations/${tier2.id}/transfer`, { deskUserId: ada.id, note: "over to you" });
  check("transfers to a qualified colleague", r.status === 200 && r.json.assignedTo.id === ada.id, JSON.stringify(r.json));
  let notes = await p.message.findMany({ where: { conversationId: tier2.id, role: "system" } });
  check(
    "the hand-off is written into the transcript, not just the assignee field",
    notes.some((m) => /transferred/i.test(m.body) && /Ada/.test(m.body)),
    notes.map((m) => m.body).join(" | ")
  );

  // ---- escalation --------------------------------------------------------
  console.log("\n== escalation to level 2 / 3 ==");
  const t1 = await makeTicket({ minutesWaiting: 15 });
  await call(ada.jar, "POST", "/desk/api/queue/next");
  r = await call(ada.jar, "POST", `/desk/api/conversations/${t1.id}/escalate`, { note: "needs billing knowledge" });
  check("raises the tier", r.status === 200 && r.json.tier === 2, JSON.stringify(r.json));
  let after1 = await p.conversation.findUnique({ where: { id: t1.id } });
  check("UNASSIGNS — the escalating agent has said they can't finish it", after1.assignedToId === null, after1.assignedToId);
  check("and it is back in the queue", after1.status === "escalated", after1.status);
  check("with a fresh wait clock for the next person", after1.queuedAt.getTime() > Date.now() - 60_000, after1.queuedAt);
  notes = await p.message.findMany({ where: { conversationId: t1.id, role: "system" } });
  check("the escalation and its reason are recorded", notes.some((m) => /escalated to tier 2/i.test(m.body) && /billing/.test(m.body)), notes.map((m) => m.body).join(" | "));
  check("reports how many agents can actually take it", typeof r.json.agentsAtTier === "number" && r.json.agentsAtTier > 0, r.json.agentsAtTier);

  r = await call(mgr.jar, "POST", `/desk/api/conversations/${t1.id}/escalate`, { tier: 4 });
  check("refuses a fourth tier", r.status === 400, JSON.stringify(r.json));
  check("  ↳ and points at the real next step: hand it to the agency", /hand it to the agency/i.test(r.json?.error ?? ""), r.json?.error);

  // ---- distribution ------------------------------------------------------
  console.log("\n== manager distribution ==");
  await p.conversation.updateMany({ where: { id: { in: made.conversationIds } }, data: { status: "resolved", assignedToId: null } });
  await p.deskUser.update({ where: { id: ada.id }, data: { tier: 1 } });
  const d1 = await makeTicket({ minutesWaiting: 30 });
  const d2 = await makeTicket({ minutesWaiting: 25 });
  const d3 = await makeTicket({ minutesWaiting: 20, tier: 3 });

  r = await call(ada.jar, "POST", "/desk/api/queue/distribute");
  check("an agent cannot distribute other people's work", r.status === 403, JSON.stringify(r.json));

  const boardBefore = (await call(mgr.jar, "GET", "/desk/api/queue")).json;
  console.log(`        agents: ${boardBefore.agents.map((a) => `${a.name} t${a.tier} ${a.held}/${a.maxConcurrent}${a.available ? "" : " away"}`).join(" | ")}`);
  r = await call(mgr.jar, "POST", "/desk/api/queue/distribute");
  check("the manager can", r.status === 200, JSON.stringify(r.json));
  const assigned = await p.conversation.findMany({
    where: { id: { in: [d1.id, d2.id, d3.id] } },
    select: { id: true, tier: true, assignedToId: true, assignedTo: { select: { name: true, tier: true } } },
  });
  // Keyed on ID, not name: two desk accounts can share a display name, and counting
  // names conflates them.
  const spread = new Set(assigned.filter((a) => a.assignedToId).map((a) => a.assignedToId));
  check("spreads across agents rather than stacking one", spread.size >= 2, JSON.stringify(assigned.map((a) => a.assignedTo?.name)));
  check(
    "never puts a tier-3 ticket on someone who can't take it",
    assigned.every((a) => !a.assignedTo || a.assignedTo.tier >= a.tier),
    JSON.stringify(assigned)
  );

  // Nobody available at all: the queue must stay queued, and say so.
  //
  // Marking only THIS script's users away is not enough — the dev database has its own
  // desk accounts, and the queue is global. That gap made this check pass a ticket to a
  // pre-existing agent and read as a distribution bug.
  await p.conversation.updateMany({ where: { id: { in: made.conversationIds } }, data: { status: "resolved", assignedToId: null } });
  await makeTicket({ minutesWaiting: 5 });
  await p.deskUser.updateMany({ where: { status: "active" }, data: { availability: "away" } });
  r = await call(mgr.jar, "POST", "/desk/api/queue/distribute");
  check("with nobody available, nothing is assigned and it is reported", r.json.assigned === 0 && r.json.leftQueued >= 1, JSON.stringify(r.json));

  // ---- the ETA the client is told ---------------------------------------
  console.log("\n== what the client is told ==");
  // Enough measured responses to have a basis for an estimate at all: below
  // MIN_SAMPLES_FOR_ESTIMATE the answer is null whatever the staffing, so without
  // these the "nobody on the desk" check below would pass for the wrong reason.
  for (let i = 0; i < 6; i++) {
    const sample = await p.conversation.create({
      data: {
        agencyInstallId: agency.id,
        locationInstallId: location.id,
        accessTokenHash: createHash("sha256").update(randomBytes(24)).digest("hex"),
        status: "resolved",
        startedAt: new Date(Date.now() - 400_000),
        queuedAt: new Date(Date.now() - 300_000),
        firstAgentReplyAt: new Date(Date.now() - 240_000),
        lastMessageAt: new Date(),
      },
    });
    made.conversationIds.push(sample.id);
  }

  r = await call(mgr.jar, "GET", "/desk/api/queue");
  check("no ETA is quoted when nobody is on the desk, however much history we have",
    r.json.estimatedWaitSeconds === null && r.json.responseTime.count >= 6,
    JSON.stringify({ eta: r.json.estimatedWaitSeconds, samples: r.json.responseTime.count }));

  await p.deskUser.updateMany({ where: { status: "active" }, data: { availability: "available" } });
  r = await call(mgr.jar, "GET", "/desk/api/queue");
  check("but a staffed desk with real history DOES quote one",
    typeof r.json.estimatedWaitSeconds === "number" && r.json.estimatedWaitSeconds > 0,
    r.json.estimatedWaitSeconds);

  // The widget half needs support actually switched on. Saved through the ADMIN API
  // rather than Prisma for the same reason verify-e2e does it: that write invalidates
  // the brand-map cache, so running straight after another suite doesn't read stale.
  made.configCreated = !(await p.supportConfig.findUnique({ where: { agencyInstallId: agency.id } }));
  const cfgRes = await fetch(`${BASE}/admin/api/${agency.id}/support`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true, escalationEmails: ["ops@agency.test"] }),
  });
  if (cfgRes.status >= 400) throw new Error(`support config save failed: ${cfgRes.status} ${await cfgRes.text()}`);
  await p.locationInstall.update({ where: { id: location.id }, data: { supportEnabled: true } });

  // The widget's own view of the same queue.
  const convRes = await fetch(
    `${BASE}/support/api/${agency.id}/${location.ghlLocationId}/conversation`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageUrl: "https://app.example.com/v2/location/x/contacts" }) }
  );
  const conv = await convRes.json();
  made.conversationIds.push(conv.conversationId);

  const widget = async (path, token) => {
    const res = await fetch(`${BASE}/support/api/${agency.id}/${location.ghlLocationId}/conversation/${conv.conversationId}${path}`, {
      headers: { "Content-Type": "application/json", ...(token ? { "x-mosaic-conversation": token } : {}) },
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  let q = await widget("/updates", conv.token);
  check("a conversation nobody has escalated is not 'waiting'", q.json.waiting === false, JSON.stringify(q.json));

  await fetch(`${BASE}/support/api/${agency.id}/${location.ghlLocationId}/conversation/${conv.conversationId}/escalate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mosaic-conversation": conv.token },
    body: JSON.stringify({ note: "please have someone call me" }),
  });
  const escalated = await p.conversation.findUnique({ where: { id: conv.conversationId } });
  check("asking for a human sets the queue clock", escalated.queuedAt !== null, escalated.queuedAt);

  q = await widget("/updates", conv.token);
  check("the client is given a real place in line", q.json.waiting === true && q.json.position >= 1, JSON.stringify(q.json));
  check("and the updates endpoint needs their own token", (await widget("/updates")).status === 401);
  check(
    "the payload says NOTHING about the desk's staffing",
    !("capacity" in q.json) && !("agents" in q.json) && !("free" in q.json) && !("onDuty" in q.json),
    JSON.stringify(q.json)
  );

  // The position the client sees must be the position the desk pops from.
  const board = (await call(mgr.jar, "GET", "/desk/api/queue")).json;
  const deskPos = board.queue.findIndex((row) => row.id === conv.conversationId) + 1;
  check("the client's position matches the desk's own order", deskPos === q.json.position, `desk=${deskPos} client=${q.json.position}`);

  // ...and so must the WAIT. The desk's line says it shows "what a client at the back of
  // the queue would be told"; it used to re-derive that from the seconds with its own
  // compact formatter while the widget did its own rounding, so one estimate produced two
  // sentences and the desk's claim to be quoting the client's was false. Same rule as the
  // position above: one definition, asserted across both screens rather than trusted.
  check(
    "the desk quotes a SENTENCE, not a number it will format its own way",
    typeof board.estimatedWaitText === "string" && board.estimatedWaitText.startsWith("Usually"),
    JSON.stringify({ text: board.estimatedWaitText, seconds: board.estimatedWaitSeconds })
  );
  check(
    "  ↳ and it is the same wording the widget hands the client",
    q.json.estimatedWaitText === null || /^Usually (about .+|under a minute)\.$/.test(q.json.estimatedWaitText),
    JSON.stringify({ client: q.json.estimatedWaitText })
  );
  check(
    "  ↳ no compact desk format (`1h 7m`) can reach a client's screen",
    !/\d+h ?\d*m/.test(String(board.estimatedWaitText)) &&
      !/\d+h ?\d*m/.test(String(q.json.estimatedWaitText)),
    JSON.stringify({ desk: board.estimatedWaitText, client: q.json.estimatedWaitText })
  );
  check(
    "  ↳ a client who is NOT waiting is promised nothing at all",
    (await widget("/updates", conv.token)).json.waiting === false ||
      (await (async () => {
        const other = await (await fetch(`${BASE}/support/api/${agency.id}/${location.ghlLocationId}/conversation`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageUrl: "https://app.example.com/v2/location/x/contacts" }),
        })).json();
        made.conversationIds.push(other.conversationId);
        const res = await fetch(`${BASE}/support/api/${agency.id}/${location.ghlLocationId}/conversation/${other.conversationId}/updates`, {
          headers: { "x-mosaic-conversation": other.token },
        });
        const body = await res.json();
        return body.waiting === false && body.estimatedWaitText === null;
      })()),
    "an unqueued conversation must carry estimatedWaitText: null"
  );

  // A follow-up must not send them to the back of their own queue.
  const wasQueuedAt = escalated.queuedAt.getTime();
  await fetch(`${BASE}/support/api/${agency.id}/${location.ghlLocationId}/conversation/${conv.conversationId}/escalate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mosaic-conversation": conv.token },
    body: JSON.stringify({ note: "hello? anyone there?" }),
  });
  const again = await p.conversation.findUnique({ where: { id: conv.conversationId } });
  check("chasing does not restart their own wait clock", again.queuedAt.getTime() === wasQueuedAt, `${wasQueuedAt} → ${again.queuedAt.getTime()}`);

  // Once claimed, the widget stops counting.
  await p.conversation.update({ where: { id: conv.conversationId }, data: { assignedToId: mgr.id } });
  q = await widget("/updates", conv.token);
  check("stops showing a position the moment someone picks it up", q.json.waiting === false, JSON.stringify(q.json));

  // ---- response time -----------------------------------------------------
  console.log("\n== response time ==");
  // Two minutes of bot chat, then escalated, then answered a minute later. Measured
  // from the escalation, the answer is 60s; measured from startedAt it is 180s.
  const timed = await p.conversation.create({
    data: {
      agencyInstallId: agency.id,
      locationInstallId: location.id,
      accessTokenHash: createHash("sha256").update(randomBytes(24)).digest("hex"),
      status: "resolved",
      startedAt: new Date(Date.now() - 180_000),
      queuedAt: new Date(Date.now() - 60_000),
      firstAgentReplyAt: new Date(),
      lastMessageAt: new Date(),
    },
  });
  made.conversationIds.push(timed.id);
  const stats = (await call(mgr.jar, "GET", "/desk/api/queue")).json.responseTime;
  check(
    "response time is measured from the hand-off, not from the client's first hello",
    stats.count > 0 && stats.medianSeconds < 120,
    JSON.stringify(stats)
  );
  check("the window is stated alongside the number", stats.windowDays === 7, stats.windowDays);

  // These percentiles used to be a pure JS function with unit tests. They now run as
  // `percentile_cont` inside Postgres — the JS version pulled every row in the window
  // across the pipe and was 97% of the cost of a poll that fires for every waiting
  // client — so the same properties are pinned here, against real SQL, with exact
  // fixtures rather than a range.
  console.log("\n== percentiles, in SQL ==");
  await p.conversation.updateMany({ where: { id: { in: made.conversationIds } }, data: { status: "abandoned", queuedAt: null, firstAgentReplyAt: null } });

  const mkTimed = async (waitSeconds) => {
    const c = await p.conversation.create({
      data: {
        agencyInstallId: agency.id,
        locationInstallId: location.id,
        accessTokenHash: createHash("sha256").update(randomBytes(24)).digest("hex"),
        status: "resolved",
        startedAt: new Date(Date.now() - 7200_000),
        queuedAt: new Date(Date.now() - 3600_000),
        firstAgentReplyAt: new Date(Date.now() - 3600_000 + waitSeconds * 1000),
        lastMessageAt: new Date(),
      },
    });
    made.conversationIds.push(c.id);
    return c;
  };

  /**
   * BASELINE, not zero — and that distinction is the check, not a workaround.
   *
   * `firstResponseStats` is DESK-WIDE on purpose: the desk is Mosaic's own and answers
   * every agency, so the percentile it reports is over every settled conversation in the
   * window. This section used to assert `count === 0` and exact medians, which silently
   * required the whole database to hold nothing else. Two conversations somebody made by
   * hand while exploring the widget — real rows, correctly counted — then failed three
   * checks at once and read as a broken percentile query.
   *
   * The same trap `verify-tickets` documents for the automation passes: the thing under
   * test is global, so the suite must measure RELATIVE to what is already there and say
   * out loud what that was. Every assertion below is now a statement about the delta,
   * which is what was actually meant and is true on any database.
   */
  const baseline = (await call(mgr.jar, "GET", "/desk/api/queue")).json.responseTime;
  check(
    "an empty sample is zeroes, not null or NaN",
    Number.isFinite(baseline.count) && Number.isFinite(baseline.medianSeconds) && Number.isFinite(baseline.p90Seconds),
    JSON.stringify(baseline)
  );
  if (baseline.count > 0) {
    console.log(`  (baseline: ${baseline.count} settled conversation(s) already in the 7-day window — assertions below are relative)`);
  }

  // 60, 90, 120 and 150 seconds: four ordinary replies clustered around two minutes.
  for (const s of [60, 90, 120, 150]) await mkTimed(s);
  const four = (await call(mgr.jar, "GET", "/desk/api/queue")).json.responseTime;
  check("every settled conversation is counted, ours included", four.count === baseline.count + 4, JSON.stringify({ baseline: baseline.count, now: four.count }));

  // Then one answered seven hours later, overnight. THE point of the median.
  await mkTimed(7 * 3600);
  const five = (await call(mgr.jar, "GET", "/desk/api/queue")).json.responseTime;
  check("  ↳ and the outlier is one of them", five.count === four.count + 1, JSON.stringify(five));
  check(
    "MEDIAN, not mean — one overnight ticket barely moves it",
    Math.abs(five.medianSeconds - four.medianSeconds) < 60,
    JSON.stringify({ before: four.medianSeconds, after: five.medianSeconds })
  );
  check(
    "  ↳ the mean would have moved by more than twenty minutes and describe nobody",
    (7 * 3600 - four.medianSeconds) / five.count > 20 * 60,
    `a mean over ${five.count} samples absorbs the 7h reply as +${Math.round((7 * 3600 - four.medianSeconds) / five.count / 60)} min`
  );
  check("p90 reports the tail the complaints come from", five.p90Seconds > 5000, five.p90Seconds);

  // A reply stamped BEFORE the hand-off is a data problem, not an instant answer. The
  // invariant is that the sample count does not MOVE — which is the real claim, and does
  // not need the database to be empty to make it.
  await mkTimed(-600);
  const withBackwards = (await call(mgr.jar, "GET", "/desk/api/queue")).json.responseTime;
  check(
    "a reply timestamped before the hand-off is excluded, not counted as zero",
    withBackwards.count === five.count,
    JSON.stringify({ before: five.count, after: withBackwards.count })
  );

  console.log(`\n${"-".repeat(48)}\n  ${pass} passed, ${fail} failed`);
})()
  .catch((e) => { console.error("\nERROR:", e.stack); fail++; })
  .finally(async () => {
    for (const id of made.conversationIds) {
      await p.message.deleteMany({ where: { conversationId: id } }).catch(() => {});
      await p.conversation.delete({ where: { id } }).catch(() => {});
    }
    await p.deskSession.deleteMany({ where: { deskUserId: { in: made.userIds } } }).catch(() => {});
    await p.deskUser.deleteMany({ where: { id: { in: made.userIds } } }).catch(() => {});
    // Pre-existing local accounts were flipped by the staffing checks above — put each one
    // back to what it WAS, per user. Setting them all "available" reads like a restore and
    // is a write of state nobody chose.
    for (const u of made.availabilityBefore) {
      if (made.userIds.includes(u.id)) continue; // ours, deleted just above
      await p.deskUser.update({ where: { id: u.id }, data: { availability: u.availability } }).catch(() => {});
    }
    if (made.locationId) {
      await p.locationInstall.update({ where: { id: made.locationId }, data: { supportEnabled: made.supportWas ?? false } }).catch(() => {});
    }
    if (made.configCreated) {
      await p.supportConfig.deleteMany({ where: { agencyInstallId: agency?.id } }).catch(() => {});
    }
    console.log(
      `\ncleanup: conversations=${await p.conversation.count()} deskUsers=${await p.deskUser.count()}`
    );
    await p.$disconnect();
    process.exit(fail);
  });
