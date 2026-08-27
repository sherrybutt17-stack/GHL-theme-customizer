/**
 * The tier-3 hand-off email — the ONE place a whole transcript leaves Mosaic for the
 * AGENCY — measured against the rows the product actually writes.
 *
 * `Conversation`/`Message` holds the client's conversation and Mosaic's own workflow in
 * one table. The client's chat window has filtered `system` since the day it was built,
 * with the reason written down: "Internal notes, transfers and hand-offs live in the SAME
 * Message table as the transcript and carry Mosaic staff names … One missing filter puts
 * our workflow in a customer's chat."
 *
 * The email had no filter at all, and `renderTranscript` labelled those rows "Note:",
 * which reads as something we wrote for the agency deliberately.
 *
 * The fixtures are NOT hand-written strings. Every `system` row here is produced by
 * driving the real desk routes — raise, reply, escalate, transfer, disable — and every
 * assertion is derived from what those routes STORED. A harness that hard-codes the
 * bodies is a hand-kept copy of a contract, and it drifts the first time somebody
 * rewords a transfer note.
 *
 * Throwaway agency and throwaway desk accounts, deleted at the end. One desk login: that
 * route is 10/min per IP and a 429 reads like a routing bug three checks later.
 *
 * Every fixture carries a per-run stamp and nothing is ever looked up by its human-readable
 * name, so leftovers from an interrupted run (a datastore that dies during teardown, which
 * happened here) are inert rather than something the next run matches and reports on — the
 * trap `verify-kb-states` records after clicking retry on a stale row's feed.
 *
 *   npx tsx scratchpad/verify-handoff-email.ts
 */
import "../apps/server/src/services/loadEnv";
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync, createHash } from "node:crypto";
import { notifyAgencyOfHandoff } from "../apps/server/src/services/email";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3210";
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL is not local. This writes and deletes rows.");
  process.exit(1);
}
const p = new PrismaClient();

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail !== undefined) console.log(`        ${String(detail).slice(0, 400)}`); }
}

const stamp = Date.now();
const made = { agencyId: "", userIds: [] as string[] };
async function teardown(): Promise<void> {
  if (made.agencyId) {
    await p.message.deleteMany({ where: { conversation: { agencyInstallId: made.agencyId } } });
    await p.conversation.deleteMany({ where: { agencyInstallId: made.agencyId } });
    await p.supportConfig.deleteMany({ where: { agencyInstallId: made.agencyId } });
    await p.themeConfig.deleteMany({ where: { locationInstall: { agencyInstallId: made.agencyId } } });
    await p.locationInstall.deleteMany({ where: { agencyInstallId: made.agencyId } });
    await p.agencyInstall.deleteMany({ where: { id: made.agencyId } });
  }
  if (made.userIds.length) {
    await p.deskSession.deleteMany({ where: { deskUserId: { in: made.userIds } } });
    await p.deskUser.deleteMany({ where: { id: { in: made.userIds } } });
  }
  console.log(`\ncleanup: throwaway agency and ${made.userIds.length} desk accounts removed`);
  made.agencyId = ""; made.userIds = [];
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig as any, () => { teardown().finally(() => process.exit(130)); });
}

