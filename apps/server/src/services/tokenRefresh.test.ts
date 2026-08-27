import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyRefreshFailure } from "./tokenFailure";

/**
 * Three failures that look identical in a log and need three different humans.
 *
 * Before this they were one line, repeated every 30 minutes per broken agency, forever
 * — which is how 18 identical errors sat in a dev log all session without anyone
 * (including me) reading them as anything. The classification is what turns "refresh
 * failed" into "somebody regenerated the encryption key".
 */
describe("classifying a refresh failure", () => {
  test("Node's AES-GCM auth-tag failure is a KEY problem, not an agency problem", () => {
    // This is the exact message a wrong TOKEN_ENCRYPTION_KEY produces. scrypt →
    // AES-256-GCM throws rather than returning nonsense, which is the property that
    // makes regenerating the key unrecoverable rather than merely wrong.
    assert.equal(
      classifyRefreshFailure(new Error("Unsupported state or unable to authenticate data")),
      "decrypt"
    );
    assert.equal(classifyRefreshFailure(new Error("error:1C800064:bad decrypt")), "decrypt");
  });

  test("invalid_grant means the agency must re-authorise — retrying can never fix it", () => {
    const err = Object.assign(new Error("Request failed with status code 400"), {
      response: { status: 400, data: { error: "invalid_grant" } },
    });
    assert.equal(classifyRefreshFailure(err), "revoked");
  });

  test("a bare 401 from the token endpoint is also permanent", () => {
    const err = Object.assign(new Error("Unauthorized"), { response: { status: 401, data: {} } });
    assert.equal(classifyRefreshFailure(err), "revoked");
  });

  test("a 5xx or a network error is TRANSIENT and must keep retrying", () => {
    // Misclassifying one of these as permanent would silently stop retrying an agency
    // whose only problem was that GHL had a bad minute.
    const server = Object.assign(new Error("Request failed with status code 503"), {
      response: { status: 503, data: {} },
    });
    assert.equal(classifyRefreshFailure(server), "transient");
    assert.equal(classifyRefreshFailure(new Error("ECONNRESET")), "transient");
    assert.equal(classifyRefreshFailure(new Error("timeout of 10000ms exceeded")), "transient");
  });

  test("an unrecognisable failure defaults to transient, not permanent", () => {
    // The safe default: keep trying. Defaulting to permanent would give up on an
    // agency because of a message nobody had seen before.
    assert.equal(classifyRefreshFailure(undefined), "transient");
    assert.equal(classifyRefreshFailure("something odd"), "transient");
  });
});
