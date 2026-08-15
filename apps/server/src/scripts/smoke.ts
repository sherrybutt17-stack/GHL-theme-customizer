// Import FIRST: npm workspaces run this with cwd=apps/server while .env lives at the
// repo root. See services/loadEnv.ts.
import "../services/loadEnv";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";

/**
 * Smoke-test a DEPLOYED Mosaic from the outside.
 *
 *   npm run smoke --workspace @ghl-theme-builder/server -- \
 *     --base https://mosaic-server.onrender.com \
 *     --dashboard https://mosaic-dashboard.onrender.com \
 *     --desk https://mosaic-desk.onrender.com \
 *     [--agency <agencyInstallId>] [--location <ghlLocationId>]
 *
 * Complementary to `readiness`, not a duplicate of it. Readiness asks the DATABASE
 * whether this deployment can do its job; this asks the three deployed services, over
 * the network, as a browser would — which is the only way to catch the failures that
 * live between them:
 *
 *   - a static site still baked against the OLD API URL (VITE_API_BASE_URL is compiled
 *     IN, so changing it needs a REBUILD, not a restart — and the symptom is a dashboard
 *     that loads perfectly and can reach nothing);
 *   - DASHBOARD_AUTH_ENABLED not actually on, leaving every agency's data readable with
 *     only the non-secret agency id;
 *   - SUPPORT_DESK_URL unset, so the desk's own origin is refused by CORS;
 *   - WEBHOOK_SIGNATURE_PUBLIC_KEY unset, so forged lifecycle events are accepted;
 *   - the stylesheet losing its ETag, which silently returns it to shipping megabytes
 *     render-blocking on every page load.
 *
 * READ-ONLY. The single POST is a webhook probe that a correctly configured production
 * REFUSES before it writes anything; see the check for why it cannot be done any other way.
 */

const args = process.argv.slice(2);
function arg(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const BASE = (arg("base") ?? process.env.APP_PUBLIC_URL ?? "").replace(/\/$/, "");
const DASHBOARD = (arg("dashboard") ?? process.env.ADMIN_DASHBOARD_URL ?? "").replace(/\/$/, "");
const DESK = (arg("desk") ?? process.env.SUPPORT_DESK_URL ?? "").replace(/\/$/, "");
const AGENCY = arg("agency");
const LOCATION = arg("location");

if (!BASE) {
  console.error("Usage: npm run smoke -- --base https://server [--dashboard URL] [--desk URL] [--agency ID] [--location ID]");
  process.exit(2);
}

let pass = 0;
let fail = 0;
let skip = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) {
    console.log(`  ok    ${name}`);
    pass++;
  } else {
    console.log(`  FAIL  ${name}`);
    if (detail !== undefined) console.log(`        ${String(detail).slice(0, 250)}`);
    fail++;
  }
};
const skipped = (name: string, why: string) => {
  console.log(`  skip  ${name} (${why})`);
  skip++;
};

/**
 * Raw http(s), not fetch. Undici silently attaches `cache-control: no-cache` to any
 * request carrying a conditional header, and Express's `fresh` then correctly refuses the
 * 304 — so the ETag check below comes back 200 every time and reads exactly like a server
 * that ignores ETags. This cost an afternoon once; don't swap it back for fetch.
 */
function raw(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string; ms: number }> {
  const u = new URL(url);
  const send = u.protocol === "https:" ? httpsRequest : httpRequest;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const req = send(
      { hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method: opts.method ?? "GET", headers: opts.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            ms: Date.now() - started,
          })
        );
      }
    );
    // A free instance sleeps after ~15 min and takes ~50s to wake, so this must outlast
    // a cold start or the whole run reads as an outage.
    req.setTimeout(90_000, () => req.destroy(new Error("timed out after 90s")));
    req.on("error", reject);
    req.end(opts.body);
  });
}

