import { randomBytes, scryptSync, createHash, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "./prisma";
import { isProductionUrl } from "./env";
import type { DeskRole, DeskUser } from "@prisma/client";

/**
 * Session auth for the MOSAIC SUPPORT DESK (apps/support-desk).
 *
 * Deliberately NOT the same mechanism as the agency dashboard (dashboardAuth.ts).
 * That one is a stateless HMAC token because the dashboard is iframed inside GHL,
 * where cookies are unreliable - so the token has to ride a URL fragment into
 * sessionStorage. The desk is a standalone origin, which buys us two things the
 * dashboard cannot have:
 *
 *   1. Real httpOnly cookies. The token is never readable by JS, so an XSS in the
 *      desk cannot exfiltrate a session.
 *   2. Server-side revocation. A stateless token stays valid until it expires; a
 *      support agent who leaves the team must lose access NOW. Sessions are rows,
 *      so revoking is an UPDATE.
 *
 * Only the SHA-256 hash of a session token is stored, so a database leak yields no
 * usable sessions. Passwords use scrypt with a per-user random salt.
 */

const COOKIE_NAME = "mosaic_desk_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h - a working day, then re-auth.
/** Refresh `expiresAt` at most this often, so an active session slides forward. */
const SLIDING_REFRESH_MS = 30 * 60 * 1000;

// scrypt cost. N=16384 is the Node default and lands around ~50-100ms per hash on
// typical hardware, which is the point: it makes offline cracking expensive. Login
// is rate-limited separately so the cost is never a DoS lever.
const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 64;

/** Hash a password for storage: "<saltHex>:<hashHex>". */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N });
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

/**
 * Constant-time password check. Returns false (rather than throwing) on a malformed
 * stored hash so a corrupt row can't 500 the login route.
 *
 * The strict hex validation below is load-bearing, not defensive tidiness.
 * `Buffer.from(s, "hex")` does NOT throw on invalid input - it silently truncates at
 * the first non-hex character, so a stored hash like "not:hex" yields a ZERO-LENGTH
 * expected buffer. scryptSync would then be asked for a zero-length key, and
 * `timingSafeEqual(empty, empty)` is true - meaning ANY password would authenticate
 * against that row. Parse strictly, and require the exact expected lengths.
 */
const HEX_ONLY = /^[0-9a-f]+$/i;

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 2) return false;
  const [saltHex, hashHex] = parts;
  if (!HEX_ONLY.test(saltHex) || !HEX_ONLY.test(hashHex)) return false;
  // Exactly what hashPassword writes: a 16-byte salt and a 64-byte key.
  if (saltHex.length !== 32 || hashHex.length !== SCRYPT_KEYLEN * 2) return false;

  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, { N: SCRYPT_N });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Minimal cookie parser. The codebase avoids dependencies where a few lines will do
 * (see security.ts choosing this over helmet/express-rate-limit), and we only ever
 * read one cookie by name.
 */
export function readCookie(req: Pick<Request, "headers">, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/**
 * Cookies are Secure in deployed environments only.
 *
 * Uses isProductionUrl() rather than a bare https check, because APP_PUBLIC_URL is
 * REQUIRED to be https even in local dev (env.ts) - so "starts with https" is true on
 * a laptop too, and marking the cookie Secure there means the browser silently drops
 * it over the http:// the dev server actually serves. That failure mode looks exactly
 * like "login succeeded but I'm still logged out", which is miserable to debug.
 *
 * SameSite: the desk (5174) and API (3210) are different origins, so the session
 * cookie is cross-site on every XHR. Lax would omit it and nothing would work, so a
 * real deploy needs SameSite=None - which browsers only honour together with Secure.
 * CSRF is covered instead by the CORS allowlist pinned to SUPPORT_DESK_URL plus the
 * required x-mosaic-desk header; see requireDeskAuth.
 */
function cookieFlags(): string[] {
  const secure = isProductionUrl();
  const flags = ["Path=/", "HttpOnly", secure ? "SameSite=None" : "SameSite=Lax"];
  if (secure) flags.push("Secure");
  return flags;
}

export function setSessionCookie(res: Response, token: string): void {
  const attrs = [...cookieFlags(), `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`];
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; ${attrs.join("; ")}`);
}

export function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; ${[...cookieFlags(), "Max-Age=0"].join("; ")}`);
}

export interface DeskSessionUser {
  id: string;
  email: string;
  name: string;
  role: DeskRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      deskUser?: DeskSessionUser;
      deskSessionId?: string;
    }
  }
}

/** Create a session row and return the raw token (the only time it exists in plaintext). */
export async function createSession(
  user: Pick<DeskUser, "id">,
  meta: { userAgent?: string; ip?: string }
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.deskSession.create({
    data: {
      deskUserId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
      ip: meta.ip ?? null,
    },
  });
  return token;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.deskSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Kill every live session for a user - used when disabling or offboarding staff. */
export async function revokeAllSessionsForUser(deskUserId: string): Promise<number> {
  const result = await prisma.deskSession.updateMany({
    where: { deskUserId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/**
 * Resolve the session cookie to a live user, or null. Checks revocation and expiry
 * on EVERY request (that's the point of DB-backed sessions) and also re-checks the
 * user's status, so disabling an account takes effect immediately without having to
 * hunt down their sessions.
 */
export async function resolveSession(req: Request): Promise<{ user: DeskSessionUser; sessionId: string } | null> {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;

  const session = await prisma.deskSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { deskUser: true },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt <= new Date()) return null;
  if (session.deskUser.status !== "active") return null;

  // Slide the expiry forward for active sessions, but only occasionally - writing on
  // every request would turn each API call into an extra round trip for no benefit.
  const age = Date.now() - session.lastSeenAt.getTime();
  if (age > SLIDING_REFRESH_MS) {
    await prisma.deskSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
  }

  return {
    sessionId: session.id,
    user: {
      id: session.deskUser.id,
      email: session.deskUser.email,
      name: session.deskUser.name,
      role: session.deskUser.role,
    },
  };
}

/**
 * Gate for every /desk/api route except login.
 *
 * The `x-mosaic-desk: 1` requirement is the CSRF defence. Because the session cookie
 * is SameSite=None in production, a browser WILL attach it to a cross-site request -
 * so cookie presence alone proves nothing about who initiated the request. A custom
 * header cannot be set cross-origin without a successful CORS preflight, and the
 * preflight is answered only for SUPPORT_DESK_URL. An attacker's page therefore
 * cannot forge a request that carries both the cookie and the header.
 */
export async function requireDeskAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.method !== "GET" && req.headers["x-mosaic-desk"] !== "1") {
    res.status(403).json({ error: "Missing desk request header" });
    return;
  }
  const resolved = await resolveSession(req);
  if (!resolved) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }
  req.deskUser = resolved.user;
  req.deskSessionId = resolved.sessionId;
  next();
}

/**
 * The signed-in agent, for routes already behind requireDeskAuth. Reading
 * `req.deskUser` directly works too; this just keeps the assertion in one place.
 */
export function deskUser(req: Request): DeskSessionUser | undefined {
  return req.deskUser;
}

/** Admin-only gate. Layer AFTER requireDeskAuth. */
export function requireDeskAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.deskUser?.role !== "mosaic_admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
