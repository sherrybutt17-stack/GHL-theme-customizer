import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { encryptToken, decryptToken } from "./tokenCrypto";

/**
 * The OAuth tokens for every agency, at rest. Untested until now, on a module CLAUDE.md
 * builds a deployment rule around: *"`TOKEN_ENCRYPTION_KEY` must never be regenerated
 * against an existing database … the auth tag means a wrong key THROWS, so every agency
 * silently has to re-authorise."*
 *
 * That sentence is the whole reason `tokenFailure.ts` can tell `decrypt` from `revoked`
 * from `transient` — and it is a claim about AES-GCM's behaviour that nothing here checked.
 * If a wrong key ever returned GARBAGE instead of throwing, the refresh loop would send
 * rubbish to GHL and read the answer as a revocation, which is the one classification that
 * tells an operator the agency must re-authorise when in fact the key is simply wrong.
 */
const KEY = "an-example-token-encryption-key-0123456789";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
});
afterEach(() => {
  if (saved === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
  else process.env.TOKEN_ENCRYPTION_KEY = saved;
});

describe("tokenCrypto", () => {
  test("a token round-trips", () => {
    const token = "ghl_access_token_" + "x".repeat(200);
    assert.equal(decryptToken(encryptToken(token)), token);
  });

  test("non-ASCII survives, since GHL tokens are opaque", () => {
    const token = "tøken-ünicode-🔐-" + "y".repeat(50);
    assert.equal(decryptToken(encryptToken(token)), token);
  });

  test("the same token encrypts differently every time", () => {
    // A random IV per encryption. Identical ciphertexts would let anyone reading the
    // database see which agencies share a token, and would break GCM outright.
    const a = encryptToken("same");
    const b = encryptToken("same");
    assert.notEqual(a, b);
    assert.equal(decryptToken(a), "same");
    assert.equal(decryptToken(b), "same");
  });

  test("A WRONG KEY THROWS — it does not return garbage", () => {
    // The deployment rule rests entirely on this. Regenerating the key against an existing
    // database must fail loudly per agency, not hand the refresh loop a plausible string.
    const sealed = encryptToken("ghl_access_token");
    process.env.TOKEN_ENCRYPTION_KEY = KEY + "-different";
    assert.throws(() => decryptToken(sealed));
  });

  test("a tampered ciphertext throws", () => {
    const raw = Buffer.from(encryptToken("ghl_access_token"), "base64");
    raw[raw.length - 1] ^= 0xff;
    assert.throws(() => decryptToken(raw.toString("base64")));
  });

  test("a tampered auth tag throws", () => {
    // The tag sits at bytes 12..28 — flipping it must not be recoverable either.
    const raw = Buffer.from(encryptToken("ghl_access_token"), "base64");
    raw[13] ^= 0xff;
    assert.throws(() => decryptToken(raw.toString("base64")));
  });

  test("a truncated value throws rather than decrypting a prefix", () => {
    const raw = Buffer.from(encryptToken("ghl_access_token"), "base64");
    assert.throws(() => decryptToken(raw.subarray(0, raw.length - 4).toString("base64")));
    assert.throws(() => decryptToken(""));
  });

  test("a missing key is refused by name, not by a confusing crypto error", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    assert.throws(() => encryptToken("x"), /TOKEN_ENCRYPTION_KEY/);
    assert.throws(() => decryptToken("x"), /TOKEN_ENCRYPTION_KEY/);
  });
});
