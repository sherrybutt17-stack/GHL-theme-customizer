import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CircuitBreaker } from "./circuitBreaker";

/** A controllable clock — a breaker test that sleeps is a slow, flaky test. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("CircuitBreaker", () => {
  test("a key is closed until it fails", () => {
    const clock = fakeClock();
    const b = new CircuitBreaker(10_000, 500, clock.now);
    assert.equal(b.isOpen("agency-a"), false);
    b.open("agency-a");
    assert.equal(b.isOpen("agency-a"), true);
  });

  test("ONE agency's failure does not degrade another — the bug this replaced", () => {
    const clock = fakeClock();
    const b = new CircuitBreaker(10_000, 500, clock.now);
    b.open("agency-a");
    assert.equal(b.isOpen("agency-a"), true);
    // With the old process-global `dbDownUntil`, this was true too, and every other
    // agency served stale CSS because of one tenant's bad data.
    assert.equal(b.isOpen("agency-b"), false);
    assert.equal(b.isOpen("agency-c"), false);
  });

  test("closing one key leaves other open keys alone", () => {
    const clock = fakeClock();
    const b = new CircuitBreaker(10_000, 500, clock.now);
    b.open("agency-a");
    b.open("agency-b");
    b.close("agency-a");
    assert.equal(b.isOpen("agency-a"), false);
    assert.equal(b.isOpen("agency-b"), true, "a success for A must not un-degrade B");
  });

  test("the first request after the cooldown is let through as a recovery probe", () => {
    const clock = fakeClock();
    const b = new CircuitBreaker(10_000, 500, clock.now);
    b.open("agency-a");

    clock.advance(9_999);
    assert.equal(b.isOpen("agency-a"), true, "still inside the cooldown");

    clock.advance(1);
    assert.equal(b.isOpen("agency-a"), false, "cooldown elapsed — probe for recovery");
    // The probe consumed the entry, so recovery needs no restart and no manual reset.
    assert.equal(b.size, 0);
  });

  test("a failed probe re-opens for a fresh cooldown", () => {
    const clock = fakeClock();
    const b = new CircuitBreaker(10_000, 500, clock.now);
    b.open("agency-a");
    clock.advance(10_000);
    assert.equal(b.isOpen("agency-a"), false); // probe let through
    b.open("agency-a"); // probe failed
    clock.advance(9_000);
    assert.equal(b.isOpen("agency-a"), true, "still degraded 9s into the new cooldown");
  });

  test("re-opening an already-open key extends its cooldown from now", () => {
    const clock = fakeClock();
    const b = new CircuitBreaker(10_000, 500, clock.now);
    b.open("agency-a");
    clock.advance(8_000);
    b.open("agency-a");
    clock.advance(3_000); // 11s from the first failure, 3s from the second
    assert.equal(b.isOpen("agency-a"), true);
  });

  test("the entry cap is enforced, and clearing fails OPEN (nobody degraded)", () => {
    const clock = fakeClock();
    const b = new CircuitBreaker(10_000, 3, clock.now);
    b.open("a");
    b.open("b");
    b.open("c");
    assert.equal(b.size, 3);
    b.open("d"); // at the cap: clear, then record
    assert.equal(b.size, 1);
    assert.equal(b.isOpen("d"), true);
    // Everything else is now un-degraded rather than arbitrarily half-degraded — the
    // safe direction, since a full map means something is wrong with the id space.
    assert.equal(b.isOpen("a"), false);
  });

  test("re-opening a key already in the map does not trip the cap clear", () => {
    const clock = fakeClock();
    const b = new CircuitBreaker(10_000, 3, clock.now);
    b.open("a");
    b.open("b");
    b.open("c");
    b.open("a"); // already present — must not wipe b and c
    assert.equal(b.size, 3);
    assert.equal(b.isOpen("b"), true);
  });
});
