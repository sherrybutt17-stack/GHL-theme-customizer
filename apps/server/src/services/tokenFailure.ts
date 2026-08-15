/**
 * Why an OAuth token refresh failed — because the three answers need three different
 * humans, and in a log they look identical.
 *
 * Treating them alike is how the refresh loop spent every 30 minutes emitting one
 * identical line per broken agency, forever, saying nothing about which of these it
 * was:
 *
 *   decrypt   — TOKEN_ENCRYPTION_KEY does not match what encrypted the stored tokens.
 *               tokenCrypto is scrypt → AES-256-GCM, so a wrong key fails the auth tag
 *               and THROWS rather than returning nonsense. Nothing the agency can do:
 *               somebody regenerated the key against an existing database.
 *   revoked   — the refresh token is no longer good. The agency must re-authorise, and
 *               retrying cannot ever fix it.
 *   transient — network, timeout, 5xx. Retrying is exactly right.
 *
 * This lives in its own module with NO imports, deliberately. `tokenRefresh.ts` pulls
 * in `ghlClient.ts`, which throws on missing env at import time — so anything
 * downstream of it cannot be loaded by a unit test at all. Pure logic that decides how
 * an operator is told about a broken install should not be untestable for that reason.
 */
export type RefreshFailure = "decrypt" | "revoked" | "transient";

/**
 * Classified from the RAW error. The caller must still log through `describeError`:
 * an Axios failure here carries the POST body — client_secret and refresh_token — in
 * `config.data`.
 */
export function classifyRefreshFailure(error: unknown): RefreshFailure {
  const message = error instanceof Error ? error.message : String(error ?? "");
  // Node's AES-GCM auth-tag failure, which is exactly what a wrong key produces.
  if (/unsupported state|unable to authenticate data|bad decrypt|wrong final block/i.test(message)) {
    return "decrypt";
  }

  const status = (error as { response?: { status?: number } })?.response?.status;
  let body = "";
  try {
    body = JSON.stringify((error as { response?: { data?: unknown } })?.response?.data ?? "");
  } catch {
    body = ""; // circular or exotic payload; the status check below still applies
  }
  if (/invalid_grant|invalid_request|unauthorized_client/i.test(body)) return "revoked";
  if (status === 400 || status === 401) return "revoked";

  // Anything unrecognised keeps retrying. Defaulting to permanent would abandon an
  // agency over a message nobody had seen before.
  return "transient";
}

export const REFRESH_REMEDY: Record<RefreshFailure, string> = {
  decrypt:
    "TOKEN_ENCRYPTION_KEY does not match the key these tokens were encrypted with. " +
    "Restore the original key — regenerating it cannot be undone, and every agency must re-authorise.",
  revoked: "This agency's authorisation is no longer valid; they must reinstall or re-authorise the app.",
  transient: "Transient — will retry on the next pass.",
};
