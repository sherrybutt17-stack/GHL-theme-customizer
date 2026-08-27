/**
 * An agent changing their own password — the flow `create-desk-user` tells operators to
 * use, which until now no screen called.
 *
 * The route and the client function had both existed since the desk was built: verify the
 * current password, enforce a floor, rotate, revoke every session, mint a fresh one for
 * this browser. All correct, and `changePassword` had ZERO callers anywhere in the app —
 * the same shape as the canned replies that were stored, rendered and gated with nothing
 * feeding them. It reads as finished from every angle except trying to use it.
 *
 * Why it is worth a suite rather than a click: accounts are created by hand and the
 * password is read out over chat or email (deliberately — there is no signup), so until
 * the person can rotate it, the credential to an account that reads EVERY agency's support
 * conversations stays known to whoever set it up. And the revocation half is the kind of
 * claim that is only ever true until somebody changes the route: "signs out your other
 * browsers, keeps this one" is two opposite behaviours from one call.
 *
 *   npx tsx scratchpad/verify-desk-password.ts       (needs `npm run dev:server` on 3210)
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

const OLD = "correct horse battery staple";
const NEW = "a much better passphrase 42";
const stamp = Date.now();
const made: string[] = [];

/** Each jar is one browser. Two of them is the entire point of this suite. */
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
  // /desk/api/login is 10/min per IP. A 429 here becomes a missing cookie and reads like a
  // broken session three checks later, so name it now.
  if (r.status === 429) throw new Error("rate-limited on login — another desk suite ran in the last minute");
  return r;
}

async function main(): Promise<void> {
  const email = `pwtest-${stamp}@mosaic.test`;
  const user = await prisma.deskUser.create({
    data: { email, name: "Pat", passwordHash: hashPassword(OLD), role: "mosaic_agent" },
  });
  made.push(user.id);

  // Two browsers signed in as the same agent: a laptop and, say, a phone.
  const laptop = jar();
  const phone = jar();
  check("signs in on one browser", (await login(laptop, email, OLD)).status === 200);
  check("  ↳ and on a second", (await login(phone, email, OLD)).status === 200);
  check("both sessions work", (await desk(phone, "GET", "/desk/api/me")).status === 200);

  console.log("\n== the guards ==");
  const short = await desk(laptop, "POST", "/desk/api/password", { currentPassword: OLD, newPassword: "short" });
  check("a password under the floor is refused", short.status === 400, `${short.status} ${JSON.stringify(short.json)}`);
  const wrong = await desk(laptop, "POST", "/desk/api/password", {
    currentPassword: "not my password",
    newPassword: NEW,
  });
  check("  ↳ and so is a wrong current password", wrong.status === 401, `${wrong.status} ${JSON.stringify(wrong.json)}`);
  /**
   * That 401 is why the dialog suspends the desk's central unauthorized handler. Any 401
   * normally means "your session died" and raises the re-login overlay — over the top of
   * the form, for the ordinary mistake of mistyping your own password. Proven here to be
   * a 401 on a session that is still perfectly alive.
   */
  check(
    "  ↳ which is a 401 on a session that is still VALID — hence the suppression in App.tsx",
    (await desk(laptop, "GET", "/desk/api/me")).status === 200
  );

  console.log("\n== the change ==");
  const changed = await desk(laptop, "POST", "/desk/api/password", { currentPassword: OLD, newPassword: NEW });
  check("the password changes", changed.status === 200, `${changed.status} ${JSON.stringify(changed.json)}`);
  check(
    "  ↳ this browser stays signed in, so a half-typed reply survives",
    (await desk(laptop, "GET", "/desk/api/me")).status === 200
  );
  check(
    "  ↳ the OTHER browser is signed out immediately",
    (await desk(phone, "GET", "/desk/api/me")).status === 401,
    "rotating a credential you think is known must drop the sessions holding it"
  );

  console.log("\n== and the old password is genuinely gone ==");
  const stale = jar();
  check("the old password no longer signs in", (await login(stale, email, OLD)).status === 401);
  const fresh = jar();
  check("  ↳ the new one does", (await login(fresh, email, NEW)).status === 200);

  const rows = await prisma.deskSession.findMany({ where: { deskUserId: user.id, revokedAt: null } });
  check(
    "no revoked session is left usable in the table",
    rows.length === 2,
    `${rows.length} live sessions — expected the kept browser plus the new sign-in`
  );
  const after = await prisma.deskUser.findUnique({ where: { id: user.id } });
  check(
    "the stored hash changed and is not the password",
    after?.passwordHash !== undefined && !after!.passwordHash.includes(NEW),
    "a stored hash containing the password would be the worst possible outcome"
  );

  console.log("\n== and guessing the current password is rate-limited ==");
  /**
   * It shares no bucket with login, deliberately: a busy office behind one NAT must not
   * spend its sign-ins on somebody rotating a password. Burn this endpoint's allowance and
   * a sign-in must still work.
   */
  const guesser = jar();
  check("a fresh browser signs in", (await login(guesser, email, NEW)).status === 200);
  let limited = false;
  for (let i = 0; i < 14; i++) {
    const r = await desk(guesser, "POST", "/desk/api/password", {
      currentPassword: `guess-${i}`,
      newPassword: "another passphrase here",
    });
    if (r.status === 429) { limited = true; break; }
  }
  check("repeated wrong-password attempts start being refused", limited, "600/min is not a guessing limit");
  const stillIn = jar();
  check(
    "  ↳ and that budget is separate from sign-in, so the desk still works",
    (await login(stillIn, email, NEW)).status === 200
  );

  console.log(`\n${"-".repeat(50)}\n  ${pass} passed, ${fail} failed`);
}

main()
  .catch((e) => { console.error("\nERROR:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    await prisma.deskSession.deleteMany({ where: { deskUserId: { in: made } } }).catch(() => {});
    await prisma.deskUser.deleteMany({ where: { id: { in: made } } }).catch(() => {});
    await prisma.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  });