(async () => {
  console.log(`\n== server: ${BASE} ==`);
  let health;
  try {
    health = await raw(`${BASE}/health`);
  } catch (e) {
    // Report and carry on to the static sites rather than exiting here. On the free plan
    // an unreachable API is a normal-ish state, and the check people most need — whether
    // a site was REBUILT against the current API URL — is answered entirely by the static
    // hosts and needs nothing from the server.
    check("the server answers at all", false, (e as Error).message);
    await checkStaticSite("dashboard", DASHBOARD);
    await checkStaticSite("desk", DESK);
    console.log(`\n${"-".repeat(50)}\n  ${pass} passed, ${fail} failed, ${skip} skipped`);
    process.exit(1);
  }
  const healthJson = JSON.parse(health.body || "{}");
  check("GET /health is 200", health.status === 200, `${health.status} ${health.body.slice(0, 120)}`);
  check("  -> and the DATABASE round trip succeeded", healthJson.db === "up", health.body.slice(0, 200));
  if (health.ms > 20_000) {
    console.log(`        note: ${Math.round(health.ms / 1000)}s — that was a cold start. Theming is a render-blocking @import, so this is the stall an agency's whole GHL UI takes on the first hit after a sleep.`);
  }

  console.log("\n== the admin API is actually protected ==");
  // The single most expensive setting to get wrong: without DASHBOARD_AUTH_ENABLED every
  // /admin/api/:agencyInstallId/* route is reachable with only the agency id, which is
  // NOT secret - it is in the public @import line. env.ts refuses to boot without it, so
  // this verifies from outside that the running build is the one that refuses.
  const probeAgency = AGENCY ?? "agency_smoke_probe";
  const unauth = await raw(`${BASE}/admin/api/${probeAgency}/locations`);
  check(
    "an unauthenticated admin-API call is refused",
    unauth.status === 401 || unauth.status === 403,
    `got ${unauth.status}: ${unauth.body.slice(0, 160)}`
  );

  console.log("\n== the stylesheet keeps its ETag ==");
  if (!AGENCY) {
    skipped("theme-css revalidates to 304", "pass --agency <agencyInstallId>");
  } else {
    const first = await raw(`${BASE}/theme-css/${AGENCY}`);
    check("theme-css is 200", first.status === 200, `${first.status} ${first.body.slice(0, 120)}`);
    check("  -> served as CSS", String(first.headers["content-type"] ?? "").includes("text/css"), first.headers["content-type"]);
    const cc = String(first.headers["cache-control"] ?? "");
    check("  -> Cache-Control is no-cache, NOT no-store", /no-cache/.test(cc) && !/no-store/.test(cc), cc);
    const etag = first.headers.etag as string | undefined;
    check("  -> an ETag is present", !!etag, JSON.stringify(first.headers).slice(0, 200));
    if (etag) {
      const second = await raw(`${BASE}/theme-css/${AGENCY}`, { headers: { "if-none-match": etag } });
      check(
        "a repeat load is 304 with no body — not megabytes, render-blocking, again",
        second.status === 304 && second.body.length === 0,
        `${second.status}, ${second.body.length} bytes`
      );
      console.log(`        first load ${(first.body.length / 1024).toFixed(1)}KB, repeat ${second.body.length} bytes`);
    }
    if (first.headers["x-mosaic-degraded"]) {
      check("  -> and it is NOT being served from the degraded cache", false, `X-Mosaic-Degraded: ${first.headers["x-mosaic-degraded"]}`);
    }
  }

  console.log("\n== forged webhooks are refused ==");
  // The one POST. A correctly configured production rejects this BEFORE its first
  // database write, so it leaves no trace; there is no GET that can tell you whether the
  // signing key is set. The event type is one the dispatcher ignores, so even the
  // fail-open outcome does nothing beyond a shape-only audit row that prunes itself.
  const appId = (process.env.GHL_APP_CLIENT_ID ?? "").split("-")[0];
  if (!appId) {
    skipped("an unsigned webhook is refused", "GHL_APP_CLIENT_ID not available locally");
  } else {
    const body = JSON.stringify({ type: "ContactCreate", appId, webhookId: `smoke_${Date.now()}` });
    const forged = await raw(`${BASE}/webhooks/ghl`, {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)), "x-ghl-signature": "bm90LWEtc2lnbmF0dXJl" },
    }).catch((e) => ({ status: 0, headers: {}, body: String(e), ms: 0 }));
    check(
      "a bad signature is rejected — WEBHOOK_SIGNATURE_PUBLIC_KEY is set",
      forged.status === 401,
      `got ${forged.status}; 200 means webhooks are processed UNVERIFIED and a forged UNINSTALL would un-brand a live agency`
    );
  }

  console.log("\n== the support widget's public endpoint ==");
  if (!AGENCY || !LOCATION) {
    skipped("widget config resolves", "pass --agency and --location");
  } else {
    const cfg = await raw(`${BASE}/support/api/${AGENCY}/${LOCATION}/config`);
    if (cfg.status === 404) {
      console.log("        404 — support is off for this sub-account (both switches are required). Not a fault.");
      skipped("widget config resolves", "support not enabled here");
    } else {
      const j = JSON.parse(cfg.body || "{}");
      check("config is 200", cfg.status === 200, `${cfg.status} ${cfg.body.slice(0, 140)}`);
      check("  -> it carries a brand name", typeof j.brandName === "string" && j.brandName.length > 0, cfg.body.slice(0, 160));
      // Shipping these would tell an attacker exactly what to work around.
      check("  -> and leaks neither forbiddenTerms nor allowedLinkDomains", !("forbiddenTerms" in j) && !("allowedLinkDomains" in j), Object.keys(j).join(","));
    }
  }

  await checkStaticSite("dashboard", DASHBOARD);
  await checkStaticSite("desk", DESK);

  console.log("\n== the desk's cross-origin access ==");
  if (!DESK) {
    skipped("desk origin is allowed by CORS", "pass --desk");
  } else {
    const pre = await raw(`${BASE}/desk/api/me`, {
      method: "OPTIONS",
      headers: { origin: DESK, "access-control-request-method": "GET", "access-control-request-headers": "x-mosaic-desk" },
    });
    const allowed = String(pre.headers["access-control-allow-origin"] ?? "");
    check(
      "the deployed desk origin is allowed — SUPPORT_DESK_URL is set correctly",
      allowed === DESK,
      `Access-Control-Allow-Origin: "${allowed}" (unset falls back to the localhost dev origin, so the desk cannot reach the API at all)`
    );
    check("  -> with credentials, which the session cookie requires", String(pre.headers["access-control-allow-credentials"] ?? "") === "true", pre.headers["access-control-allow-credentials"]);

    const stranger = await raw(`${BASE}/desk/api/me`, {
      method: "OPTIONS",
      headers: { origin: "https://not-the-desk.example", "access-control-request-method": "GET" },
    });
    const strangerAllowed = String(stranger.headers["access-control-allow-origin"] ?? "");
    check("a stranger's origin is NOT allowed", strangerAllowed !== "https://not-the-desk.example" && strangerAllowed !== "*", strangerAllowed);
  }

  console.log(`\n${"-".repeat(50)}\n  ${pass} passed, ${fail} failed, ${skip} skipped`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e?.stack ?? e);
  process.exit(2);
});

