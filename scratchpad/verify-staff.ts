/**
 * The desk's Staff screen — offboarding, tiers, and the concurrent limit.
 *
 * Written after rendering that screen for the first time (2026-08-19). It had never been
 * looked at in a browser, and two things were wrong in the same direction: the screen
 * reported a routing state the database did not hold, and it wrote one nobody chose.
 *
 *   A. An out-of-range limit is REFUSED and stayed on screen looking accepted.
 *      Measured: typing 99 over a limit of 3 got back `400 maxConcurrent must be 0–50`,
 *      and the cell still read 99 while the row held 3. The input is uncontrolled — for
 *      a real reason, a controlled one re-renders the table on every keystroke — so the
 *      component's own revert could never reach the DOM. And the page-level error banner
 *      sits ~390px ABOVE the first table row, so on a desk with more than a handful of
 *      accounts the refusal is off-screen and the only thing visible is the number the
 *      server declined. `maxConcurrent` is what decides "all agents are busy, you're
 *      3rd", who distribute levels onto, and whether a fourth ticket is refused.
 *
 *   B. CLEARING the box silently took a live agent out of rotation. `Number("")` is 0,
 *      and 0 is a REAL value here ("route this person nothing"), so the server could not
 *      tell an emptied box from somebody choosing it. Measured: select-all, tab away, and
 *      `maxConcurrent` went to 0 with no error and a blank cell — an available, active
 *      agent invisible to `claimNext`, skipped by distribute and counted as zero capacity
 *      in the client's wait estimate. That is the away-versus-disabled failure through a
 *      third door: a routing state nobody chose.
 *
 *   C. And the blast radius of Disable was unreadable before the click. The confirm said
 *      "any ticket they are holding goes back to the queue" — a hedge the reader cannot
 *      resolve, when the number is in our own database. Same principle as the dashboard's
 *      bulk disable naming how many sub-accounts are on another page.
 *
 * The load-bearing check here is C's second half: the count the screen SHOWS must be the
 * count the release DELIVERS. Two definitions of "held" would let the screen promise a
 * number the offboarding does not honour, which is the `QUEUE_ORDER` rule exactly.
 *
 *   npx tsx scratchpad/verify-staff.ts        (needs `npm run dev:server` on 3210)
 */
import "../apps/server/src/services/loadEnv";
import { randomBytes, scryptSync } from "node:crypto";
import { prisma } from "../apps/server/src/services/prisma";

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL is not local. This script writes and deletes rows.");
  process.exit(1);
}

const BASE = "http://localhost:3210";
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); if (detail !== undefined) console.log(`        ${String(detail).slice(0, 300)}`); }
}