const PASSWORD = "correct horse battery staple";
function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 64, { N: 16384 }).toString("hex")}`;
}

const jar = { cookie: "" };
async function desk(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
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
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function main(): Promise<void> {
  // --- fixtures: an agency that can be handed to, and two Mosaic staff -----------------
  const agency = await p.agencyInstall.create({
    data: {
      ghlCompanyId: "handoff-" + stamp,
      accessTokenEnc: "x", refreshTokenEnc: "x", tokenExpiresAt: new Date(Date.now() + 86400000),
      companyName: "Handoff Probe Agency",
    },
  });
  made.agencyId = agency.id;
  const loc = await p.locationInstall.create({
    data: {
      agencyInstallId: agency.id,
      ghlLocationId: "handoff-loc-" + stamp,
      status: "active", enabled: true, supportEnabled: true, locationName: "190 Ranch",
    },
  });
  await p.themeConfig.create({
    data: { locationInstallId: loc.id, version: 1, brandName: "Harbour Suite" },
  });
  await p.supportConfig.create({
    data: { agencyInstallId: agency.id, enabled: true, escalationEmails: ["owner@theagency.test"] },
  });

  const ada = await p.deskUser.create({
    data: {
      email: `handoff-ada-${stamp}@mosaic.test`, name: "Ada Lovelace",
      passwordHash: hashPassword(PASSWORD), role: "mosaic_admin", tier: 3, maxConcurrent: 5,
    },
  });
  const bo = await p.deskUser.create({
    data: {
      email: `handoff-bo-${stamp}@mosaic.test`, name: "Bo Diaz",
      passwordHash: hashPassword(PASSWORD), role: "mosaic_agent", tier: 3, maxConcurrent: 5,
    },
  });
  made.userIds.push(ada.id, bo.id);

  const login = await desk("POST", "/desk/api/login", { email: ada.email, password: PASSWORD });
  if (login.status !== 200 || !jar.cookie) {
    throw new Error(`login failed ${login.status} ${JSON.stringify(login.json)} — /desk/api/login is 10/min per IP; space desk suites out`);
  }

  // --- drive the desk so the REAL routes write the system rows -------------------------
  console.log("\n== the rows the product writes ==");
  const CLIENT_QUESTION = "My contact import keeps failing halfway through the file.";
  const AGENT_REPLY = "Sorry for the wait. Splitting the file into batches of 500 rows will get it through.";
  const PRIVATE_NOTE = "client is on the legacy billing plan, check before promising anything";

  const raised = await desk("POST", "/desk/api/conversations", {
    ghlLocationId: loc.ghlLocationId,
    subject: "Contact import fails",
    body: CLIENT_QUESTION,
    channel: "email",
    priority: "high",
  });
  check("a desk-raised ticket was created", raised.status === 201 && !!raised.json?.id, `${raised.status} ${JSON.stringify(raised.json)}`);
  const convId: string = raised.json.id;

  const assigned = await desk("POST", `/desk/api/conversations/${convId}/assign`, { assigneeId: ada.id });
  check("assigned to Ada", assigned.status === 200, assigned.status);

    // The route reads `text`, not `body`. Sending the wrong key stores nothing and 400s —
  // and the agent row then simply never exists, so the "it still arrives" control below
  // would pass having checked only the client's own message. Hence the role assertion.
  const replied = await desk("POST", `/desk/api/conversations/${convId}/reply`, { text: AGENT_REPLY });
  check("an agent reply passed the gates and stored", replied.status === 201, `${replied.status} ${JSON.stringify(replied.json)}`);

  const escalated = await desk("POST", `/desk/api/conversations/${convId}/escalate`, { tier: 2 });
  check("escalated to tier 2", escalated.status === 200, `${escalated.status} ${JSON.stringify(escalated.json)}`);

  const transferred = await desk("POST", `/desk/api/conversations/${convId}/transfer`, {
    deskUserId: bo.id,
    note: PRIVATE_NOTE,
  });
  check("transferred to Bo, with a note one agent wrote for another", transferred.status === 200, `${transferred.status} ${JSON.stringify(transferred.json)}`);

  const disabled = await desk("POST", `/desk/api/users/${bo.id}/disable`, {});
  check("Bo's account disabled, releasing what he held", disabled.status === 200, `${disabled.status} ${JSON.stringify(disabled.json)}`);

  // --- what is actually stored ---------------------------------------------------------
  const stored = await p.message.findMany({
    where: { conversationId: convId },
    orderBy: { createdAt: "asc" },
    select: { role: true, body: true },
  });
  const systemRows = stored.filter((m) => m.role === "system");
  const externalRows = stored.filter((m) => m.role !== "system");
  console.log(`\n  stored: ${stored.length} messages — ${systemRows.length} system, ${externalRows.length} client-visible`);
  for (const m of systemRows) console.log(`    system | ${m.body}`);

  // A positive control. Every assertion below is about the system rows, so a run that
  // produced none would report a clean email having tested nothing at all.
  check(
    "the desk really wrote internal rows to filter (positive control)",
    systemRows.length >= 4,
    `only ${systemRows.length} — the assertions below would be vacuous`
  );
  check("…and they name Mosaic staff", systemRows.some((m) => m.body.includes("Bo Diaz")), JSON.stringify(systemRows.map((m) => m.body)));
  check("…and one carries an agent's private note", systemRows.some((m) => m.body.includes(PRIVATE_NOTE)));

  // --- the email the agency would actually receive --------------------------------------
  // The SHIPPED function, executed against a stub `fetch`, so this reads the bytes bound
  // for Resend rather than a paraphrase of them.
  console.log("\n== the email the agency receives ==");
  const realFetch = globalThis.fetch;
  const savedKey = process.env.RESEND_API_KEY;
  let posted: any = null;
  process.env.RESEND_API_KEY = "re_probe_key";
  globalThis.fetch = (async (_url: any, init: any) => {
    posted = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ id: "re_probe" }), { status: 200 });
  }) as typeof globalThis.fetch;
  let result: any;
  try {
    result = await notifyAgencyOfHandoff({
      to: ["owner@theagency.test"],
      brandName: "Harbour Suite",
      locationName: loc.locationName,
      note: "This is about their plan limit, which is your call and not ours.",
      agentName: ada.name,
      // Exactly what the route hands over: the whole table.
      messages: stored.map((m) => ({ role: m.role, body: m.body })),
    });
  } finally {
    globalThis.fetch = realFetch;
    if (savedKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedKey;
  }
  check("the mail was built and posted", result?.sent === true && !!posted, JSON.stringify(result));
  const text = String(posted?.text ?? "");

  for (const row of systemRows) {
    check(`no internal row reaches the agency: ${row.body.slice(0, 52)}…`, !text.includes(row.body), text.slice(-600));
  }
  check("no Mosaic staff member is named in the transcript", !text.includes("Bo Diaz"), text.slice(-600));
  check("…nor is our own missed response target reported to them", !/still unanswered|account was disabled/i.test(text), text.slice(-600));
  check("…nor our internal tier numbers", !/tier \d/i.test(text), text.slice(-600));
  check("…nor the label that made them read as deliberate", !text.includes("Note: ["), text.slice(-600));

  // The control every guard here carries: a filter that empties the email is not a fix.
  // Assert the ROLES first: with the agent reply missing, the loop below would run over
  // the client's message alone and report a clean pass on half the property.
  check(
    "both outward roles are present to check (positive control)",
    externalRows.some((m) => m.role === "user") && externalRows.some((m) => m.role === "agent"),
    JSON.stringify(externalRows.map((m) => m.role))
  );
  for (const row of externalRows) {
    check(`the conversation still arrives: ${row.role} — ${row.body.slice(0, 44)}…`, text.includes(row.body), text.slice(-600));
  }
  check("the agency is told who passed it over", text.includes("Ada Lovelace"));
  check("…and the note our team wrote for THEM is delivered", text.includes("your call and not ours"));
  check("…and the subject names the sub-account", String(posted?.subject ?? "").includes("190 Ranch"));

  // --- and the route itself still reaches this code -------------------------------------
  console.log("\n== the live hand-off route ==");
  const handed = await desk("POST", `/desk/api/conversations/${convId}/hand-to-agency`, {
    note: "Their plan caps imports; that is yours to answer.",
  });
  check("hand-to-agency accepted", handed.status === 200, `${handed.status} ${JSON.stringify(handed.json)}`);
  check("…and addressed the agency's escalation email", JSON.stringify(handed.json?.recipients) === JSON.stringify(["owner@theagency.test"]), JSON.stringify(handed.json?.recipients));
  check(
    "…and an unconfigured mail provider is a SKIP, not a failed hand-off",
    handed.json?.emailed === false && handed.json?.emailSkipped === "not-configured",
    JSON.stringify(handed.json)
  );
  const marked = await p.conversation.findUnique({ where: { id: convId }, select: { handedToAgencyAt: true } });
  check("…and the hand-off is recorded whatever the mail did", !!marked?.handedToAgencyAt);
}

main()
  .catch((e) => { console.error("\nFATAL", e); fail++; })
  .finally(async () => {
    await teardown().catch((e) => console.error("teardown failed", e));
    await p.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