/**
 * The failure this exists for: `VITE_API_BASE_URL` is compiled INTO the bundle, so
 * pointing a static site at a new API needs a REBUILD, not a restart. Get it wrong and
 * the site loads perfectly, renders its whole UI, and can reach nothing — which reads as
 * "the API is down" while the API is fine. Reading the origin back out of the shipped
 * JavaScript is the only way to see it without a browser.
 */
async function checkStaticSite(label: string, origin: string): Promise<void> {
  console.log(`\n== ${label}: ${origin || "(not given)"} ==`);
  if (!origin) {
    skipped(`${label} is deployed and points at this API`, `pass --${label}`);
    return;
  }
  const page = await raw(`${origin}/`).catch((e) => ({ status: 0, headers: {}, body: String(e), ms: 0 }));
  check(`${label} responds`, page.status === 200, `${page.status} ${page.body.slice(0, 120)}`);
  if (page.status !== 200) return;

  // A Vite DEV server serves /src/main.tsx and injects /@react-refresh; there is no
  // built bundle to read an origin out of. Say so rather than reporting a failure that
  // only means "you pointed this at a dev server".
  if (/@react-refresh|\/src\/main\.tsx/.test(page.body)) {
    skipped(`  -> ${label} was BUILT against this API`, "this is a Vite dev server, not a built site");
    return;
  }
  const asset = page.body.match(/src="([^"]*\/assets\/[^"]+\.js)"/)?.[1];
  if (!asset) {
    check(`  -> its JS bundle is discoverable`, false, page.body.slice(0, 200));
    return;
  }
  const bundle = await raw(`${origin}${asset.startsWith("/") ? "" : "/"}${asset}`);
  check(`  -> the bundle loads (${(bundle.body.length / 1024).toFixed(0)}KB)`, bundle.status === 200, bundle.status);
  const host = new URL(BASE).host;
  check(
    `  -> and it was BUILT against ${host}`,
    bundle.body.includes(host),
    `the shipped bundle does not mention ${host} — VITE_API_BASE_URL is baked in at build time, so this site needs a REBUILD (not a restart) to point at the current API`
  );
}
