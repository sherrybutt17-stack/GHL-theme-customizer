import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

/**
 * Defense-in-depth middleware, dependency-free (helmet/express-rate-limit would be
 * heavier and add supply-chain surface for what we need here).
 */

/**
 * Baseline security response headers. Deliberately NO X-Frame-Options / restrictive
 * frame-ancestors: this app is designed to be embedded in GHL's iframe (the
 * onboarding + portal pages and the dashboard all render inside GHL), so blocking
 * framing would break the product.
 *
 * Referrer-Policy: no-referrer is the important one here - the dashboard session
 * token rides in the /admin-embed redirect URL, and no-referrer stops it leaking to
 * any third party via the Referer header on outbound requests.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("Permissions-Policy", "geolocation=(), payment=()");
  // Force HTTPS on the browser for future requests (Render terminates TLS). No
  // `preload`, to avoid committing the apex domain to the HSTS preload list.
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  next();
}

/**
 * A safe one-line description of an error for logs. Critically, it never dumps the
 * whole object: an Axios error carries `config.data`, which for our OAuth/token
 * calls contains client_secret, refresh_token, and auth codes - logging the raw
 * error would leak those into log storage.
 */
export function describeError(e: unknown): string {
  const anyErr = e as any;
  const status = anyErr?.response?.status;
  const msg = anyErr?.message ?? String(e);
  return status ? `${msg} (HTTP ${status})` : msg;
}

/** Constant-time string compare that never short-circuits on length. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still do a compare against a same-length buffer so timing doesn't leak length.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Shown in logs so different limiters are distinguishable. */
  name: string;
}

/**
 * Fixed-window per-IP rate limiter, in-memory. Fine at this scale (a handful of
 * agencies, single Render instance); a multi-instance deploy would want a shared
 * store, but that's premature here.
 *
 * Requires `app.set("trust proxy", <hop count>)` so req.ip is the real client behind
 * Render/Cloudflare — a COUNT, never `true`. `true` trusts the whole `X-Forwarded-For`
 * chain, so any client can prepend an address and get a fresh bucket per request, which
 * on `/desk/api/login` is unlimited password guessing. `index.ts` uses
 * `trustProxyHops()`, which defaults to 1 and refuses a value it cannot read.
 */
export function rateLimit({ windowMs, max, name }: RateLimitOptions) {
  const hits = new Map<string, { count: number; reset: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = req.ip ?? "unknown";
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;

    // Opportunistic sweep so the map can't grow without bound under churn.
    if (hits.size > 10000) {
      for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    }

    if (entry.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((entry.reset - now) / 1000)));
      console.warn(`[rate-limit:${name}] ${key} exceeded ${max}/${Math.round(windowMs / 1000)}s`);
      res.status(429).json({ error: "Too many requests. Please slow down and try again shortly." });
      return;
    }
    next();
  };
}
