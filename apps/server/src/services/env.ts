import { BlockList, isIP } from "node:net";

/**
 * Validate required environment at boot so misconfiguration fails loudly and
 * immediately, rather than silently producing broken URLs or disabled features
 * at runtime. (An unset APP_PUBLIC_URL previously slipped through as `undefined`
 * and produced http:// embed links, an empty theme script, and a menu link that
 * failed to create - all with swallowed errors. This makes that impossible.)
 */
const REQUIRED = [
  "DATABASE_URL",
  "GHL_APP_CLIENT_ID",
  "GHL_APP_CLIENT_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "APP_PUBLIC_URL",
] as const;

/**
 * Loopback, by ADDRESS rather than by spelling. `BlockList` parses to bytes, so
 * `::ffff:127.0.0.1` and `127.1` resolve the same as `127.0.0.1` — the rule `safeFetch`
 * already follows, for the same reason.
 */
const LOOPBACK = new BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");

/** Is this hostname a developer's own machine? */
function isLocalHostname(hostname: string): boolean {
  // `new URL("https://[::1]:3210").hostname` keeps the brackets.
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  // `.localhost` is reserved for exactly this by RFC 6761.
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const version = isIP(host);
  if (version === 4) return LOOPBACK.check(host, "ipv4");
  if (version === 6) return LOOPBACK.check(host, "ipv6");
  return false;
}

/**
 * "Are we really deployed?" - https AND not the developer's own machine.
 *
 * The https check alone is not enough: APP_PUBLIC_URL is REQUIRED to be https even in
 * local dev (see validateEnv below), so `startsWith("https://")` is true on a laptop
 * too. Anything that changes behaviour between dev and prod must use this, not the
 * protocol alone - notably the desk's Secure cookie flag, which a browser silently
 * drops over the http:// the dev server actually serves.
 *
 * It used to test the WHOLE URL for the substrings "localhost" and "127.0.0.1", which is
 * the same mistake `safeFetch` was fixed for — *"an IP is a number; any check that treats
 * it as text is one alternative encoding away from being wrong"* — and this one is a
 * HOSTNAME treated as a substring of a URL. Measured, it was wrong in both directions:
 *
 *   https://localhost.example.com          -> "dev"   (a registrable domain)
 *   https://app.localhost-labs.com         -> "dev"
 *   https://127.0.0.1.nip.io               -> "dev"   (wildcard DNS, common for staging)
 *   https://real-host.com/?redirect=localhost -> "dev"
 *   https://[::1]:3210                     -> "PRODUCTION"  (loopback, in IPv6)
 *
 * The first four are the dangerous direction: read as dev, a deployment does not require
 * DASHBOARD_AUTH_ENABLED or WEBHOOK_SIGNATURE_PUBLIC_KEY, so it boots with an admin API
 * reachable using only the public agency id and with forged lifecycle webhooks accepted —
 * the two settings this file calls fatal in production. The fifth is the same bug in
 * reverse and is exactly the spelling case the SSRF work already recorded.
 *
 * An https URL we cannot parse is treated as PRODUCTION, not dev: unknown must mean the
 * stricter answer, or the fail-closed rules are one malformed string away from being off.
 */
export function isProductionUrl(): boolean {
  const raw = process.env.APP_PUBLIC_URL?.trim() ?? "";
  if (!/^https:\/\//i.test(raw)) return false;
  let hostname: string;
  try {
    hostname = new URL(raw).hostname;
  } catch {
    return true;
  }
  return !isLocalHostname(hostname);
}

/**
 * How many proxies sit between the internet and this process. Express's `trust proxy`
 * takes a HOP COUNT, and the count is what makes `req.ip` the real client rather than the
 * proxy — which is what makes every rate limit in this app per-client rather than global.
 *
 * It was read as `Number(process.env.TRUST_PROXY_HOPS ?? 1)`. `??` does not catch an EMPTY
 * STRING, and Render's Environment tab will happily store a key with a blank value, so
 * `Number("")` is 0 and `Number("two")` is NaN — and Express trusts nothing for either.
 * Measured, with four clients each behind one proxy and a limit of 3:
 *
 *   TRUST_PROXY_HOPS unset   req.ip = 9.9.9.1, 9.9.9.2, 9.9.9.3, 9.9.9.4   0 refused
 *   TRUST_PROXY_HOPS=""      req.ip = the PROXY, four times                1 refused
 *
 * All four collapse into one bucket, so `/desk/api/login` becomes 10 attempts a minute for
 * the entire internet — one person mistyping their password locks out every Mosaic agent —
 * and `/support/api`'s 60/min starts 429ing real clients' chat messages. The `Number("")`
 * trap this file already records for `maxConcurrent`, `slaFirstResponseMins`,
 * `supportEnabled` and a preset's `menuOrder`, now on the setting that makes every OTHER
 * limit meaningful.
 *
 * Blank or unset means "not configured" and takes the default of 1 (one proxy: Render).
 * Anything present and unusable is FATAL, because the alternative is a silent, global
 * rate limit that nothing in the request path can notice.
 */
export function trustProxyHops(): number {
  const raw = process.env.TRUST_PROXY_HOPS?.trim();
  if (!raw) return 1;
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 0 || hops > 10) {
    throw new Error(
      `TRUST_PROXY_HOPS must be a whole number of proxies between 0 and 10 (got "${raw}"). ` +
        `Anything else makes Express trust none of them, so req.ip is the proxy and EVERY ` +
        `rate limit becomes global instead of per-client. Leave it unset for Render's single proxy.`
    );
  }
  return hops;
}

