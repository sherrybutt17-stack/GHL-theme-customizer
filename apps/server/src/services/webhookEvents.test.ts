import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyWebhookEvent, auditPayload, retentionCutoffs } from "./webhookEvents";

/**
 * The classifier is shared by the dispatcher and the retention policy on purpose, so
 * these tests are really about one property: the two can never disagree about whether
 * this app acts on an event.
 */
describe("classifying a webhook event", () => {
  test("the events GHL actually sends", () => {
    // The vendor's own SDK switches on exactly these two bare strings.
    assert.equal(classifyWebhookEvent("INSTALL"), "install");
    assert.equal(classifyWebhookEvent("UNINSTALL"), "uninstall");
  });

  test("the granular aliases we keep defensively", () => {
    assert.equal(classifyWebhookEvent("UninstallCompany"), "uninstall");
    assert.equal(classifyWebhookEvent("UninstallLocation"), "uninstall");
    assert.equal(classifyWebhookEvent("InstallLocation"), "install");
  });

  test("sub-account churn", () => {
    assert.equal(classifyWebhookEvent("LocationCreate"), "location");
    assert.equal(classifyWebhookEvent("LocationUpdate"), "location");
    assert.equal(classifyWebhookEvent("LocationDelete"), "location");
  });

  test("everything else is unhandled", () => {
    // These carry the AGENCY'S CLIENTS' personal data. Reading one as handled is what
    // puts it in our database forever.
    assert.equal(classifyWebhookEvent("ContactCreate"), "unhandled");
    assert.equal(classifyWebhookEvent("InboundMessage"), "unhandled");
    assert.equal(classifyWebhookEvent("OpportunityStatusUpdate"), "unhandled");
    assert.equal(classifyWebhookEvent(""), "unhandled");
  });

  test("a name that merely CONTAINS install is not an install", () => {
    assert.equal(classifyWebhookEvent("ReinstallPrompt"), "unhandled");
    assert.equal(classifyWebhookEvent("AppUninstallReminder"), "unhandled");
  });

  test("a WARNING about an uninstall is not an uninstall", () => {
    // The match is anchored at both ends for this case specifically. Treating a notice
    // as the event would delete a live agency's menu link and stop their branding while
    // they are still a paying customer — off a webhook whose meaning we invented.
    for (const near of ["UninstallReminder", "UninstallScheduled", "UninstallPending", "PreUninstall"]) {
      assert.equal(classifyWebhookEvent(near), "unhandled", `${near} was read as a real uninstall`);
    }
    // ...while the three real spellings still are.
    assert.equal(classifyWebhookEvent("uninstall"), "uninstall");
    assert.equal(classifyWebhookEvent("UNINSTALL"), "uninstall");
    assert.equal(classifyWebhookEvent("UninstallCompany"), "uninstall");
  });
});

describe("what we keep of a webhook body", () => {
  const contact = {
    type: "ContactCreate",
    companyId: "co_1",
    email: "jane@aclient.example",
    phone: "+15551234567",
    firstName: "Jane",
  };

  test("an event we act on is stored in full — a failed handler needs it", () => {
    const body = { type: "UNINSTALL", companyId: "co_1" };
    assert.deepEqual(auditPayload("UNINSTALL", body), body);
  });

  test("an event we ignore keeps its SHAPE and none of its values", () => {
    const kept = auditPayload("ContactCreate", contact) as { unhandled: boolean; keys: string[] };
    assert.equal(kept.unhandled, true);
    assert.deepEqual(kept.keys, ["companyId", "email", "firstName", "phone", "type"]);
  });

  test("  -> so no personal data survives anywhere in the stored value", () => {
    // The real assertion: grep the serialised row for the values themselves. A future
    // change that keeps "just the useful fields" fails here rather than in production.
    const serialised = JSON.stringify(auditPayload("ContactCreate", contact));
    for (const secret of ["jane@aclient.example", "+15551234567", "Jane"]) {
      assert.equal(serialised.includes(secret), false, `${secret} survived into the audit row`);
    }
  });

  test("a body that isn't an object doesn't throw", () => {
    // This is untrusted input from an endpoint anyone can POST to.
    assert.deepEqual(auditPayload("ContactCreate", null), { unhandled: true, keys: [] });
    assert.deepEqual(auditPayload("ContactCreate", "nope"), { unhandled: true, keys: [] });
    assert.deepEqual(auditPayload("ContactCreate", [1, 2]), { unhandled: true, keys: [] });
  });
});

describe("retention windows", () => {
  test("failed events outlive processed ones by a long way", () => {
    const { processedBefore, failedBefore } = retentionCutoffs(new Date("2026-08-14T00:00:00Z"));
    assert.ok(failedBefore < processedBefore);
  });

  test("both windows are far longer than GHL's retry window", () => {
    // Pruning a row that is still doing its idempotency job would let a redelivery
    // re-run a handler. GHL retries over hours; the tightest window here is weeks.
    const now = new Date("2026-08-14T00:00:00Z");
    const { processedBefore } = retentionCutoffs(now);
    const days = (now.getTime() - processedBefore.getTime()) / 86_400_000;
    assert.ok(days >= 7, `processed retention is only ${days} days`);
  });
});
