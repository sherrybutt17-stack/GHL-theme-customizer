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

export function validateEnv(): void {
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
