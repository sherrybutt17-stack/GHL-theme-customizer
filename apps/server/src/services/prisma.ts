import { PrismaClient } from "@prisma/client";

/**
 * Bound the driver's connect/pool phases.
 *
 * Failure mode this guards against (hit in production 2026-08-10): Render suspended
 * the free Postgres instance, so the host stopped accepting connections. Prisma then
 * held every query open indefinitely rather than erroring - `/theme-css` never
 * responded, and because that URL is loaded via `@import` from GHL's Custom CSS
 * field, browsers blocked rendering on the pending stylesheet. A dead database
 * degraded the whole GHL UI instead of just dropping the theming.
 *
 * These two parameters only cover getting a connection. A query that has already
 * started is NOT covered, so routes that must never hang also wrap their work in a
 * wall-clock timeout - see `withTimeout` in routes/themeCss.ts.
 */
function withConnectionLimits(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    // Only fill in what the operator hasn't set explicitly.
    if (!u.searchParams.has("connect_timeout")) u.searchParams.set("connect_timeout", "5");
    if (!u.searchParams.has("pool_timeout")) u.searchParams.set("pool_timeout", "10");
    return u.toString();
  } catch {
    // Unparseable - hand it back untouched and let Prisma raise its own config error.
    return url;
  }
}

const datasourceUrl = withConnectionLimits(process.env.DATABASE_URL);

export const prisma = datasourceUrl ? new PrismaClient({ datasourceUrl }) : new PrismaClient();
