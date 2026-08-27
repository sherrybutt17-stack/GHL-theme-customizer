import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { safeEqual, describeError, securityHeaders, rateLimit } from "./security";
import { trustProxyHops } from "./env";

/**
 * The dependency-free security middleware, which had no tests. Three of its four exports
 * carry a guarantee somebody relies on elsewhere:
 *
 *   safeEqual      gates the `?k=` slug that is the ONLY thing protecting the dashboard
 *   describeError  is what stops client_secret / refresh_token reaching log storage
 *   rateLimit      is the 10/min on `/desk/api/login`, the one guessing target in the app
 */

describe("safeEqual", () => {
  test("equal strings match", () => {
    assert.equal(safeEqual("a-secret-slug", "a-secret-slug"), true);
  });

  test("different strings of the same length do not", () => {
    assert.equal(safeEqual("a-secret-slug", "a-secret-slxg"), false);
  });

  test("different LENGTHS return false rather than throwing", () => {
    // `timingSafeEqual` throws on a length mismatch, which would turn a wrong-length guess
    // into a 500 — and a 500 that a correct-length guess does not produce is an oracle.
    assert.equal(safeEqual("short", "much-longer-value"), false);
    assert.equal(safeEqual("", "x"), false);
    assert.equal(safeEqual("x", ""), false);
  });

  test("empty against empty is true, which callers must not rely on as auth", () => {
    // Recorded rather than guarded here: `/admin-embed` checks the slug is present before
    // comparing, and `deskAuth` parses hex strictly for the same class of reason.
    assert.equal(safeEqual("", ""), true);
  });
});

describe("describeError", () => {
  /**
   * The OAuth calls send `client_secret`, `refresh_token` and auth codes in the request
   * body, and Axios hangs that body off the error as `config.data`. Logging the raw error
   * puts those in log storage; this function exists to make that impossible.
   */
  const axiosish = () => {
    const e: any = new Error("Request failed with status code 401");
    e.response = { status: 401, data: { error: "invalid_grant" } };
    e.config = {
      url: "https://services.leadconnectorhq.com/oauth/token",
      data: "client_secret=SUPER_SECRET_VALUE&refresh_token=REFRESH_SECRET&code=AUTH_CODE",
      headers: { authorization: "Bearer BEARER_SECRET" },
    };
    return e;
  };

  test("it reports the message and the status", () => {
    assert.equal(describeError(axiosish()), "Request failed with status code 401 (HTTP 401)");
  });

  test("and NOTHING from the request body reaches the string", () => {
    const line = describeError(axiosish());
    for (const secret of ["SUPER_SECRET_VALUE", "REFRESH_SECRET", "AUTH_CODE", "BEARER_SECRET", "client_secret"]) {
      assert.ok(!line.includes(secret), `${secret} leaked into "${line}"`);
    }
  });

  test("a plain Error keeps its message and gains no status", () => {
    assert.equal(describeError(new Error("connect ECONNREFUSED")), "connect ECONNREFUSED");
  });

  test("a non-Error does not become [object Object]-plus-secrets", () => {
    // `String(e)` on an object is "[object Object]" — uninformative, but it cannot carry a
    // field out. That is the right trade for this function.
    assert.equal(describeError({ client_secret: "SUPER_SECRET_VALUE" }), "[object Object]");
    assert.equal(describeError(null), "null");
    assert.equal(describeError(undefined), "undefined");
  });
});

describe("securityHeaders", () => {
  test("no-referrer is set, because the dashboard token rides in a redirect URL", () => {
    const set: Record<string, string> = {};
    const res: any = { setHeader: (k: string, v: string) => (set[k] = v) };
    let nexted = false;
    securityHeaders({} as any, res, () => (nexted = true));
    assert.equal(set["Referrer-Policy"], "no-referrer");
    assert.equal(set["X-Content-Type-Options"], "nosniff");
    assert.match(set["Strict-Transport-Security"], /max-age=\d+/);
    assert.ok(nexted);
  });

  test("framing is NOT blocked — the product is embedded in GHL's iframe", () => {
    const set: Record<string, string> = {};
    const res: any = { setHeader: (k: string, v: string) => (set[k] = v) };
    securityHeaders({} as any, res, () => {});
    assert.equal(set["X-Frame-Options"], undefined);
    assert.equal(set["Content-Security-Policy"], undefined);
  });
});

