import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Lightweight signed session tokens for the admin dashboard.
 *
 * Today the dashboard is reached only via the agency-level Custom Menu Link,
 * whose URL carries the agencyInstallId and is visible only to that agency's
 * users inside GHL - so the id already acts as a GHL-gated bearer. These tokens
 * add a real, expiring, tamper-proof credential on top: the /admin-embed step
 * mints one for the resolved agency, and the API verifies it matches the agency
 * in the path.
 *
 * Verification is OPT-IN via DASHBOARD_AUTH_ENABLED=true, so enabling it for
 * production is a single env flip and doesn't disturb local/dev flows. Tokens
 * are always minted regardless, so the dashboard already carries them.
 */
const TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

function secret(): string {
  return process.env.DASHBOARD_TOKEN_SECRET || process.env.TOKEN_ENCRYPTION_KEY || "dev-insecure-secret";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function mintDashboardToken(agencyInstallId: string): string {
  const exp = Date.now() + TTL_MS;
  const payload = `${agencyInstallId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyDashboardToken(token: string | undefined, agencyInstallId: string): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [id, expStr, sig] = parts;
  const payload = `${id}.${expStr}`;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  if (id !== agencyInstallId) return false;
  if (Number(expStr) < Date.now()) return false;
  return true;
}

export const dashboardAuthEnabled = () => process.env.DASHBOARD_AUTH_ENABLED === "true";
