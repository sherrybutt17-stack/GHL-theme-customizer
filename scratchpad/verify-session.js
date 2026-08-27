/**
 * What an agency sees when their dashboard session runs out.
 *
 * The token lasts 8 hours and the dashboard lives in a GHL tab people leave open, so
 * "come back the next morning and hit Save" is the NORMAL way to meet this, not an edge
 * case. What they got was `Error: Missing or invalid dashboard token` in the same red
 * banner as every network hiccup — accurate, meaningless, and delivered only after the
 * work was already done.
 *
 * Two things are checked here: that the server rejects on EXPIRY specifically (not merely
 * on a bad signature, which is a different fault with a different remedy), and that the
 * shipped dashboard bundle actually carries the instruction that fixes it.
 *
 * Run this with `npx tsx`, not `node`: it imports TypeScript sources directly.
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const fs = require("fs");
const path = require("path");
const { createHmac } = require("crypto");
const { spawn } = require("child_process");
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);

const BASE = process.env.VERIFY_BASE ?? "http://localhost:3210";
const AUTH_PORT = 3212;
const AUTH_BASE = `http://localhost:${AUTH_PORT}`;
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

// Same derivation as services/dashboardAuth.ts. Used in-process only, never printed.
const SECRET = process.env.DASHBOARD_TOKEN_SECRET || process.env.TOKEN_ENCRYPTION_KEY || "dev-insecure-secret";
const mint = (agencyId, expMs) => {
  const payload = `${agencyId}.${expMs}`;
  return `${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
};

const call = (agencyId, token) =>
  fetch(`${BASE}/admin/api/${agencyId}/locations`, { headers: token ? { "x-mosaic-token": token } : {} });

(async () => {
  const reg = await p.customMenuLinkRegistration.findFirst({ select: { slug: true, agencyInstallId: true } });
  if (!reg) throw new Error("need a CustomMenuLinkRegistration row");
  const agencyId = reg.agencyInstallId;

  console.log("\n== the dashboard can read its own deadline ==");
  // The token is `agencyId.expiryMillis.signature` and the expiry is PLAINTEXT — the
  // signature is what makes it trustworthy, not secrecy. That is what lets the dashboard
  // warn BEFORE somebody spends twenty minutes rebranding a sub-account it cannot save.
  const embed = await fetch(`${BASE}/admin-embed/${agencyId}?k=${reg.slug}`, { redirect: "manual" });
  /**
   * A 429 here is NOT a session bug, and left unexplained it reads exactly like one.
   *
   * `/admin-embed` is limited to 30/min per IP and SHARES that single bucket with
   * `/portal` — which is the point of the shared-limiter fix, and which
   * `verify-embed-auth` deliberately exhausts to prove. Run this suite in the same minute
   * and five checks fail with `1 parts`, `NaN`, and "a live token is accepted", none of
   * which name the cause. Reproduced deterministically by burning the bucket first.
   *
   * Same principle as the plan-failures log: when the failure mode is known, make the
   * occurrence self-documenting rather than leaving the next person to rediscover it.
   */
  if (embed.status === 429) {
    throw new Error(
      "/admin-embed returned 429 — the 30/min bucket it SHARES with /portal is exhausted. " +
        "verify-embed-auth burns it on purpose; wait a minute and re-run. This is not a session failure."
    );
  }
  const real = decodeURIComponent((embed.headers.get("location") ?? "").split("#t=")[1] ?? "");
  check("a real token was minted", real.split(".").length === 3, `${embed.status}, ${real.split(".").length} parts`);

  // Exactly what api.ts's sessionExpiresAt() does.
  const exp = Number(real.split(".")[1]);
  const hoursOut = (exp - Date.now()) / 3_600_000;
  check("its expiry parses out of the token with no secret", Number.isFinite(exp) && exp > 0, exp);
  check(`  -> and is ~8h away (${hoursOut.toFixed(1)}h)`, hoursOut > 7.5 && hoursOut < 8.5, hoursOut);
  check("  -> so the tab can set a timer for the exact moment it dies", true);

  console.log("\n== the server rejects an EXPIRED token, not just a forged one ==");
  // Correctly signed, genuinely expired. This is the state a tab left open overnight is
  // in, and it must be distinguishable from tampering by nothing except the clock.
  const expired = mint(agencyId, Date.now() - 60_000);
  const rExpired = await call(agencyId, expired);
  const rForged = await call(agencyId, `${agencyId}.${Date.now() + 3600_000}.notarealsignature`);
  const rNone = await call(agencyId, null);

  /*
   * Imports the SOURCE under tsx, not `dist`. A suite that reads the built artifact is
   * asserting about whatever was there at the last `npm run build:server` — found 2026-08-26
   * when two deliberate mutations to `readiness.ts` left `verify-readiness` 34/34 green and
   * the build turned out to be a day old. Run these with `npx tsx`, not `node`.
   *
   * The `dist/assets` reads elsewhere are a different thing and stay: those deliberately
   * inspect the SHIPPED browser bundle, which is the artifact under test.
   */
  const { verifyDashboardToken } = await import(`${ROOT}/apps/server/src/services/dashboardAuth.ts`);
  check("an expired-but-correctly-signed token is refused", verifyDashboardToken(expired, agencyId) === false);
  check("a forged signature is refused", verifyDashboardToken(`${agencyId}.${Date.now() + 3600_000}.nope`, agencyId) === false);
  check("a live token is accepted", verifyDashboardToken(real, agencyId) === true);
  check("  -> and only for the agency it names", verifyDashboardToken(real, "some-other-agency") === false);

  console.log("\n== over HTTP, with auth ON as production requires ==");
  // Local dev runs with DASHBOARD_AUTH_ENABLED unset, so the dev server accepts anything
  // and would report a cheerful 200 for every case above. The status code is exactly what
  // the dashboard branches on to decide between "session expired" and "something broke",
  // so it has to be exercised for real rather than inferred.
  const child = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: `${ROOT}/apps/server`,
    env: {
      ...process.env,
      PORT: String(AUTH_PORT),
      APP_PUBLIC_URL: `https://localhost:${AUTH_PORT}`,
      SUPPORT_DESK_URL: "http://localhost:5174",
      DASHBOARD_AUTH_ENABLED: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = [];
  child.stdout.on("data", (d) => log.push(d.toString()));
  child.stderr.on("data", (d) => log.push(d.toString()));
  try {
    const until = Date.now() + 30000;
    let up = false;
    while (Date.now() < until && !up) {
      try {
        up = (await fetch(`${AUTH_BASE}/health`)).ok;
      } catch {}
      if (!up) await new Promise((r) => setTimeout(r, 300));
    }
    if (!up) {
      console.error(log.join("").slice(-1500));
      throw new Error(`server did not boot on ${AUTH_PORT}`);
    }
    const authCall = (token) =>
      fetch(`${AUTH_BASE}/admin/api/${agencyId}/locations`, { headers: token ? { "x-mosaic-token": token } : {} });

    check("an expired token gets 401 — the code the banner keys on", (await authCall(expired)).status === 401);
    check("a forged signature gets 401", (await authCall(`${agencyId}.${Date.now() + 3600_000}.nope`)).status === 401);
    check("no token at all gets 401", (await authCall(null)).status === 401);
    check("a live token still works", (await authCall(real)).status === 200);

    /**
     * THE REFUSAL MUST NOT SAY WHETHER THE AGENCY EXISTS.
     *
     * `requireAgency` looked the agency up FIRST and 404'd on an unknown id, so an
     * unauthenticated caller could tell a real `agencyInstallId` from a made-up one — 401
     * for one, 404 for the other. That is the `/portal/:slug` oracle again, on the routes
     * it matters most on, and `/admin-embed` is careful to answer generically for exactly
     * this reason.
     *
     * Two other things fell out of the same ordering. Every unauthenticated request
     * reached Postgres before any credential was examined, on a single-threaded free
     * instance. And `npm run smoke` probes this endpoint with a FABRICATED agency id when
     * `--agency` is omitted while asserting 401/403 — so a correctly protected deploy
     * answered 404 and the post-deploy gate reported the single most expensive setting in
     * the product as broken.
     *
     * Asserted as an EQUALITY between the two refusals, not as "404 is gone": what matters
     * is that the two cases are indistinguishable, which is the property, and it stays true
     * whatever status code somebody picks later.
     */
    const unknown = await fetch(`${AUTH_BASE}/admin/api/agency_does_not_exist/locations`);
    const knownNoToken = await authCall(null);
    check(
      "an unknown agency and a real one give the SAME refusal — no existence oracle",
      unknown.status === knownNoToken.status,
      `unknown=${unknown.status} real=${knownNoToken.status}`
    );
    check(
      "  -> byte for byte, so the body does not answer it either",
      (await unknown.clone().text()) === (await knownNoToken.clone().text()),
      `${(await unknown.text()).slice(0, 80)} vs ${(await knownNoToken.text()).slice(0, 80)}`
    );
    check(
      "  -> and it is the 401 the post-deploy smoke gate asserts",
      unknown.status === 401,
      `${unknown.status} — smoke probes a fabricated agency id and demands 401/403`
    );
  } finally {
    child.kill("SIGTERM");
  }

  console.log("\n== and the shipped dashboard says what to DO about it ==");
  // The remedy cannot be carried out by the app: the ?k= slug was consumed at
  // /admin-embed and never reaches this origin, so there is no silent renewal. The only
  // fix is a human clicking the menu link, which means the words have to be there.
  const distDir = `${ROOT}/apps/admin-dashboard/dist/assets`;
  const bundle = fs
    .readdirSync(distDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => fs.readFileSync(path.join(distDir, f), "utf8"))
    .join("");
  check("the built bundle carries the instruction", /Click Mosaic in your GoHighLevel sidebar/.test(bundle));
  check("  -> it warns that unsaved changes are lost, rather than losing them silently", /unsaved changes/.test(bundle));
  check("  -> and it no longer shows the raw server wording", !/Missing or invalid dashboard token/.test(bundle));

  const css = fs
    .readdirSync(distDir)
    .filter((f) => f.endsWith(".css"))
    .map((f) => fs.readFileSync(path.join(distDir, f), "utf8"))
    .join("");
  check("it gets its own banner style, not the red error one", /\.session-banner/.test(css));

  console.log("\n== closing the theme editor no longer discards work silently ==");
  // The overlay was already deliberately non-dismissable — "a stray misclick would
  // discard all unsaved edits" — and then Escape did exactly that, instantly. Escape is
  // a reflex inside an iframe, and the work at risk is an agency's careful branding of
  // one of their clients.
  check("a discard prompt ships", /Discard your changes\?/.test(bundle));
  check("  -> and it says what survives, not just what is lost", /keeps the theme it had before/.test(bundle));
  check("  -> with a standing unsaved marker so the prompt is not the first warning", /\.unsaved-dot/.test(css));

  console.log("\n== nor does closing the support settings ==");
  // The same guard, and this overlay is MORE exposed: it closes on a backdrop click as
  // well as on Escape. What is thrown away reads small and isn't — a blocked-terms list
  // is up to 25 chips typed one at a time, and the boundary notes are free text saying
  // what Mosaic may promise on the agency's behalf.
  //
  // Matched on its OWN wording, not on "Discard your changes?": that string now ships
  // from two components, so the shared one would pass whether this half exists or not.
  check("its own discard prompt ships", /support policy hasn't been saved/.test(bundle));
  check(
    "  -> naming what goes back, since none of it exists anywhere else until Save",
    /escalation addresses, boundaries, wording and blocked terms/.test(bundle)
  );

  console.log("\n== nor do the THREE ways to lose a half-written article ==");
  // The knowledge tab holds the longest free text on the screen and had no guard at all.
  // The modal's own fingerprint is taken from the support CONFIG and cannot see it, so
  // covering the config alone would have protected a one-word tone field while Escape
  // still closed the modal over a 200-word SOP — worse than no guard, because it reads
  // as one.
  check("Cancel in the article editor asks first", /Discard this article\?/.test(bundle));
  check(
    "  -> and the modal's own prompt says the ARTICLE is what is at risk, not the policy",
    /The article you're writing hasn't been saved/.test(bundle)
  );
  check(
    "  -> switching tabs is guarded too, since only the open tab is mounted",
    /Leaving this tab closes the editor/.test(bundle)
  );

  console.log(`\n${"-".repeat(50)}\n  ${pass} passed, ${fail} failed`);
  await p.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error(e.stack);
  await p.$disconnect();
  process.exit(1);
});
