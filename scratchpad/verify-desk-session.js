/**
 * What happens to a support agent when their session stops being accepted.
 *
 * Two halves, and neither had been checked.
 *
 * SERVER: revocation is the entire reason desk sessions are DB-backed rather than
 * stateless — "a support agent who leaves must lose access immediately". Disabling a user
 * is supposed to kill their live sessions in the same call. That claim had no test.
 *
 * CLIENT: `ApiError` carried a status "so callers can branch on 401 vs a real failure",
 * and not one caller did. `user` was read once at mount and never re-checked, so an
 * expired or revoked session left an agent looking at a fully rendered desk with their own
 * name in the top bar while every action failed silently. Revocation is designed to land
 * mid-shift, so this is the normal way to meet it.
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const fs = require("fs");
const path = require("path");
const { scryptSync, randomBytes } = require("crypto");
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);

const BASE = process.env.VERIFY_BASE ?? "http://localhost:3210";
const DB = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) {
  console.error("REFUSING: this suite creates and disables DeskUser rows. DATABASE_URL must be localhost.");
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

const TAG = `ds${Date.now().toString(36)}`;
const PASSWORD = "correct-horse-battery-staple-9f2";
// Same format as services/deskAuth.ts: "<saltHex>:<hashHex>".
const hashPassword = (pw) => {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 64).toString("hex")}`;
};

const desk = (path, init = {}, cookie = null) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-mosaic-desk": "1",
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  });

(async () => {
  const emails = [`${TAG}-agent@mosaic.test`, `${TAG}-admin@mosaic.test`];
  try {
    const agent = await p.deskUser.create({
      data: { email: emails[0], name: "Session Agent", passwordHash: hashPassword(PASSWORD), role: "mosaic_agent", status: "active" },
    });
    const admin = await p.deskUser.create({
      data: { email: emails[1], name: "Session Admin", passwordHash: hashPassword(PASSWORD), role: "mosaic_admin", status: "active" },
    });

/*
 * A 429 here is the 10/min bucket on `/desk/api/login`, not a product failure — and it is
 * the single most misleading thing this suite can print. Unhardened, the login `check`
 * failed and every assertion after it failed too, as `401 Not signed in`: "the session
 * cookie is HttpOnly" and "an admin can disable them" both read as a security regression.
 *
 * `verify-session` and `verify-offboard` already throw with the real reason. The rule is
 * the plan-failures one: when the failure mode is known, make the occurrence
 * self-documenting rather than leaving the next person to rediscover it. Space desk suites
 * about a minute apart.
 */
    const signIn = async (email) => {
      const r = await desk("/desk/api/login", { method: "POST", body: JSON.stringify({ email, password: PASSWORD }) });
      if (r.status === 429) {
        throw new Error(
          "rate-limited by /desk/api/login (10/min per IP), not a product failure. " +
            "Another desk suite ran in the same minute — wait one and re-run."
        );
      }
      const setCookie = r.headers.get("set-cookie") ?? "";
      return { status: r.status, cookie: setCookie.split(";")[0], raw: setCookie };
    };

    console.log("\n== a signed-in agent works ==");
    const a = await signIn(emails[0]);
    check("login succeeds", a.status === 200, a.status);
    // httpOnly is half the point of using a cookie here at all: an XSS on the desk must
    // not be able to read the session. Asserted against the real header, because a check
    // that cannot fail is worse than no check.
    check("  -> the session cookie is HttpOnly, so an XSS cannot read it", /httponly/i.test(a.raw), a.raw.replace(/=[^;]+/, "=<redacted>"));
    check("  -> and SameSite is set, since desk and API are different origins", /samesite=/i.test(a.raw), a.raw.replace(/=[^;]+/, "=<redacted>"));
    const meOk = await desk("/desk/api/me", {}, a.cookie);
    check("/me accepts the cookie", meOk.status === 200, meOk.status);

    console.log("\n== signing out revokes that session server-side ==");
    const b = await signIn(emails[0]);
    await desk("/desk/api/logout", { method: "POST" }, b.cookie);
    const afterLogout = await desk("/desk/api/me", {}, b.cookie);
    check("the old cookie is refused after logout", afterLogout.status === 401, afterLogout.status);

    console.log("\n== DISABLING a user kills their LIVE session, mid-shift ==");
    // The reason these sessions are DB-backed instead of stateless. A stateless token
    // would stay valid until it expired, so somebody who left the company would keep
    // reading customers' support conversations for the rest of the day.
    const c = await signIn(emails[0]);
    check("the agent is signed in again", (await desk("/desk/api/me", {}, c.cookie)).status === 200);

    const adminSession = await signIn(emails[1]);
    const disable = await desk(`/desk/api/users/${agent.id}/disable`, { method: "POST" }, adminSession.cookie);
    check("an admin can disable them", disable.status === 200, `${disable.status} ${await disable.text().catch(() => "")}`);

    const afterDisable = await desk("/desk/api/me", {}, c.cookie);
    check("their live session is refused IMMEDIATELY, not at expiry", afterDisable.status === 401, afterDisable.status);
    const inbox = await desk("/desk/api/inbox", {}, c.cookie);
    check("  -> and so is the inbox, so no transcript is readable", inbox.status === 401, inbox.status);
    check(
      "  -> no session row survives for them",
      (await p.deskSession.count({ where: { deskUserId: agent.id, revokedAt: null } })) === 0
    );

    console.log("\n== re-enabling does NOT resurrect the old cookie ==");
    await desk(`/desk/api/users/${agent.id}/enable`, { method: "POST" }, adminSession.cookie);
    const resurrect = await desk("/desk/api/me", {}, c.cookie);
    check("the revoked cookie stays dead", resurrect.status === 401, resurrect.status);
    check("  -> they must sign in again", (await signIn(emails[0])).status === 200);

    console.log("\n== and the desk UI now notices ==");
    const distDir = `${ROOT}/apps/support-desk/dist/assets`;
    const bundle = fs
      .readdirSync(distDir)
      .filter((f) => f.endsWith(".js"))
      .map((f) => fs.readFileSync(path.join(distDir, f), "utf8"))
      .join("");
    check("a 401 from ANY endpoint reaches one central handler", /Your session ended/.test(bundle));
    check(
      "  -> and it promises the half-typed reply survives",
      /anything you were typing is still here/i.test(bundle)
    );
    const css = fs
      .readdirSync(distDir)
      .filter((f) => f.endsWith(".css"))
      .map((f) => fs.readFileSync(path.join(distDir, f), "utf8"))
      .join("");
    // An overlay rather than a swap to <Login> is what keeps Ticket mounted, which is
    // what makes that promise true rather than a nice sentence.
    check("  -> because it re-authenticates OVER the desk, not instead of it", /\.session-overlay/.test(css));

    // NOT CHECKED HERE: drafts surviving a ticket switch. There is no observable trace of
    // it in a minified bundle — `new Map` appears five times and matches nothing in
    // particular — and a regex tuned until it passes proves only that it was tuned.
    // That behaviour needs the browser pass; asserting it here would be decoration.

    console.log("\n== a FAILED gate check does not read as a clean one ==");
    // The live check is what teaches at typing time. Swallowing its error to an empty
    // findings list made "couldn't check" look identical to "checked, nothing wrong":
    // no warning, send enabled, and an agent reasonably concluding the reply was fine.
    check("the UI distinguishes unchecked from cleared", /hasn't been cleared, only unchecked/.test(bundle));
    check(
      "  -> and says why that is still safe, which verify-desk proves (422 on /reply)",
      /checked again on send/.test(bundle)
    );
  } finally {
    const users = await p.deskUser.findMany({ where: { email: { in: emails } }, select: { id: true } });
    await p.deskSession.deleteMany({ where: { deskUserId: { in: users.map((u) => u.id) } } });
    await p.deskUser.deleteMany({ where: { email: { in: emails } } });
  }

  console.log(`\n${"-".repeat(50)}\n  ${pass} passed, ${fail} failed`);
  await p.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error(e.stack);
  await p.$disconnect();
  process.exit(1);
});
