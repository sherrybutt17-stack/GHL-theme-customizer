import { test } from "node:test";
import assert from "node:assert/strict";
import { openMinutesBetween } from "./businessHours";
import {
  checkFirstResponseSla,
  resolveSlaPolicy,
  validateSlaPolicy,
  DEFAULT_SLA_MINUTES,
} from "./ticketSla";

/**
 * The question behind every case here: does the SLA clock run when the desk is actually
 * open?
 *
 * Measured against the wall, a ticket raised at 9pm on a 4-hour target breaches at 1am,
 * escalates a tier, breaches again, and reaches tier 3 before anyone arrives — so the
 * desk opens every morning to a backlog manufactured entirely by the clock, and quickly
 * learns to ignore the alerts. That is the failure these tests exist to prevent.
 */

const NINE_TO_FIVE = {
  tz: "America/New_York",
  days: {
    mon: [9, 17], tue: [9, 17], wed: [9, 17], thu: [9, 17], fri: [9, 17],
    sat: null, sun: null,
  },
} as const;

/** 2026-08-17 is a Monday. 13:00 UTC = 9am New York (EDT). */
const MON_9AM = new Date("2026-08-17T13:00:00Z");
const MON_11AM = new Date("2026-08-17T15:00:00Z");
const MON_9PM = new Date("2026-08-18T01:00:00Z");
const TUE_10AM = new Date("2026-08-18T14:00:00Z");

test("open minutes inside a single working day are just elapsed minutes", () => {
  assert.equal(openMinutesBetween(NINE_TO_FIVE, MON_9AM, MON_11AM), 120);
});

test("the clock stops when the desk closes", () => {
  // 9am Monday to 9pm Monday is twelve hours on the wall, but the desk shut at 5pm.
  assert.equal(openMinutesBetween(NINE_TO_FIVE, MON_9AM, MON_9PM), 8 * 60);
});

test("overnight adds nothing, and the next morning resumes", () => {
  // 9pm Monday -> 10am Tuesday: thirteen hours on the wall, one open hour.
  assert.equal(openMinutesBetween(NINE_TO_FIVE, MON_9PM, TUE_10AM), 60);
});

test("a weekend contributes zero", () => {
  const friday5pm = new Date("2026-08-21T21:00:00Z");
  const monday9am = new Date("2026-08-24T13:00:00Z");
  assert.equal(openMinutesBetween(NINE_TO_FIVE, friday5pm, monday9am), 0);
});

test("unknown hours are NULL, never zero", () => {
  // Null must read as "we don't know" so the caller falls back to wall clock. Zero would
  // mean the SLA never elapses, i.e. an alert nobody ever gets — the exact silence the
  // automation exists to break.
  assert.equal(openMinutesBetween(null, MON_9AM, MON_11AM), null);
  assert.equal(openMinutesBetween({ tz: "Not/AZone", days: { mon: [9, 17] } }, MON_9AM, MON_11AM), null);
});

test("a backwards interval is zero, not negative", () => {
  assert.equal(openMinutesBetween(NINE_TO_FIVE, MON_11AM, MON_9AM), 0);
});

test("the same instant is open in one timezone and shut in another", () => {
  // The case a single-timezone test can never catch: 9am in New York is 10pm in Tokyo.
  const tokyo = { tz: "Asia/Tokyo", days: { ...NINE_TO_FIVE.days } };
  assert.equal(openMinutesBetween(NINE_TO_FIVE, MON_9AM, MON_11AM), 120);
  assert.equal(openMinutesBetween(tokyo, MON_9AM, MON_11AM), 0);
});

test("a DST transition does not shift the working day", () => {
  // US DST ends 2026-11-01. The Monday after must still be exactly eight open hours,
  // which is what the offset-refinement pass in zonedToUtc is there for — a naive fixed
  // offset is an hour out on precisely the days somebody would notice.
  const monOpen = new Date("2026-11-02T14:00:00Z"); // 9am EST
  const monShut = new Date("2026-11-02T22:00:00Z"); // 5pm EST
  assert.equal(openMinutesBetween(NINE_TO_FIVE, monOpen, monShut), 8 * 60);
});

