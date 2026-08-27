import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyModelFailure, MODEL_REMEDY, isPermanentModelFailure } from "./modelFailure";

/**
 * Five model failures that look identical to a client — deliberately, since a customer's
 * chat window inside their CRM is no place for `insufficient_quota` — and identical to the
 * AGENCY too, on the dry run, which is the go-live gate.
 *
 * Measured on this repo's own account 2026-08-26: the key was set and valid, the credits
 * were gone, and the deployment note's advice ("if all six answers are hand-offs, the key
 * is missing") sent the reader to check the one thing that was fine.
 */

/** What the OpenAI SDK actually throws, shaped as it arrives. */
function apiError(status: number, type: string, message: string) {
  return Object.assign(new Error(message), { status, error: { type, message } });
}

describe("classifying a model failure", () => {
  test("our own guard, thrown before any request is made", () => {
    assert.equal(
      classifyModelFailure(new Error("OPENAI_API_KEY is not set; the support bot cannot answer.")),
      "not-configured"
    );
  });

  test("NO CREDITS is a 429 and must not be read as a rate limit", () => {
    // The real one, verbatim. Both are 429s and they need opposite actions: one clears on
    // its own, the other never does.
    assert.equal(
      classifyModelFailure(
        apiError(429, "insufficient_quota", "429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.")
      ),
      "no-credits"
    );
    assert.equal(
      classifyModelFailure(apiError(429, "insufficient_quota", "You exceeded your current quota, please check your plan and billing details.")),
      "no-credits"
    );
  });

  test("…and an ordinary 429 still is one", () => {
    assert.equal(classifyModelFailure(apiError(429, "rate_limit_exceeded", "Rate limit reached for requests")), "rate-limited");
  });

  test("a rejected key is its own answer, because replacing it is the remedy", () => {
    assert.equal(classifyModelFailure(apiError(401, "invalid_request_error", "Incorrect API key provided")), "auth");
    assert.equal(classifyModelFailure(apiError(403, "permission_error", "Project does not have access to model")), "auth");
  });

  test("5xx, timeouts and sockets are transient and must keep retrying", () => {
    assert.equal(classifyModelFailure(apiError(500, "server_error", "The server had an error")), "transient");
    assert.equal(classifyModelFailure(apiError(503, "server_error", "Service unavailable")), "transient");
    assert.equal(classifyModelFailure(new Error("connect ETIMEDOUT 1.2.3.4:443")), "transient");
    assert.equal(classifyModelFailure(new Error("socket hang up")), "transient");
  });

  test("anything unrecognisable is transient, never a billing instruction", () => {
    // The dangerous direction: telling an operator to go and add credits to an account
    // that is fine, over a message nobody had seen before.
    assert.equal(classifyModelFailure(undefined), "transient");
    assert.equal(classifyModelFailure("something odd"), "transient");
    assert.equal(classifyModelFailure({}), "transient");
  });

  test("a nested response.status is read too, since not every client shape is the same", () => {
    const axiosish = Object.assign(new Error("Request failed"), { response: { status: 401 } });
    assert.equal(classifyModelFailure(axiosish), "auth");
  });

  test("PERMANENT is the half that decides whether 'try again' is honest advice", () => {
    for (const kind of ["not-configured", "auth", "no-credits"] as const) {
      assert.equal(isPermanentModelFailure(kind), true, kind);
    }
    for (const kind of ["rate-limited", "transient"] as const) {
      assert.equal(isPermanentModelFailure(kind), false, kind);
    }
  });

  test("every kind carries a remedy the reader can carry out", () => {
    for (const [kind, remedy] of Object.entries(MODEL_REMEDY)) {
      assert.ok(remedy.length > 40, `${kind} has no real remedy`);
      // A remedy that only restates the fault is the line people learn to skim.
      assert.ok(/OPENAI_API_KEY|credits|key|again|log/i.test(remedy), `${kind}: ${remedy}`);
    }
  });
});