function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 64, { N: 16384 }).toString("hex")}`;
}

const PW = "a perfectly fine passphrase";
const stamp = Date.now();
const madeUsers: string[] = [];
const madeConvs: string[] = [];

function jar() { return { cookie: "" }; }
async function desk(j: { cookie: string }, method: string, path: string, body?: unknown) {
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
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

async function login(j: { cookie: string }, email: string, password: string) {
  const r = await desk(j, "POST", "/desk/api/login", { email, password });
  // /desk/api/login is 10/min per IP. A 429 becomes a missing cookie and reads like a
  // broken session three checks later, so name it now rather than assert against it.
  if (r.status === 429) throw new Error("rate-limited on login — another desk suite ran in the last minute");
  return r;
}

const storedLimit = async (id: string) =>
  (await prisma.deskUser.findUnique({ where: { id }, select: { maxConcurrent: true } }))?.maxConcurrent;

async function main(): Promise<void> {
  const location = await prisma.locationInstall.findFirst({ where: { status: "active" } });
  if (!location) throw new Error("no active LocationInstall — this suite needs one to hang conversations off");

  const admin = await prisma.deskUser.create({
    data: { email: `staff-admin-${stamp}@mosaic.test`, name: "Ada Admin", passwordHash: hashPassword(PW), role: "mosaic_admin" },
  });
  const agent = await prisma.deskUser.create({
    data: {
      email: `staff-agent-${stamp}@mosaic.test`, name: "Bo Agent", passwordHash: hashPassword(PW),
      role: "mosaic_agent", maxConcurrent: 3, tier: 1,
    },
  });
  madeUsers.push(admin.id, agent.id);

  const jarA = jar();
  check("an admin signs in", (await login(jarA, admin.email, PW)).status === 200);

  console.log("\n== A. a refused limit must not be reported as stored ==");
  /**
   * Each rejection is asserted TWICE — the status, and the stored value straight from the
   * database. A 400 alone says the route refused it; only reading the row proves nothing
   * was written, which is the half the screen was getting wrong.
   */
  for (const [label, value] of [
    ["above the ceiling (99)", 99],
    ["negative", -1],
    ["fractional", 3.5],
    ["not a number at all", "abc"],
  ] as const) {
    const r = await desk(jarA, "PATCH", `/desk/api/users/${agent.id}/routing`, { maxConcurrent: value });
    check(`${label} is refused`, r.status === 400, `${r.status} ${JSON.stringify(r.json)}`);
    check(`  ↳ and the stored limit is untouched`, (await storedLimit(agent.id)) === 3, await storedLimit(agent.id));
  }

  console.log("\n== B. a BLANK is not a zero ==");
  /**
   * The client is now the first line — it never sends an emptied box. This is the second
   * line, and it is the one that matters if a stale build, another client or a curl ever
   * does: `Number("")` is 0 and 0 is legitimate, so without an explicit check the route
   * cannot distinguish them and writes the silent version.
   */
  for (const [label, value] of [
    ["an empty string", ""],
    ["whitespace", "   "],
    ["null", null],
  ] as const) {
    const r = await desk(jarA, "PATCH", `/desk/api/users/${agent.id}/routing`, { maxConcurrent: value });
    check(`${label} is refused rather than read as 0`, r.status === 400, `${r.status} ${JSON.stringify(r.json)}`);
    check(`  ↳ and the agent is still in rotation`, (await storedLimit(agent.id)) === 3, await storedLimit(agent.id));
  }

  console.log("\n== …while a DELIBERATE zero still works ==");
  /**
   * The point is not to forbid 0 — it is documented as the way to take somebody out of
   * rotation without marking them away, and forbidding it would break that. The point is
   * that it has to be typed.
   */
  const zero = await desk(jarA, "PATCH", `/desk/api/users/${agent.id}/routing`, { maxConcurrent: 0 });
  check("a typed 0 is accepted", zero.status === 200, `${zero.status} ${JSON.stringify(zero.json)}`);
  check("  ↳ and stored", (await storedLimit(agent.id)) === 0);
  const back = await desk(jarA, "PATCH", `/desk/api/users/${agent.id}/routing`, { maxConcurrent: "3" });
  check("a numeric STRING is still accepted — the form sends one", back.status === 200, `${back.status} ${JSON.stringify(back.json)}`);
  check("  ↳ and stored as a number", (await storedLimit(agent.id)) === 3);

  console.log("\n== …and the same rule holds for tier ==");
  const t0 = await desk(jarA, "PATCH", `/desk/api/users/${agent.id}/routing`, { tier: "" });
  check("a blank tier is refused, not read as 0", t0.status === 400, `${t0.status} ${JSON.stringify(t0.json)}`);
  const t2 = await desk(jarA, "PATCH", `/desk/api/users/${agent.id}/routing`, { tier: 2 });
  check("  ↳ a real tier still saves", t2.status === 200 && t2.json?.tier === 2, JSON.stringify(t2.json));

  console.log("\n== C. the blast radius is readable BEFORE the click ==");
  /**
   * Three held tickets and two that must not count: one resolved and one abandoned. If
   * the count leaked finished conversations, the screen would frighten an admin out of an
   * offboarding that costs nothing — and if it undercounted, it would promise a smaller
   * disruption than the release delivers.
   */
  for (const status of ["open", "escalated", "escalated", "resolved", "abandoned"] as const) {
    const c = await prisma.conversation.create({
      data: {
        agencyInstallId: location.agencyInstallId,
        locationInstallId: location.id,
        status,
        assignedToId: agent.id,
        subject: `staff-suite ${stamp} ${status}`,
      },
    });
    madeConvs.push(c.id);
  }

  const list = await desk(jarA, "GET", "/desk/api/users");
  const row = (list.json as any[])?.find((u) => u.id === agent.id);
  check("the staff list carries a held-ticket count at all", typeof row?.heldTickets === "number", JSON.stringify(row));
  check(
    "  ↳ it counts the live ones and NOT the finished ones",
    row?.heldTickets === 3,
    `heldTickets=${row?.heldTickets} — 3 live (open + 2 escalated), 1 resolved and 1 abandoned must not count`
  );
  const untouched = (list.json as any[])?.find((u) => u.id === admin.id);
  check("  ↳ somebody holding nothing reports 0, not undefined", untouched?.heldTickets === 0, JSON.stringify(untouched?.heldTickets));

  console.log("\n== …and that number is the number the offboarding delivers ==");
  /**
   * THE load-bearing check. The screen shows a count from `heldCountsFor` and the release
   * acts through `releaseTicketsFrom`; both read `HELD_STATUSES`. If they ever stop
   * sharing it, the confirm dialog promises a disruption the disable does not honour —
   * and nobody can see both at once to notice, which is the `QUEUE_ORDER` rule exactly.
   */
  const promised = row?.heldTickets;
  const disabled = await desk(jarA, "POST", `/desk/api/users/${agent.id}/disable`);
  check("disabling succeeds", disabled.status === 200, `${disabled.status} ${JSON.stringify(disabled.json)}`);
  check(
    "  ↳ and returns EXACTLY the number the staff screen promised",
    disabled.json?.releasedTickets === promised,
    `screen said ${promised}, release did ${disabled.json?.releasedTickets}`
  );

  const stillHeld = await prisma.conversation.count({
    where: { assignedToId: agent.id, status: { in: ["open", "escalated"] } },
  });
  check("  ↳ no live ticket is left parked on the disabled account", stillHeld === 0, `${stillHeld} still assigned`);
  const finishedStill = await prisma.conversation.count({
    where: { id: { in: madeConvs }, assignedToId: agent.id },
  });
  check(
    "  ↳ the finished ones stay attributed to them — history is not rewritten",
    finishedStill === 2,
    `${finishedStill} of the 2 settled conversations still name them`
  );

  const after = await desk(jarA, "GET", "/desk/api/users");
  const afterRow = (after.json as any[])?.find((u) => u.id === agent.id);
  check("  ↳ and the screen now reads 0 held", afterRow?.heldTickets === 0, JSON.stringify(afterRow?.heldTickets));

  console.log(`\n${"-".repeat(60)}\n  ${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => { console.error("\nERROR:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    await prisma.message.deleteMany({ where: { conversationId: { in: madeConvs } } }).catch(() => {});
    await prisma.conversation.deleteMany({ where: { id: { in: madeConvs } } }).catch(() => {});
    await prisma.deskSession.deleteMany({ where: { deskUserId: { in: madeUsers } } }).catch(() => {});
    await prisma.deskUser.deleteMany({ where: { id: { in: madeUsers } } }).catch(() => {});
    await prisma.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  });