test("a breach is measured in OPEN minutes, so an overnight wait does not escalate", () => {
  const raisedAt9pm = MON_9PM;
  const checkedAt8amNextDay = new Date("2026-08-18T12:00:00Z"); // 8am ET, desk still shut

  const openHours = checkFirstResponseSla({
    since: raisedAt9pm,
    now: checkedAt8amNextDay,
    priority: "normal", // 240 minutes
    policy: DEFAULT_SLA_MINUTES,
    businessHours: NINE_TO_FIVE,
  });
  assert.equal(openHours.elapsedMinutes, 0);
  assert.equal(openHours.breached, false, "nobody was on the desk, so nothing was missed");

  // The same ticket, judged on the wall clock, would have blown a 4-hour target twice
  // over — which is the bug, stated as an assertion.
  const wallClock = checkFirstResponseSla({
    since: raisedAt9pm,
    now: checkedAt8amNextDay,
    priority: "normal",
    policy: DEFAULT_SLA_MINUTES,
    businessHours: null,
  });
  assert.equal(wallClock.breached, true);
  assert.equal(wallClock.wallClockFallback, true);
});

test("it does breach once the desk has actually been open long enough", () => {
  const raisedAt9am = MON_9AM;
  const checkedAt2pm = new Date("2026-08-17T18:00:00Z"); // 2pm ET, five open hours later
  const check = checkFirstResponseSla({
    since: raisedAt9am,
    now: checkedAt2pm,
    priority: "normal",
    policy: DEFAULT_SLA_MINUTES,
    businessHours: NINE_TO_FIVE,
  });
  assert.equal(check.elapsedMinutes, 300);
  assert.equal(check.breached, true);
});

test("priority changes the target", () => {
  const base = {
    since: MON_9AM,
    now: new Date("2026-08-17T13:30:00Z"), // 30 open minutes
    policy: DEFAULT_SLA_MINUTES,
    businessHours: NINE_TO_FIVE,
  };
  assert.equal(checkFirstResponseSla({ ...base, priority: "urgent" }).breached, true);
  assert.equal(checkFirstResponseSla({ ...base, priority: "normal" }).breached, false);
});

test("an unknown priority falls back to normal rather than throwing", () => {
  const check = checkFirstResponseSla({
    since: MON_9AM,
    now: MON_11AM,
    priority: "catastrophic",
    policy: DEFAULT_SLA_MINUTES,
    businessHours: NINE_TO_FIVE,
  });
  assert.equal(check.targetMinutes, DEFAULT_SLA_MINUTES.normal);
});

test("a stored policy falls back PER KEY, not all-or-nothing", () => {
  // An agency who set only `urgent` must keep a working policy for everything else.
  const policy = resolveSlaPolicy({ urgent: 5, high: "soon", normal: -3 });
  assert.equal(policy.urgent, 5);
  assert.equal(policy.high, DEFAULT_SLA_MINUTES.high, "a non-number is ignored");
  assert.equal(policy.normal, DEFAULT_SLA_MINUTES.normal, "an out-of-range value is ignored");
  assert.equal(policy.low, DEFAULT_SLA_MINUTES.low);
});

test("garbage in the column does not take the SLA down with it", () => {
  assert.deepEqual(resolveSlaPolicy(null), DEFAULT_SLA_MINUTES);
  assert.deepEqual(resolveSlaPolicy("nope"), DEFAULT_SLA_MINUTES);
  assert.deepEqual(resolveSlaPolicy([1, 2, 3]), DEFAULT_SLA_MINUTES);
});

test("validation distinguishes leave-alone from clear", () => {
  assert.deepEqual(validateSlaPolicy(undefined), { ok: true, value: undefined });
  assert.deepEqual(validateSlaPolicy(null), { ok: true, value: null });
});

test("validation refuses a target of zero", () => {
  // Zero fires instantly and forever, which is not an SLA — it is a permanent alarm.
  const result = validateSlaPolicy({ urgent: 0 });
  assert.equal(result.ok, false);
});

test("validation refuses an unknown priority rather than silently dropping it", () => {
  const result = validateSlaPolicy({ blocker: 10 });
  assert.equal(result.ok, false);
  // Silently ignoring it would let an agency save a policy, see it accepted, and get
  // none of the behaviour they asked for.
  if (!result.ok) assert.match(result.error, /blocker/);
});
