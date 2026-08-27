import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { validateEnv, isProductionUrl } from "./env";

/**
 * The boot gate that makes production fail-closed, which had no tests at all.
 *
 * Two of its rules are the difference between a working deploy and an open one:
 * without `DASHBOARD_AUTH_ENABLED` every `/admin/api/:agencyInstallId/*` route is reachable
 * with only the agency id — which is PUBLIC, it sits in the `@import` line every agency
 * pastes — and without `WEBHOOK_SIGNATURE_PUBLIC_KEY` a forged `UNINSTALL` is accepted and
 * un-brands a live agency. `npm run smoke` catches both from outside, but only if somebody
 * runs it; this catches them in `npm test`.
 */

const KEYS = [
  "DATABASE_URL", "GHL_APP_CLIENT_ID", "GHL_APP_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY",
  "APP_PUBLIC_URL", "ADMIN_DASHBOARD_URL", "DASHBOARD_AUTH_ENABLED",
  "WEBHOOK_SIGNATURE_PUBLIC_KEY", "SUPPORT_DESK_URL", "OPENAI_API_KEY", "DASHBOARD_TOKEN_SECRET",
];
const saved: Record<string, string | undefined> = {};

/** The smallest environment that boots, as a laptop has it. */
const DEV = {
  DATABASE_URL: "postgres://x", GHL_APP_CLIENT_ID: "id", GHL_APP_CLIENT_SECRET: "secret",
  TOKEN_ENCRYPTION_KEY: "k".repeat(32), APP_PUBLIC_URL: "https://localhost:3210",
};
/** …and what a real deployment additionally has to have. */
const PROD = {
  ...DEV,
  APP_PUBLIC_URL: "https://mosaic-server.onrender.com",
  ADMIN_DASHBOARD_URL: "https://mosaic-dashboard.onrender.com",
  DASHBOARD_AUTH_ENABLED: "true",
  WEBHOOK_SIGNATURE_PUBLIC_KEY: "ed25519-public-key",
};

function setEnv(env: Record<string, string>): void {
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
}

// `validateEnv` warns on several non-fatal gaps; swallow those so the run stays readable.
let realWarn: typeof console.warn;
beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  realWarn = console.warn;
  console.warn = () => {};
});
afterEach(() => {
  console.warn = realWarn;
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("isProductionUrl", () => {
  const check = (url: string) => {
    process.env.APP_PUBLIC_URL = url;
    return isProductionUrl();
  };

  test("a deployed https host is production", () => {
    assert.equal(check("https://mosaic-server.onrender.com"), true);
  });

  test("localhost and loopback are not, however they are spelled", () => {
    // https even locally is REQUIRED, so the protocol alone cannot answer this.
    for (const url of [
      "https://localhost:3210",
      "https://127.0.0.1:3210",
      "https://127.1:3210",
      "https://[::1]:3210",
      "https://[::ffff:127.0.0.1]:3210",
      "https://dev.localhost:5173",
    ]) {
      assert.equal(check(url), false, `${url} should be dev`);
    }
  });

  test("a hostname that merely CONTAINS localhost is production", () => {
    // The old check tested the whole URL for the substrings "localhost" and "127.0.0.1",
    // so all of these read as dev — and a deployment read as dev requires neither
    // DASHBOARD_AUTH_ENABLED nor WEBHOOK_SIGNATURE_PUBLIC_KEY.
    for (const url of [
      "https://localhost.example.com",
      "https://app.localhost-labs.com",
      "https://127.0.0.1.nip.io",
      "https://mosaic.onrender.com/?redirect=localhost",
    ]) {
      assert.equal(check(url), true, `${url} should be production`);
    }
  });

  test("http is never production, and an unparseable https URL is", () => {
    assert.equal(check("http://mosaic-server.onrender.com"), false);
    // Unknown must mean the STRICTER answer, or the fail-closed rules are one malformed
    // string away from being switched off.
    assert.equal(check("https://"), true);
  });
});

describe("validateEnv", () => {
  test("a laptop environment boots", () => {
    setEnv(DEV);
    assert.doesNotThrow(() => validateEnv());
  });

  test("every required variable is required, and named when missing", () => {
    for (const key of Object.keys(DEV)) {
      const env = { ...DEV } as Record<string, string>;
      delete env[key];
      setEnv(env);
      assert.throws(() => validateEnv(), new RegExp(key), `${key} was not required`);
    }
  });

  test("APP_PUBLIC_URL must be https even locally", () => {
    // Both obvious local values are refused, for DIFFERENT reasons: a plain http:// one
    // fails here, and pointing it at the deployed host fails the production rules below.
    setEnv({ ...DEV, APP_PUBLIC_URL: "http://localhost:3210" });
    assert.throws(() => validateEnv(), /https/);
  });

  test("production requires the dashboard origin", () => {
    const env = { ...PROD } as Record<string, string>;
    delete env.ADMIN_DASHBOARD_URL;
    setEnv(env);
    assert.throws(() => validateEnv(), /ADMIN_DASHBOARD_URL/);
  });

  test("production refuses to boot with the admin API unauthenticated", () => {
    const env = { ...PROD } as Record<string, string>;
    delete env.DASHBOARD_AUTH_ENABLED;
    setEnv(env);
    assert.throws(() => validateEnv(), /DASHBOARD_AUTH_ENABLED/);
  });

  test("…and only the exact string \"true\" counts", () => {
    // `!== "true"`, so anything truthy-looking but different is refused rather than
    // silently serving an unauthenticated API.
    for (const value of ["TRUE", "True", "1", "yes", ""]) {
      setEnv({ ...PROD, DASHBOARD_AUTH_ENABLED: value });
      assert.throws(() => validateEnv(), /DASHBOARD_AUTH_ENABLED/, `"${value}" was accepted`);
    }
  });

  test("production refuses to boot with webhooks unverified", () => {
    const env = { ...PROD } as Record<string, string>;
    delete env.WEBHOOK_SIGNATURE_PUBLIC_KEY;
    setEnv(env);
    assert.throws(() => validateEnv(), /WEBHOOK_SIGNATURE_PUBLIC_KEY/);
  });

  test("a full production environment boots", () => {
    setEnv(PROD);
    assert.doesNotThrow(() => validateEnv());
  });

  test("the non-fatal gaps stay non-fatal", () => {
    // Each of these is a deliberate decision recorded in the file: the desk is a separate
    // deploy, the bot degrades to a hand-off, and the token secret falls back to another
    // strong key. Making any of them fatal would break a working install.
    for (const key of ["SUPPORT_DESK_URL", "OPENAI_API_KEY", "DASHBOARD_TOKEN_SECRET"]) {
      setEnv({ ...PROD, [key]: "" });
      assert.doesNotThrow(() => validateEnv(), `${key} became fatal`);
    }
  });

  test("a host that only CONTAINS localhost gets the production rules", () => {
    // The whole point of the substring fix: this deployment must not skip the two
    // fail-closed requirements just because its domain has "localhost" in it.
    setEnv({ ...DEV, APP_PUBLIC_URL: "https://app.localhost-labs.com" });
    assert.throws(() => validateEnv(), /ADMIN_DASHBOARD_URL/);
  });
});
