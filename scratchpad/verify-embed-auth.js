/**
 * The per-agency slug is the only thing between a scraped agency id and a valid admin
 * token — and the agency id is PUBLIC, it sits in the pasted @import line. So every route
 * that touches the slug has to behave the same way about it.
 *
 * The phase-1 `/portal/:slug` page did not: 200 for a valid slug, 404 for a bad one, a
 * clean unauthenticated oracle for the one secret `/admin-embed` returns a deliberately
 * generic 403 to protect — under its own 60/min bucket, double the 30 `/admin-embed` is
 * held to precisely because it gates that secret.
 */
const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);

const BASE = process.env.VERIFY_BASE ?? "http://localhost:3210";
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

// No redirect following: the redirect itself is what is under test.
const get = (path, headers = {}) => fetch(`${BASE}${path}`, { redirect: "manual", headers });

(async () => {
  const reg = await p.customMenuLinkRegistration.findFirst({
    select: { slug: true, agencyInstallId: true },
  });
  if (!reg) throw new Error("need a CustomMenuLinkRegistration row");
  const BAD = "0".repeat(reg.slug.length);

  console.log("\n== /admin-embed: the real entry point ==");
  const good = await get(`/admin-embed/${reg.agencyInstallId}?k=${reg.slug}`);
  check("a correct slug mints a token and redirects to the dashboard", good.status === 302, good.status);
  const loc = good.headers.get("location") ?? "";
  check("  -> with the token in the FRAGMENT, never the query", /#t=/.test(loc) && !/[?&]t=/.test(loc), loc.replace(/#t=.*/, "#t=<redacted>"));

  const wrongKey = await get(`/admin-embed/${reg.agencyInstallId}?k=${BAD}`);
  check("a wrong slug is refused", wrongKey.status === 403, wrongKey.status);
  const noKey = await get(`/admin-embed/${reg.agencyInstallId}`);
  check("a missing slug is refused", noKey.status === 403, noKey.status);
  check("  -> both with the SAME generic response", wrongKey.status === noKey.status);

  console.log("\n== /portal: the phase-1 leftover ==");
  const portalGood = await get(`/portal/${reg.slug}`);
  check("a legacy link redirects into the real dashboard entry", portalGood.status === 302, portalGood.status);
  const target = portalGood.headers.get("location") ?? "";
  check("  -> at /admin-embed, carrying the slug", target.includes(`/admin-embed/${reg.agencyInstallId}`) && target.includes("k="), target.replace(/k=.*/, "k=<redacted>"));

  const portalBad = await get(`/portal/${BAD}`);
  check("an unknown slug is 403, not 404 — same wording as /admin-embed", portalBad.status === 403, portalBad.status);
  check("  -> and returns no page to interact with", (await portalBad.text()).length < 40);

  console.log("\n== the SSO surface is gone ==");
  const body = await (await get(`/portal/${reg.slug}`)).text();
  check("no HTML page is rendered any more", !/<html|addEventListener|postMessage/i.test(body), body.slice(0, 120));
  const ctx = await fetch(`${BASE}/portal/${reg.slug}/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload: "anything" }),
  });
  check("the SSO context endpoint no longer exists", ctx.status === 404, ctx.status);

  console.log("\n== both routes spend ONE rate-limit budget ==");
  // Two separately-configured limiters would hand out two budgets, which is how the
  // tightest limit in the app was quietly doubled. Burn the allowance on /portal and
  // /admin-embed must already be limited.
  let sawLimit = false;
  for (let i = 0; i < 40; i++) {
    const r = await get(`/portal/${BAD}`);
    if (r.status === 429) {
      sawLimit = true;
      break;
    }
  }
  check("probing /portal is rate-limited", sawLimit);
  if (sawLimit) {
    const spill = await get(`/admin-embed/${reg.agencyInstallId}?k=${BAD}`);
    check("  -> and it spends /admin-embed's allowance too, not a second one", spill.status === 429, `${spill.status} — a separate bucket would still answer 403 here`);
  }

  console.log(`\n${"-".repeat(50)}\n  ${pass} passed, ${fail} failed`);
  await p.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error(e.stack);
  await p.$disconnect();
  process.exit(1);
});
