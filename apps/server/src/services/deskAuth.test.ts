import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { hashPassword, verifyPassword, readCookie, setSessionCookie, clearSessionCookie } from "./deskAuth";

/**
 * Unit tests for the desk auth primitives.
 *
 * These are the pure, DB-free parts - password hashing, cookie parsing, cookie
 * attributes - and they're exactly where a silent bug is most expensive: a cookie
 * missing HttpOnly or a verify that returns true on a malformed hash doesn't fail
 * loudly, it just quietly stops protecting anything.
 *
 * Run: npm run test --workspace @ghl-theme-builder/server
 */

/** Minimal Response stand-in: we only ever call setHeader. */
function fakeRes(): Response & { headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
  } as unknown as Response & { headers: Record<string, string> };
}

function reqWithCookie(cookie?: string): Pick<Request, "headers"> {
  return { headers: cookie === undefined ? {} : { cookie } } as Pick<Request, "headers">;
}

describe("password hashing", () => {
  test("accepts the correct password", () => {
    const stored = hashPassword("correct horse battery staple");
    assert.equal(verifyPassword("correct horse battery staple", stored), true);
  });

  test("rejects the wrong password", () => {
    const stored = hashPassword("correct horse battery staple");
    assert.equal(verifyPassword("Correct horse battery staple", stored), false);
    assert.equal(verifyPassword("", stored), false);
  });

  test("salts each hash, so identical passwords never collide in storage", () => {
    // Two staff choosing the same password must not produce the same row - otherwise
    // the hash table leaks who shares a password.
    assert.notEqual(hashPassword("same-password-123"), hashPassword("same-password-123"));
  });

  test("returns false rather than throwing on a malformed stored hash", () => {
    // A corrupt row must fail the login, not 500 the route (which would take the
    // whole desk down for everyone if it ever happened).
    //
    // REGRESSION GUARD - this caught a real auth bypass. Buffer.from(s, "hex")
    // silently truncates invalid hex to an EMPTY buffer instead of throwing, so
    // "not:hex" produced a zero-length expected key, and timingSafeEqual(empty,
    // empty) is true: any password authenticated against a corrupt row. Hence the
    // strict hex + exact-length parsing in verifyPassword.
    const malformed = [
      "",
      "nosalt",
      ":",
      "zz:zz",
      "not:hex",
      "not:hex:extra",
      // Well-formed hex, but the wrong lengths - the empty-buffer path again.
      "ab:cd",
      `${"a".repeat(32)}:`,
      `:${"b".repeat(128)}`,
      // Right shape, wrong salt length.
      `${"a".repeat(30)}:${"b".repeat(128)}`,
    ];
    for (const bad of malformed) {
      assert.equal(verifyPassword("anything", bad), false, `expected false for ${JSON.stringify(bad)}`);
      assert.equal(verifyPassword("", bad), false, `expected false for empty password vs ${JSON.stringify(bad)}`);
    }
  });

  test("a real hash has the exact shape verifyPassword requires", () => {
    // If hashPassword's format ever drifts from the strict parse above, every login
    // silently fails. Pin the contract.
    const [saltHex, hashHex] = hashPassword("whatever").split(":");
    assert.equal(saltHex.length, 32, "salt should be 16 bytes of hex");
    assert.equal(hashHex.length, 128, "key should be 64 bytes of hex");
  });
});

describe("cookie parsing", () => {
  test("finds the named cookie among several", () => {
    const req = reqWithCookie("other=1; mosaic_desk_session=abc123; third=x");
    assert.equal(readCookie(req, "mosaic_desk_session"), "abc123");
  });

  test("tolerates missing or absent cookies", () => {
    assert.equal(readCookie(reqWithCookie(), "mosaic_desk_session"), undefined);
    assert.equal(readCookie(reqWithCookie("other=1"), "mosaic_desk_session"), undefined);
  });

  test("does not match on a prefix", () => {
    // "session" must not be found inside "mosaic_desk_session".
    const req = reqWithCookie("mosaic_desk_session=abc");
    assert.equal(readCookie(req, "session"), undefined);
  });

  test("keeps base64url values intact", () => {
    // Session tokens are base64url, which contains '-' and '_' but never '='.
    const token = "aB3-_xYz09";
    assert.equal(readCookie(reqWithCookie(`mosaic_desk_session=${token}`), "mosaic_desk_session"), token);
  });
});

describe("session cookie attributes", () => {
  const original = process.env.APP_PUBLIC_URL;

  test("production: HttpOnly + Secure + SameSite=None", () => {
    process.env.APP_PUBLIC_URL = "https://mosaic-server-hiae.onrender.com";
    const res = fakeRes();
    setSessionCookie(res, "tok");
    const cookie = res.headers["set-cookie"];

    // HttpOnly is what stops an XSS in the desk from reading the session.
    assert.match(cookie, /HttpOnly/);
    // SameSite=None is required because the desk origin differs from the API origin;
    // it is only honoured alongside Secure, so the two must always ship together.
    assert.match(cookie, /SameSite=None/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /^mosaic_desk_session=tok;/);
    process.env.APP_PUBLIC_URL = original;
  });

  test("local dev over https://localhost: still NOT Secure", () => {
    // The subtle one. env.ts REQUIRES APP_PUBLIC_URL to be https even locally, so a
    // naive `startsWith("https://")` check marks the dev cookie Secure - and the
    // browser then silently drops it over the http:// the dev server actually serves,
    // which presents as "login worked but I'm still logged out". isProductionUrl()
    // excludes localhost precisely so this can't happen.
    process.env.APP_PUBLIC_URL = "https://localhost:3210";
    const res = fakeRes();
    setSessionCookie(res, "tok");
    const cookie = res.headers["set-cookie"];

    assert.match(cookie, /HttpOnly/);
    assert.doesNotMatch(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
    process.env.APP_PUBLIC_URL = original;
  });

  test("127.0.0.1 is treated as local too", () => {
    process.env.APP_PUBLIC_URL = "https://127.0.0.1:3210";
    const res = fakeRes();
    setSessionCookie(res, "tok");
    assert.doesNotMatch(res.headers["set-cookie"], /Secure/);
    process.env.APP_PUBLIC_URL = original;
  });

  test("clearing expires the cookie immediately", () => {
    const res = fakeRes();
    clearSessionCookie(res);
    assert.match(res.headers["set-cookie"], /Max-Age=0/);
    assert.match(res.headers["set-cookie"], /HttpOnly/);
  });
});
