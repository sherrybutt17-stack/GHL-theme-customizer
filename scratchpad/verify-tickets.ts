/**
 * The passes that make a ticket chase itself — checked against a real database, a real
 * desk session and the real widget, because every one of them is a claim about behaviour
 * ACROSS modules and none of it is visible by reading one file.
 *
 * WHY THIS SUITE EXISTS AT ALL. Every clock these automations read already lived on
 * `Conversation` — `queuedAt`, `firstAgentReplyAt`, `assignedAt`, `lastMessageAt` — and
 * until the automations were written NOTHING read them on a schedule. The desk coloured a
 * row red after an hour and that was the whole of it: cosmetic, computed at render time,
 * and invisible to anybody not looking at the tab. That is the same shape as the two worst
 * bugs this product has had — the desk storing replies nothing delivered, and the review
 * queue nothing could empty — so the passes need the same treatment those got: not a
 * reading, a run.
 *
 * The unit tests (`ticketSla.test.ts`, `businessHours.test.ts`) already pin the open-hours
 * ARITHMETIC against a fake clock, so nothing here re-derives it. What only a live run can
 * show is the WIRING: that the pass actually reads this agency's stored policy and stored
 * hours, that a claim survives a second run, that a message written as `bot` reaches the
 * client's own screen while one written as `system` does not, and that `--dry-run` writes
 * nothing — which is exactly the promise `crawl-kb` made and broke.
 *
 *   npx tsx scratchpad/verify-tickets.ts        (needs `npm run dev:server` on 3210)
 */
// FIRST — the workspace .env then the root one; `dotenv/config` alone does not find it.
import "../apps/server/src/services/loadEnv";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { prisma } from "../apps/server/src/services/prisma";
import { runTicketAutomations } from "../apps/server/src/services/ticketAutomations";
import { checkReadiness } from "../apps/server/src/services/readiness";
// The desk's own colour rule, EXECUTED rather than read. `verify-delivery` was 23/23 green
// while the widget never called the endpoint it was testing, because nothing asked whether
// the client used it — so a server payload that is right proves nothing about the screen.
import { slaTone, slaTitle, WARN_AT } from "../apps/support-desk/src/slaTone";
import { queueReach } from "../apps/support-desk/src/queueReach";

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL is not local. This script writes and deletes rows.");
  process.exit(1);
}

const BASE = "http://localhost:3210";
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}`);
    if (detail !== undefined) console.log(`        ${String(detail).slice(0, 400)}`);
  }
}

const stamp = Date.now();
const PASSWORD = "correct horse battery staple";
const made = { conversationIds: [] as string[], userIds: [] as string[], configCreated: false, locationId: "", supportWas: false };

function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 64, { N: 16384 }).toString("hex")}`;
}

const min = (n: number) => new Date(Date.now() - n * 60_000);
const days = (n: number) => new Date(Date.now() - n * 86_400_000);

let agency: { id: string };
let location: { id: string; ghlLocationId: string };
const jar = { cookie: "" };

async function desk(method: string, path: string, body?: unknown) {
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
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

/** The client's own view. Everything a widget can see, it sees through here. */
async function widget(conv: { id: string; token: string }, path: string, init?: RequestInit) {
  const res = await fetch(
    `${BASE}/support/api/${agency.id}/${location.ghlLocationId}/conversation/${conv.id}${path}`,
    {
      ...init,
      headers: { "Content-Type": "application/json", "x-mosaic-conversation": conv.token },
    }
  );
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

interface TicketSpec {
  status?: "open" | "escalated" | "resolved" | "abandoned";
  priority?: string;
  tier?: number;
  queuedAt?: Date | null;
  lastMessageAt?: Date;
  assignedToId?: string | null;
  assignedAt?: Date | null;
  firstAgentReplyAt?: Date | null;
  snoozedUntil?: Date | null;
  idleWarnedAt?: Date | null;
  botPaused?: boolean;
  body?: string;
}

async function makeTicket(spec: TicketSpec = {}) {
  const token = randomBytes(24).toString("hex");
  const c = await prisma.conversation.create({
    data: {
      agencyInstallId: agency.id,
      locationInstallId: location.id,
      accessTokenHash: createHash("sha256").update(token).digest("hex"),
      status: spec.status ?? "escalated",
      priority: spec.priority ?? "normal",
      tier: spec.tier ?? 1,
      queuedAt: spec.queuedAt === undefined ? min(30) : spec.queuedAt,
      lastMessageAt: spec.lastMessageAt ?? min(30),
      assignedToId: spec.assignedToId ?? null,
      assignedAt: spec.assignedAt ?? null,
      firstAgentReplyAt: spec.firstAgentReplyAt ?? null,
      snoozedUntil: spec.snoozedUntil ?? null,
      idleWarnedAt: spec.idleWarnedAt ?? null,
      botPaused: spec.botPaused ?? false,
    },
  });
  made.conversationIds.push(c.id);
  await prisma.message.create({
    data: {
      conversationId: c.id,
      role: "user",
      body: spec.body ?? "My calendar bookings are not syncing.",
      createdAt: spec.lastMessageAt ?? min(30),
    },
  });
  return { ...c, token };
}

const reload = (id: string) => prisma.conversation.findUnique({ where: { id } });
const transcript = (id: string) =>
  prisma.message.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" } });
async function bodies(id: string): Promise<string> {
  return (await transcript(id)).map((m) => `${m.role}:${m.body}`).join("\n");
}

/** Save the whole support config — the PUT clears any field it is not sent. */
async function saveConfig(extra: Record<string, unknown>) {
  const res = await fetch(`${BASE}/admin/api/${agency.id}/support`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true, escalationEmails: ["ops@agency.test"], ...extra }),
  });
  if (!res.ok) throw new Error(`support config save failed: ${res.status} ${await res.text()}`);
}