describe("rateLimit, and the hop count that makes it per-client", () => {
  let saved: string | undefined;
  beforeEach(() => { saved = process.env.TRUST_PROXY_HOPS; });
  afterEach(() => {
    if (saved === undefined) delete process.env.TRUST_PROXY_HOPS;
    else process.env.TRUST_PROXY_HOPS = saved;
  });

  /** Send `n` requests as `client`, through one proxy hop, and report the statuses. */
  async function burst(hops: number, max: number, clients: string[]): Promise<number[]> {
    const app = express();
    app.set("trust proxy", hops);
    app.use(rateLimit({ windowMs: 60_000, max, name: "test" }));
    app.get("/", (_req, res) => res.json({ ok: true }));
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as AddressInfo).port;
    const out: number[] = [];
    for (const client of clients) {
      const r = await fetch(`http://127.0.0.1:${port}/`, { headers: { "x-forwarded-for": client } });
      out.push(r.status);
    }
    await new Promise((r) => server.close(r));
    return out;
  }

  test("each client gets its own allowance", async () => {
    const statuses = await burst(1, 3, ["9.9.9.1", "9.9.9.2", "9.9.9.3", "9.9.9.4"]);
    assert.deepEqual(statuses, [200, 200, 200, 200]);
  });

  test("one client burning its allowance does not affect another", async () => {
    const statuses = await burst(1, 2, ["9.9.9.1", "9.9.9.1", "9.9.9.1", "9.9.9.2"]);
    assert.deepEqual(statuses, [200, 200, 429, 200]);
  });

  test("with no hop trusted, every client shares ONE bucket", async () => {
    // This is the failure a malformed TRUST_PROXY_HOPS produces, stated as a fact rather
    // than as a worry: `/desk/api/login` would be 10 attempts a minute for the whole
    // internet, and one person mistyping locks out every agent.
    const statuses = await burst(0, 3, ["9.9.9.1", "9.9.9.2", "9.9.9.3", "9.9.9.4"]);
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  });

  test("each rateLimit() call gets its OWN counter", async () => {
    // Two limiters configured alike are two budgets. `/admin-embed` and `/portal` share one
    // INSTANCE for exactly this reason, and `verify-embed-auth` asserts it live.
    const a = rateLimit({ windowMs: 60_000, max: 1, name: "a" });
    const b = rateLimit({ windowMs: 60_000, max: 1, name: "b" });
    assert.notEqual(a, b);
  });

  test("a 429 says how long to wait", async () => {
    const app = express();
    app.set("trust proxy", 1);
    app.use(rateLimit({ windowMs: 60_000, max: 1, name: "retry" }));
    app.get("/", (_req, res) => res.json({ ok: true }));
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as AddressInfo).port;
    const headers = { "x-forwarded-for": "9.9.9.9" };
    await fetch(`http://127.0.0.1:${port}/`, { headers });
    const blocked = await fetch(`http://127.0.0.1:${port}/`, { headers });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    await new Promise((r) => server.close(r));
  });

  describe("trustProxyHops", () => {
    test("unset means one proxy — Render", () => {
      delete process.env.TRUST_PROXY_HOPS;
      assert.equal(trustProxyHops(), 1);
    });

    test("a BLANK value is 'not configured', not zero", () => {
      // `?? 1` never caught this: an empty string is not nullish, and `Number("")` is 0,
      // which trusts nothing and globalises every limit. Render stores blank values.
      for (const blank of ["", "   "]) {
        process.env.TRUST_PROXY_HOPS = blank;
        assert.equal(trustProxyHops(), 1, `${JSON.stringify(blank)} should fall back to 1`);
      }
    });

    test("a real count is honoured", () => {
      process.env.TRUST_PROXY_HOPS = "2";
      assert.equal(trustProxyHops(), 2);
      process.env.TRUST_PROXY_HOPS = "0";
      assert.equal(trustProxyHops(), 0);
    });

    test("anything unreadable is FATAL, not silently zero", () => {
      for (const bad of ["one", "1.5", "-1", "99", "1,2"]) {
        process.env.TRUST_PROXY_HOPS = bad;
        assert.throws(() => trustProxyHops(), /TRUST_PROXY_HOPS/, `"${bad}" was accepted`);
      }
    });
  });
});