export function validateEnv(): void {
  // Read early so a malformed value fails the boot rather than silently globalising every
  // rate limit — nothing in the request path can notice that afterwards.
  trustProxyHops();

  const missing = REQUIRED.filter((k) => !process.env[k]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Set them (in Render: the service's Environment tab) and redeploy.`
    );
  }

  // APP_PUBLIC_URL is baked into embed snippets and the OAuth/menu-link URLs, so
  // it must be an absolute https:// URL - GHL embeds over HTTPS and an http://
  // value causes silent mixed-content failures in the browser.
  const appUrl = process.env.APP_PUBLIC_URL!.trim();
  if (!/^https:\/\/.+/.test(appUrl)) {
    throw new Error(
      `APP_PUBLIC_URL must be an absolute https:// URL (got "${appUrl}"). ` +
        `An http:// or relative value breaks the pasted @import CSS in GHL.`
    );
  }
  if (appUrl.endsWith("/")) {
    // Not fatal, but a trailing slash yields "https://host//theme-css/..." - warn.
    console.warn(`[env] APP_PUBLIC_URL has a trailing slash ("${appUrl}"); it will produce double slashes in URLs.`);
  }

  // Treat an https, non-localhost public URL as "production". In that mode a few
  // more vars are load-bearing and must not silently fall back to dev defaults.
  const isProd = isProductionUrl();
  if (isProd) {
    const adminUrl = process.env.ADMIN_DASHBOARD_URL?.trim();
    if (!adminUrl) {
      // Without this, both CORS and the /admin-embed redirect fall back to
      // http://localhost:5173 - the production dashboard is simply unreachable.
      throw new Error(
        "ADMIN_DASHBOARD_URL is required in production (APP_PUBLIC_URL is https). " +
          "Set it to the deployed dashboard origin (e.g. https://mosaic-dashboard.onrender.com)."
      );
    }
    if (process.env.DASHBOARD_AUTH_ENABLED !== "true") {
      // Fatal in production: without it every /admin/api/:agencyInstallId/* route is
      // reachable with only the (non-secret) agency id - cross-tenant reads AND writes
      // are wide open. Fail the boot rather than silently serve an unauthenticated API.
      throw new Error(
        "DASHBOARD_AUTH_ENABLED must be \"true\" in production (APP_PUBLIC_URL is https). " +
          "Without it the admin API requires no auth and any agency's data is exposed. " +
          "Set DASHBOARD_AUTH_ENABLED=true and a strong DASHBOARD_TOKEN_SECRET."
      );
    }
    if (!process.env.WEBHOOK_SIGNATURE_PUBLIC_KEY?.trim()) {
      // Fatal in production: without the signing key, /webhooks/ghl processes events
      // WITHOUT signature verification (fail-open). A forged UninstallCompany with a
      // known companyId would then mark an agency uninstalled + delete its menu link -
      // an unauthenticated cross-tenant integrity/DoS attack. Fail boot instead.
      throw new Error(
        "WEBHOOK_SIGNATURE_PUBLIC_KEY is required in production (APP_PUBLIC_URL is https). " +
          "Without it incoming GHL webhooks are NOT signature-verified and forged lifecycle " +
          "events (e.g. UninstallCompany) are accepted. Set the app's Ed25519 public key."
      );
    }
    if (!process.env.SUPPORT_DESK_URL?.trim()) {
      // Non-fatal on purpose: the desk is a separate deploy and the server must keep
      // booting without it. The CORS origin then falls back to http://localhost:5174,
      // which no real browser origin can match - so the failure mode is "the desk
      // can't reach the API", never "the desk API is open to any origin".
      console.warn(
        "[env] SUPPORT_DESK_URL is not set; /desk/api will only accept the localhost dev " +
          "origin, so a deployed support desk cannot reach it. Set it to the desk origin."
      );
    }
    if (!process.env.OPENAI_API_KEY?.trim()) {
      // Non-fatal: theming is the live product and must keep serving without this. The
      // support bot degrades to "let me get someone from the team" rather than erroring,
      // so a missing key costs the bot, never the stylesheet.
      console.warn(
        "[env] OPENAI_API_KEY is not set; the support bot cannot generate answers and will " +
          "escalate every question to a human. Theming is unaffected."
      );
    }
    if (!process.env.DASHBOARD_TOKEN_SECRET?.trim()) {
      // Not fatal: dashboardAuth falls back to TOKEN_ENCRYPTION_KEY (itself a required,
      // strong secret), so tokens are still signed with a strong key - just reused
      // across two purposes. Prefer a dedicated secret; warn rather than break boot.
      console.warn(
        "[env] DASHBOARD_TOKEN_SECRET is not set; dashboard tokens will be signed with " +
          "TOKEN_ENCRYPTION_KEY as a fallback. Set a dedicated DASHBOARD_TOKEN_SECRET."
      );
    }
  }

  // Security-relevant but non-fatal gaps: warn loudly, don't crash a working install.
  if (!process.env.WEBHOOK_SIGNATURE_PUBLIC_KEY?.trim()) {
    console.warn(
      "[env] WEBHOOK_SIGNATURE_PUBLIC_KEY is not set - incoming webhooks are NOT signature-verified. " +
        "Set it to the app's Ed25519 public key before wide release (see docs/submission-checklist.md)."
    );
  }
  if (process.env.DASHBOARD_AUTH_ENABLED === "true" && !process.env.DASHBOARD_TOKEN_SECRET?.trim()) {
    console.warn(
      "[env] DASHBOARD_AUTH_ENABLED=true but DASHBOARD_TOKEN_SECRET is unset - " +
        "dashboard tokens fall back to a weaker signing key. Set DASHBOARD_TOKEN_SECRET."
    );
  }
}