async function main(): Promise<void> {
  const found = await prisma.agencyInstall.findFirst({ where: { status: "active" }, select: { id: true } });
  if (!found) throw new Error("no active agency on this database");
  agency = found;
  const loc = await prisma.locationInstall.findFirst({
    where: { agencyInstallId: agency.id, status: "active" },
    select: { id: true, ghlLocationId: true, supportEnabled: true },
  });
  if (!loc) throw new Error("no active sub-account on this database");
  location = loc;
  made.locationId = loc.id;
  // Snapshotted, never assumed. Turning this back OFF is not restoring it: `supportEnabled`
  // is the agency's own per-sub-account switch, and hardcoding false silently withdraws the
  // client-facing widget from whichever real sub-account findFirst() happened to pick.
  made.supportWas = loc.supportEnabled;

  /**
   * The passes are GLOBAL — they act on every live conversation, exactly as they will in
   * production. There is no scoping option and there should not be one, so a row this
   * suite did not plant is a row it will nonetheless sweep.
   *
   * Said out loud rather than asserted. A hard failure here would report a dirty
   * development database as a product defect, and silence would let the suite act on
   * somebody's rows without saying so — which is the thing being warned about.
   */
  const others = await prisma.conversation.findMany({
    where: { status: { in: ["open", "escalated"] } },
    select: { id: true, status: true },
  });
  if (others.length > 0) {
    console.log(
      `\n  NOTE  ${others.length} conversation(s) were already live on this database and the passes\n` +
        `        below will act on them too — they are nudged, swept and closed like any other.\n` +
        `        ${others.map((o) => `${o.id}(${o.status})`).join(" ")}`
    );
  }

  made.configCreated = !(await prisma.supportConfig.findUnique({ where: { agencyInstallId: agency.id } }));
  await prisma.locationInstall.update({ where: { id: location.id }, data: { supportEnabled: true } });

  const me = await prisma.deskUser.create({
    data: {
      email: `tickets-${stamp}@mosaic.test`,
      name: "Ada",
      passwordHash: hashPassword(PASSWORD),
      role: "mosaic_admin",
      tier: 3,
      maxConcurrent: 5,
    },
  });
  made.userIds.push(me.id);
  // ONE login. /desk/api/login is 10/min per IP and a 429 here becomes a missing cookie
  // that reads like a routing bug several checks later.
  const login = await desk("POST", "/desk/api/login", { email: me.email, password: PASSWORD });
  if (login.status !== 200 || !jar.cookie) {
    throw new Error(`desk login failed: ${login.status} ${JSON.stringify(login.json)} — a 429 here means another desk suite ran in the last minute`);
  }

  // ---------------------------------------------------------------- the response target
  console.log("\n== the first-response target, read from THIS agency's stored policy ==");
  // normal = 5 minutes. The built-in default is 240, so a ticket waiting 30 minutes can
  // only breach if the stored policy actually reached the pass.
  await saveConfig({ slaFirstResponseMins: { normal: 5 } });

  const overdue = await makeTicket({ assignedToId: me.id, assignedAt: min(30) });
  const answered = await makeTicket({ firstAgentReplyAt: min(1) });
  const atMax = await makeTicket({ tier: 3 });

  await runTicketAutomations();

  const afterSla = await reload(overdue.id);
  check(
    "a ticket past the agency's own target is raised a tier",
    afterSla?.tier === 2,
    `tier=${afterSla?.tier} — 1 means the stored slaFirstResponseMins never reached the pass`
  );
  check(
    "  ↳ and UNASSIGNED, since raising it says the holder cannot finish it",
    afterSla?.assignedToId === null,
    `assignedToId=${afterSla?.assignedToId}`
  );
  check(
    "  ↳ the raise is written into the transcript, not just the tier column",
    /raised to tier 2 automatically/.test(await bodies(overdue.id)),
    await bodies(overdue.id)
  );
  check(
    "  ↳ it keeps the queue place it had already waited for",
    afterSla?.queuedAt?.getTime() === overdue.queuedAt?.getTime(),
    `${afterSla?.queuedAt?.toISOString()} vs ${overdue.queuedAt?.toISOString()}`
  );
  check("  ↳ and the breach is recorded", afterSla?.slaBreachedAt !== null);

  const afterAnswered = await reload(answered.id);
  check(
    "a ticket a human already replied to never breaches — the clock stopped",
    afterAnswered?.tier === 1 && afterAnswered?.slaBreachedAt === null,
    `tier=${afterAnswered?.tier} breachedAt=${afterAnswered?.slaBreachedAt}`
  );

  const afterMax = await reload(atMax.id);
  check("at the top tier it is not raised further", afterMax?.tier === 3, `tier=${afterMax?.tier}`);
  check(
    "  ↳ and does not silently stall — it names handing the ticket to the agency",
    /hand this to the agency/i.test(await bodies(atMax.id)),
    await bodies(atMax.id)
  );

  await runTicketAutomations();
  const twice = await reload(overdue.id);
  const raises = (await bodies(overdue.id)).match(/raised to tier/g)?.length ?? 0;
  check(
    "running again escalates nothing twice — the claim held",
    twice?.tier === 2 && raises === 1,
    `tier=${twice?.tier}, ${raises} raise notes`
  );

  // ----------------------------------------------------------------- counted in open hours
  console.log("\n== counted in the agency's OPEN hours, never wall clock ==");
  // Closed every day of the week: whenever this suite runs, the client has waited zero
  // OPEN minutes. Without the hours the same ticket is ten hours overdue on a 5-minute
  // target, so this can only pass if the stored hours reached the pass.
  await saveConfig({ slaFirstResponseMins: { normal: 5 }, businessHours: { tz: "UTC", days: {} } });
  const overnight = await makeTicket({ queuedAt: new Date(Date.now() - 10 * 3_600_000), lastMessageAt: min(600) });

  await runTicketAutomations();
  let afterHours = await reload(overnight.id);
  check(
    "a wait spent entirely outside the agency's hours does not breach",
    afterHours?.slaBreachedAt === null && afterHours?.tier === 1,
    `tier=${afterHours?.tier} breachedAt=${afterHours?.slaBreachedAt} — this is the backlog manufactured overnight by the clock`
  );

  // Unknown hours must mean "measure it crudely", never "the target never elapses".
  await saveConfig({ slaFirstResponseMins: { normal: 5 } });
  await runTicketAutomations();
  afterHours = await reload(overnight.id);
  check(
    "  ↳ but with no hours configured it falls back to wall clock rather than never firing",
    afterHours?.slaBreachedAt !== null && afterHours?.tier === 2,
    `tier=${afterHours?.tier} breachedAt=${afterHours?.slaBreachedAt}`
  );

  // ------------------------------------------------------------------------------ snooze
  console.log("\n== snooze: out of the way, and reliably back ==");
  const snoozed = await makeTicket({ queuedAt: min(90), snoozedUntil: new Date(Date.now() + 3_600_000) });
  await runTicketAutomations();
  let afterSnooze = await reload(snoozed.id);
  check(
    "a snoozed ticket is invisible to the nudges and the target check",
    afterSnooze?.lastReminderAt === null && afterSnooze?.slaBreachedAt === null,
    `reminder=${afterSnooze?.lastReminderAt} breach=${afterSnooze?.slaBreachedAt}`
  );

  const past = await desk("PATCH", `/desk/api/conversations/${snoozed.id}`, {
    snoozedUntil: new Date(Date.now() - 60_000).toISOString(),
  });
  check(
    "a snooze into the past is refused — it would reappear instantly and read as broken",
    past.status === 400,
    `${past.status} ${JSON.stringify(past.json)}`
  );

  await prisma.conversation.update({ where: { id: snoozed.id }, data: { snoozedUntil: min(1) } });
  await runTicketAutomations();
  afterSnooze = await reload(snoozed.id);
  check("an expired snooze comes back on its own", afterSnooze?.snoozedUntil === null);
  check(
    "  ↳ keeping the place in the queue it had before it was parked",
    afterSnooze?.queuedAt?.getTime() === snoozed.queuedAt?.getTime(),
    `${afterSnooze?.queuedAt?.toISOString()} vs ${snoozed.queuedAt?.toISOString()}`
  );
  check(
    "  ↳ and it is written into the transcript like every other hop",
    /snooze ended/.test(await bodies(snoozed.id)),
    await bodies(snoozed.id)
  );

  // ------------------------------------------------------------------------------ nudges
  console.log("\n== nudges: unclaimed, and held-but-unanswered ==");
  const unclaimed = await makeTicket({ queuedAt: min(30) });
  await runTicketAutomations();
  const nudged = await reload(unclaimed.id);
  check("an escalation nobody has picked up is nudged", nudged?.lastReminderAt !== null);

  await runTicketAutomations();
  const renudged = await reload(unclaimed.id);
  check(
    "  ↳ and not again on the very next run ten minutes later",
    renudged?.lastReminderAt?.getTime() === nudged?.lastReminderAt?.getTime(),
    `${renudged?.lastReminderAt?.toISOString()} vs ${nudged?.lastReminderAt?.toISOString()}`
  );

  /**
   * The two passes that can both want this ticket have a PRECEDENCE, and it only shows up
   * when a held ticket is also overdue. Checked in both directions, because the first
   * version of this section left the 5-minute target from the section above in place and
   * the SLA pass took the ticket first — which is correct behaviour and read as a bug.
   */
  const overdueHeld = await makeTicket({ assignedToId: me.id, assignedAt: min(60), queuedAt: min(70) });
  await runTicketAutomations();
  const afterOverdueHeld = await reload(overdueHeld.id);
  check(
    "a ticket that is BOTH held and overdue is re-queued, not merely nudged at its holder",
    afterOverdueHeld?.tier === 2 && afterOverdueHeld?.assignedToId === null,
    `tier=${afterOverdueHeld?.tier} assignedToId=${afterOverdueHeld?.assignedToId}`
  );

  // Now a target nobody is near, so the only thing that can act on the next ticket is the
  // reminder being tested.
  await saveConfig({ slaFirstResponseMins: { normal: 480 } });
  const held = await makeTicket({ assignedToId: me.id, assignedAt: min(60), queuedAt: min(70) });
  await runTicketAutomations();
  const afterHeld = await reload(held.id);
  check(
    "an agent holding a ticket they have not answered is reminded IN THE TICKET",
    /still unanswered/.test(await bodies(held.id)),
    await bodies(held.id)
  );
  check(
    "  ↳ and it is never taken off them — a reminder, not a release",
    afterHeld?.assignedToId === me.id,
    `assignedToId=${afterHeld?.assignedToId}`
  );

  // -------------------------------------------------------------------------------- idle
  console.log("\n== idle conversations are WARNED before they are closed ==");
  const idle = await makeTicket({ status: "open", queuedAt: null, lastMessageAt: days(5) });
  const busyEscalated = await makeTicket({ status: "escalated", queuedAt: days(12), lastMessageAt: days(12) });

  await runTicketAutomations();
  const warned = await reload(idle.id);
  check("a conversation silent for days gets a warning first", warned?.idleWarnedAt !== null);

  const warnMsg = (await transcript(idle.id)).find((m) => /close this conversation/.test(m.body));
  check(
    "  ↳ written as `bot`, so the CLIENT can actually see it",
    warnMsg?.role === "bot",
    `role=${warnMsg?.role} — \`system\` is filtered out of the client's view, which would make this a warning nobody was warned by`
  );
  const clientSees = await widget(idle, "/updates?replay=1");
  check(
    "  ↳ and it really does arrive through the widget's own poller",
    (clientSees.json?.messages ?? []).some((m: any) => /close this conversation/.test(m.body ?? "")),
    JSON.stringify(clientSees.json?.messages?.map((m: any) => m.role))
  );

  const afterEsc = await reload(busyEscalated.id);
  check(
    "an ESCALATED ticket idle for twelve days is left alone — that backlog is ours, not theirs",
    afterEsc?.status === "escalated" && afterEsc?.idleWarnedAt === null,
    `status=${afterEsc?.status} warnedAt=${afterEsc?.idleWarnedAt}`
  );

  // Warned, then the client came back: the outcome the warning exists for.
  const revived = await makeTicket({ status: "open", queuedAt: null, lastMessageAt: min(30), idleWarnedAt: days(3) });
  // Warned, and silence ever since.
  const abandoned = await makeTicket({
    status: "open",
    queuedAt: null,
    lastMessageAt: days(6),
    idleWarnedAt: days(3),
    botPaused: true,
  });

  await runTicketAutomations();
  const afterRevived = await reload(revived.id);
  check(
    "a client who replied after the warning is not closed",
    afterRevived?.status === "open",
    `status=${afterRevived?.status}`
  );
  const afterAbandoned = await reload(abandoned.id);
  check("one that stayed silent is closed", afterAbandoned?.status === "abandoned", `status=${afterAbandoned?.status}`);
  check(
    "  ↳ with the bot let back in, so a client returning later is not met with silence",
    afterAbandoned?.botPaused === false,
    `botPaused=${afterAbandoned?.botPaused}`
  );
  const closeMsg = (await transcript(abandoned.id)).find((m) => /closed automatically/.test(m.body));
  check(
    "  ↳ and the closing note is `system` — our workflow, not something the client is shown",
    closeMsg?.role === "system",
    `role=${closeMsg?.role}`
  );

  // ------------------------------------------------------------- a ticket raised BY the desk
  console.log("\n== a ticket for a client who phoned instead ==");
  const raised = await desk("POST", "/desk/api/conversations", {
    ghlLocationId: location.ghlLocationId,
    subject: "Cannot log in after the rebrand",
    // What the client actually said — vendor name and all.
    body: "They rang up and said GoHighLevel keeps logging them out.",
    channel: "phone",
    priority: "high",
    ticketType: "access",
    contactEmail: "client@example.com",
  });
  check("an agent can raise one", raised.status === 201, `${raised.status} ${JSON.stringify(raised.json)}`);
  if (raised.json?.id) made.conversationIds.push(raised.json.id);
  const deskTicket = raised.json?.id ? await reload(raised.json.id) : null;
  check(
    "  ↳ it holds no widget credential, because no client session exists for it",
    deskTicket?.accessTokenHash === null,
    `accessTokenHash=${deskTicket?.accessTokenHash}`
  );
  /**
   * Unreachable BY CONSTRUCTION, which is a stronger claim than "refused" and needs a
   * different check to show it. `requireConversation` looks the conversation up by the
   * hash of the header, and hashing can never produce NULL — so a desk ticket cannot be
   * matched by any token at all, and the refusal is necessarily identical to the one a
   * conversation that does not exist gets. Asserting a bare 401 would pass just as well
   * against a hand-written `if (origin === "desk")`, which is the version that can be
   * forgotten. The identical answer is also what stops this being an oracle for which
   * ticket ids are real.
   */
  const strayToken = randomBytes(24).toString("hex");
  const reachDesk = await widget({ id: deskTicket?.id ?? "x", token: strayToken }, "/updates?replay=1");
  const reachGhost = await widget({ id: "cmghostconversation000000", token: strayToken }, "/updates?replay=1");
  check(
    "  ↳ so no widget token reaches it — and the refusal is the one a nonexistent ticket gets",
    reachDesk.status === 401 &&
      reachDesk.status === reachGhost.status &&
      JSON.stringify(reachDesk.json) === JSON.stringify(reachGhost.json),
    `desk=${reachDesk.status} ${JSON.stringify(reachDesk.json)} / ghost=${reachGhost.status} ${JSON.stringify(reachGhost.json)}`
  );
  check(
    "  ↳ the bot is paused on it — a human raised it and a human owns it",
    deskTicket?.botPaused === true
  );
  check(
    "  ↳ it does not count against the deflection rate the agency is shown",
    deskTicket?.deflected === false && deskTicket?.origin === "desk",
    `deflected=${deskTicket?.deflected} origin=${deskTicket?.origin}`
  );
  check(
    "  ↳ and the agent's transcription of the client is stored verbatim, vendor name and all",
    /GoHighLevel keeps logging them out/.test(await bodies(deskTicket?.id ?? "")),
    "the gates are for text travelling TO a client — refusing this would refuse an agent for writing down what was said"
  );

  // ------------------------------------------------- the bot must not answer over a human
  console.log("\n== the bot does not talk over the person handling it ==");
  const paused = await makeTicket({ status: "open", queuedAt: null, lastMessageAt: min(1), botPaused: true });
  const before = (await transcript(paused.id)).length;
  const sent = await widget(paused, "/message", {
    method: "POST",
    body: JSON.stringify({ text: "Any update on this?" }),
  });
  check(
    "the client is told a person has it, not answered by the assistant",
    sent.json?.handedToHuman === true && sent.json?.reply === null,
    JSON.stringify(sent.json)
  );
  const afterSend = await transcript(paused.id);
  check(
    "  ↳ and no bot message was written at all",
    afterSend.length === before + 1 && !afterSend.some((m) => m.role === "bot"),
    afterSend.map((m) => m.role).join(",")
  );

  // ------------------------------------------------------------------------------ dry run
  console.log("\n== --dry-run reports, and writes nothing ==");
  await saveConfig({ slaFirstResponseMins: { normal: 5 } });
  const dry = await makeTicket({ queuedAt: min(120) });
  const dryReport = await runTicketAutomations({ dryRun: true });
  const dryMine = dryReport.actions.filter((a) => a.conversationId === dry.id);
  check("it reports what it would do", dryMine.length > 0, JSON.stringify(dryReport.actions.slice(0, 4)));
  const afterDry = await reload(dry.id);
  const dryMessages = (await transcript(dry.id)).length;
  check(
    "  ↳ and the database is untouched — the promise crawl-kb's dry run made and broke",
    afterDry?.tier === 1 &&
      afterDry?.slaBreachedAt === null &&
      afterDry?.lastReminderAt === null &&
      dryMessages === 1,
    `tier=${afterDry?.tier} breach=${afterDry?.slaBreachedAt} reminder=${afterDry?.lastReminderAt} messages=${dryMessages}`
  );

  // ------------------------------------------------------- resolving starts a clean slate
  console.log("\n== resolving clears the claims, so a NEW wait alerts afresh ==");
  const resolved = await desk("PATCH", `/desk/api/conversations/${overdue.id}`, { status: "resolved" });
  const afterResolve = await reload(overdue.id);
  check("an agent can resolve it", resolved.status === 200, `${resolved.status} ${JSON.stringify(resolved.json)}`);
  check(
    "  ↳ and the breach, the reminder and the idle warning are all cleared",
    afterResolve?.slaBreachedAt === null &&
      afterResolve?.lastReminderAt === null &&
      afterResolve?.idleWarnedAt === null,
    `breach=${afterResolve?.slaBreachedAt} reminder=${afterResolve?.lastReminderAt} idle=${afterResolve?.idleWarnedAt}`
  );
  check(
    "  ↳ with the bot handed the conversation back",
    afterResolve?.botPaused === false,
    `botPaused=${afterResolve?.botPaused}`
  );

  // ------------------------------------------------- the agency can actually set the target
  console.log("\n== the response target is settable, and survives the form's own save ==");
  const rawPut = await fetch(`${BASE}/admin/api/${agency.id}/support`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enabled: true,
      escalationEmails: ["ops@agency.test"],
      slaFirstResponseMins: { urgent: 15, high: 60, normal: 45, low: 480 },
    }),
  });
  const readBack = await (await fetch(`${BASE}/admin/api/${agency.id}/support`)).json();
  check("a policy can be saved", rawPut.status === 200, rawPut.status);
  check(
    "  ↳ and the GET hands back a COMPLETE policy, so the form has one code path",
    readBack?.config?.slaFirstResponseMins?.normal === 45 &&
      Object.keys(readBack?.config?.slaFirstResponseMins ?? {}).length === 4,
    JSON.stringify(readBack?.config?.slaFirstResponseMins)
  );

  /**
   * The dashboard saves by PUTting its whole config object back, and the PUT clears any
   * field it is not sent. So the field being absent from the editor is not enough on its
   * own to lose it — what matters is whether it survives a round trip. Checked rather
   * than reasoned about, because the answer decides whether this was a dead column or a
   * data-losing one.
   */
  const roundTrip = await fetch(`${BASE}/admin/api/${agency.id}/support`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(readBack.config),
  });
  const afterRoundTrip = await (await fetch(`${BASE}/admin/api/${agency.id}/support`)).json();
  check(
    "  ↳ saving the form back verbatim keeps it — the editor's save is not destructive",
    roundTrip.status === 200 && afterRoundTrip?.config?.slaFirstResponseMins?.normal === 45,
    JSON.stringify(afterRoundTrip?.config?.slaFirstResponseMins)
  );
  const dropped = await fetch(`${BASE}/admin/api/${agency.id}/support`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true, escalationEmails: ["ops@agency.test"] }),
  });
  const afterDrop = await (await fetch(`${BASE}/admin/api/${agency.id}/support`)).json();
  check(
    "  ↳ but a payload that omits it resets to the defaults, so the editor MUST send it",
    dropped.status === 200 && afterDrop?.config?.slaFirstResponseMins?.normal === 240,
    JSON.stringify(afterDrop?.config?.slaFirstResponseMins)
  );

  // And that the stored number is the one the automation acts on — per priority.
  await saveConfig({ slaFirstResponseMins: { urgent: 15, high: 60, normal: 45, low: 480 } });
  const highPr = await makeTicket({ priority: "high", queuedAt: min(70) });
  const lowPr = await makeTicket({ priority: "low", queuedAt: min(70) });
  await runTicketAutomations();
  check(
    "priority picks the target: 70 minutes breaches `high` (60)",
    (await reload(highPr.id))?.tier === 2,
    `tier=${(await reload(highPr.id))?.tier}`
  );
  check(
    "  ↳ and does not breach `low` (480), so the setting is not decoration",
    (await reload(lowPr.id))?.tier === 1,
    `tier=${(await reload(lowPr.id))?.tier}`
  );

  // ------------------------------------------- the desk shows the SAME lateness it acts on
  console.log("\n== one definition of late: inbox, queue board and the automation ==");
  await saveConfig({ slaFirstResponseMins: { urgent: 15, high: 60, normal: 240, low: 480 } });

  // Waiting 40 minutes on a 15-minute urgent target: plainly late.
  const late = await makeTicket({ priority: "urgent", queuedAt: min(40), lastMessageAt: min(40) });
  // The same wait, but the client has just chased us. The row must not go green because
  // of their own message — the person chasing is the one who has waited longest.
  const chased = await makeTicket({ priority: "urgent", queuedAt: min(40), lastMessageAt: min(0) });
  // Answered once already: the first-response clock has stopped for good.
  const answeredOnce = await makeTicket({ priority: "urgent", queuedAt: min(40), firstAgentReplyAt: min(5) });

  const inbox = await desk("GET", "/desk/api/inbox?status=escalated");
  const rowOf = (id: string) => (inbox.json?.conversations ?? []).find((r: any) => r.id === id);
  check(
    "the inbox reports a 40-minute wait on a 15-minute target as breached",
    rowOf(late.id)?.sla?.breached === true && rowOf(late.id)?.sla?.targetMinutes === 15,
    JSON.stringify(rowOf(late.id)?.sla)
  );
  check(
    "  ↳ a client chasing us does NOT reset their own row",
    rowOf(chased.id)?.sla?.breached === true,
    `${JSON.stringify(rowOf(chased.id)?.sla)} — measured from lastMessageAt this reads as 0 minutes waited`
  );
  check(
    "  ↳ a ticket already answered has no running clock at all, rather than 0",
    rowOf(answeredOnce.id)?.sla === null,
    JSON.stringify(rowOf(answeredOnce.id)?.sla)
  );

  const board = await desk("GET", "/desk/api/queue");
  const qRow = (board.json?.queue ?? []).find((r: any) => r.id === late.id);
  check(
    "the queue board says the same thing about the same ticket",
    qRow?.sla?.breached === rowOf(late.id)?.sla?.breached &&
      qRow?.sla?.targetMinutes === rowOf(late.id)?.sla?.targetMinutes,
    `board=${JSON.stringify(qRow?.sla)} inbox=${JSON.stringify(rowOf(late.id)?.sla)}`
  );

  // And the automation agrees, which is the whole point of the shared resolver.
  await runTicketAutomations();
  check(
    "  ↳ and the automation acts on exactly what both screens showed",
    (await reload(late.id))?.tier === 2 && (await reload(late.id))?.slaBreachedAt !== null,
    `tier=${(await reload(late.id))?.tier}`
  );
  check(
    "  ↳ including for the client who chased, which the old colour called fresh",
    (await reload(chased.id))?.tier === 2,
    `tier=${(await reload(chased.id))?.tier}`
  );
  check(
    "  ↳ and leaves the answered one alone",
    (await reload(answeredOnce.id))?.tier === 1,
    `tier=${(await reload(answeredOnce.id))?.tier}`
  );

  // Closed all week: the desk must not redden overnight while the target has not moved.
  await saveConfig({
    slaFirstResponseMins: { urgent: 15, high: 60, normal: 240, low: 480 },
    businessHours: { tz: "UTC", days: {} },
  });
  const overnightRow = await makeTicket({ priority: "urgent", queuedAt: min(600), lastMessageAt: min(600) });
  const closedInbox = await desk("GET", "/desk/api/inbox?status=escalated");
  const closedRow = (closedInbox.json?.conversations ?? []).find((r: any) => r.id === overnightRow.id);
  check(
    "a ten-hour wait entirely outside open hours is not shown as late",
    closedRow?.sla?.breached === false && closedRow?.sla?.elapsedMinutes === 0,
    `${JSON.stringify(closedRow?.sla)} — wall clock would paint this red every morning`
  );
  check(
    "  ↳ and the row says WHICH clock it is counting, so the number can be read",
    closedRow?.sla?.inOpenHours === true,
    JSON.stringify(closedRow?.sla)
  );
  await saveConfig({ slaFirstResponseMins: { urgent: 15, high: 60, normal: 240, low: 480 } });

  // ------------------------------------------- and the DESK actually colours from it
  console.log("\n== the desk's colour comes from that payload, not a threshold of its own ==");
  const lateSla = rowOf(late.id)?.sla;
  check(
    "the breached row is coloured bad by the desk's own rule",
    slaTone(lateSla) === " bad",
    `${slaTone(lateSla)} for ${JSON.stringify(lateSla)}`
  );
  check(
    "  ↳ the chased client's row is coloured from the wait, not from their message",
    slaTone(rowOf(chased.id)?.sla) === " bad",
    slaTone(rowOf(chased.id)?.sla)
  );
  check(
    "  ↳ a ticket with no running clock is left UNCOLOURED, not called fine",
    slaTone(null) === "" && slaTone(rowOf(answeredOnce.id)?.sla) === "",
    `null->"${slaTone(null)}" answered->"${slaTone(rowOf(answeredOnce.id)?.sla)}"`
  );
  check(
    "  ↳ it warns before the breach rather than only after",
    slaTone({ targetMinutes: 60, elapsedMinutes: 45, breached: false, usedFraction: WARN_AT, inOpenHours: true }) ===
      " warn" &&
      slaTone({ targetMinutes: 60, elapsedMinutes: 30, breached: false, usedFraction: 0.5, inOpenHours: true }) === "",
    "the 0.75 warning band"
  );
  check(
    "  ↳ the hover carries the real numbers and says it is past the target",
    /40 of 15/.test(slaTitle(lateSla) ?? "") && /past the target/.test(slaTitle(lateSla) ?? ""),
    slaTitle(lateSla)
  );
  /**
   * And it names WHICH clock, both ways. This agency has no hours set at this point in the
   * suite, so the live row above legitimately reads "minutes" — asserting "open minutes"
   * there was the check being wrong about the product, which is the failure mode a
   * hand-written expectation has and the code does not.
   */
  const base = { targetMinutes: 60, elapsedMinutes: 30, breached: false, usedFraction: 0.5 };
  check(
    "  ↳ and distinguishes open-hours minutes from wall clock, since they mean different things",
    /30 of 60 open minutes/.test(slaTitle({ ...base, inOpenHours: true }) ?? "") &&
      /30 of 60 minutes/.test(slaTitle({ ...base, inOpenHours: false }) ?? ""),
    `${slaTitle({ ...base, inOpenHours: true })} / ${slaTitle({ ...base, inOpenHours: false })}`
  );

  /**
   * The specific regression this whole section exists to prevent: a fixed threshold
   * creeping back into either list. Asserted against the SOURCE, because a component that
   * quietly re-derives lateness would still render and still look right.
   */
  const deskSources = ["Inbox.tsx", "QueueBoard.tsx"]
    .map((f) => readFileSync(new URL(`../apps/support-desk/src/${f}`, import.meta.url), "utf8"))
    .join("\n");
  check(
    "neither list hardcodes a wait threshold any more",
    !/4 \* 3600|>\s*240|mins\s*>\s*60/.test(deskSources),
    deskSources.split("\n").filter((l) => /4 \* 3600|>\s*240|mins\s*>\s*60/.test(l)).join(" | ")
  );
  check(
    "  ↳ and neither measures the wait from lastMessageAt",
    !/lastMessageAt.*getTime\(\)|getTime\(\).*lastMessageAt/.test(deskSources),
    "a client chasing us would reset their own row"
  );

  // ----------------------------------------------------------------------------- readiness
  console.log("\n== readiness can see that nothing is running the passes ==");
  // A day-old escalation with no target check recorded could not exist if a pass had run.
  const stale = await makeTicket({ queuedAt: days(2), lastMessageAt: days(2) });
  const withStale = await checkReadiness();
  const finding = withStale.findings.find((f) => f.id === "automations-never-run");
  check(
    "an unswept day-old ticket is named",
    !!finding,
    withStale.findings.map((f) => f.id).join(",")
  );
  check("  ↳ as a blocker, because a client is waiting on it", finding?.severity === "blocker", finding?.severity);
  check(
    "  ↳ describing what the reader is looking at, not just the missing setting",
    /desk looks the same|invisible|complain/i.test(`${finding?.why}`),
    finding?.why
  );
  await runTicketAutomations();
  const clean = await checkReadiness();
  check(
    "  ↳ and it stops being reported once a pass has actually run",
    !clean.findings.some((f) => f.id === "automations-never-run"),
    clean.findings.map((f) => f.id).join(",")
  );

  console.log("\n== a ticket nobody on duty can take ==");
  /**
   * EXECUTED, not read. The queue board drew a straight line between "what is waiting" and
   * "who is on" that does not exist: `queueWhere` filters `tier: { lte: maxTier }`, so a
   * tier-2 ticket on a desk of tier-1 agents is skipped by "Take next" AND by distribute,
   * while showing as an ordinary row.
   *
   * Found by rendering the board, not by reading it: the live desk had one 28 HOURS old at
   * the top of the queue, red, and pressing "Take next" handed over a ticket queued a day
   * later without a word. Readiness has an unstaffed-tier check, but that is a deploy log —
   * the agent staring at the board all day never sees it.
   */
  const onDuty1 = [{ tier: 1, available: true, held: 0, maxConcurrent: 3 }];
  const stuck = queueReach([{ tier: 2 }, { tier: 1 }], onDuty1);
  check(
    "a tier-2 ticket on a tier-1 desk is reported unreachable",
    stuck.unreachable === 1 && stuck.tierNeeded === 2 && stuck.topTierOnDuty === 1,
    JSON.stringify(stuck)
  );
  check(
    "  ↳ and named as a STAFFING gap, which does not clear on its own",
    stuck.unstaffed === true,
    JSON.stringify(stuck)
  );
  check(
    "  ↳ while an away tier-2 colleague is a different sentence — that one waits",
    queueReach([{ tier: 2 }], [
      { tier: 1, available: true, held: 0, maxConcurrent: 3 },
      { tier: 2, available: false, held: 0, maxConcurrent: 3 },
    ]).unstaffed === false,
    JSON.stringify(queueReach([{ tier: 2 }], [
      { tier: 1, available: true, held: 0, maxConcurrent: 3 },
      { tier: 2, available: false, held: 0, maxConcurrent: 3 },
    ]))
  );
  check(
    "  ↳ a desk that can reach everything raises nothing",
    queueReach([{ tier: 1 }, { tier: 2 }], [{ tier: 2, available: true, held: 0, maxConcurrent: 3 }]).unreachable === 0,
    "a tier-2 agent covers tier 1 and 2"
  );
  check(
    "  ↳ and with NOBODY on it stays quiet, because the zero-capacity alarm already says that",
    queueReach([{ tier: 3 }], [{ tier: 1, available: false, held: 0, maxConcurrent: 3 }]).unreachable === 0,
    "two alarms for one fact is one alarm people stop reading"
  );


  console.log(`\n${"-".repeat(52)}\n  ${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => {
    console.error("\nERROR:", e instanceof Error ? e.stack : e);
    fail++;
  })
  .finally(async () => {
    for (const id of made.conversationIds) {
      await prisma.message.deleteMany({ where: { conversationId: id } }).catch(() => {});
      await prisma.conversation.delete({ where: { id } }).catch(() => {});
    }
    await prisma.deskSession.deleteMany({ where: { deskUserId: { in: made.userIds } } }).catch(() => {});
    await prisma.deskUser.deleteMany({ where: { id: { in: made.userIds } } }).catch(() => {});
    if (made.locationId) {
      await prisma.locationInstall
        .update({ where: { id: made.locationId }, data: { supportEnabled: made.supportWas ?? false } })
        .catch(() => {});
    }
    if (made.configCreated) {
      await prisma.supportConfig.deleteMany({ where: { agencyInstallId: agency?.id } }).catch(() => {});
    }
    const left = await prisma.conversation.count().catch(() => -1);
    console.log(`\ncleanup: ${left} conversations remain`);
    await prisma.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  });
