import { test } from "node:test";
import assert from "node:assert/strict";
import { connectHint, isOpenNow, nextOpeningLabel } from "./businessHours";

/**
 * The rule under test is "never invent a duration". Every case here is really asking the
 * same question: when we do not know, do we say nothing, or do we reassure?
 */

const NINE_TO_FIVE = {
  tz: "America/New_York",
  days: {
    mon: [9, 17], tue: [9, 17], wed: [9, 17], thu: [9, 17], fri: [9, 17],
    sat: null, sun: null,
  },
} as const;

/** 2026-08-17 is a Monday. 14:00 UTC = 10am in New York (EDT). */
const MONDAY_10AM_ET = new Date("2026-08-17T14:00:00Z");
/** 2026-08-17 02:00 UTC = 10pm Sunday in New York. */
const SUNDAY_10PM_ET = new Date("2026-08-17T02:00:00Z");
/** 2026-08-18 01:00 UTC = 9pm Monday in New York. */
const MONDAY_9PM_ET = new Date("2026-08-18T01:00:00Z");

test("open during the working day, closed at the weekend", () => {
  assert.equal(isOpenNow(NINE_TO_FIVE, MONDAY_10AM_ET), true);
  assert.equal(isOpenNow(NINE_TO_FIVE, SUNDAY_10PM_ET), false);
  assert.equal(isOpenNow(NINE_TO_FIVE, MONDAY_9PM_ET), false);
});

test("the timezone is the AGENCY's, not the server's", () => {
  // The same instant is a working Monday morning in New York and the middle of the night
  // in Tokyo. Reading the server's clock would tell half the world the wrong thing.
  const tokyo = { ...NINE_TO_FIVE, tz: "Asia/Tokyo" };
  assert.equal(isOpenNow(NINE_TO_FIVE, MONDAY_10AM_ET), true);
  assert.equal(isOpenNow(tokyo, MONDAY_10AM_ET), false);
});

test("next opening reads the way a person would say it", () => {
  assert.equal(nextOpeningLabel(NINE_TO_FIVE, MONDAY_9PM_ET), "at 9am tomorrow");
  assert.equal(nextOpeningLabel(NINE_TO_FIVE, SUNDAY_10PM_ET), "at 9am tomorrow");
  // Friday evening has to skip the closed weekend rather than saying "tomorrow".
  const fridayEvening = new Date("2026-08-22T01:00:00Z"); // 9pm Friday ET
  assert.equal(nextOpeningLabel(NINE_TO_FIVE, fridayEvening), "at 9am on Monday");
});

test("an all-closed week has no next opening, and says so by returning null", () => {
  const never = { tz: "America/New_York", days: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } };
  assert.equal(nextOpeningLabel(never, MONDAY_10AM_ET), null);
});

test("a measured estimate wins - the hint stays quiet rather than stacking two claims", () => {
  const hint = connectHint({ estimatedWaitSeconds: 180, capacity: 4, businessHours: NINE_TO_FIVE, now: MONDAY_10AM_ET });
  assert.equal(hint, null);
});

test("nobody on the desk, hours known: say when they are back", () => {
  const hint = connectHint({ estimatedWaitSeconds: null, capacity: 0, businessHours: NINE_TO_FIVE, now: MONDAY_9PM_ET });
  assert.equal(hint, "The team is back at 9am tomorrow.");
});

test("nobody on the desk and NO hours configured: say nothing at all", () => {
  // The case the whole file exists for. We do not know when anyone will be there, and
  // "someone will be right with you" is the promise people remember and quote back.
  assert.equal(connectHint({ estimatedWaitSeconds: null, capacity: 0, businessHours: null, now: MONDAY_9PM_ET }), null);
});

test("somebody IS on the desk: that is a fact about now, not a prediction", () => {
  const hint = connectHint({ estimatedWaitSeconds: null, capacity: 3, businessHours: NINE_TO_FIVE, now: MONDAY_10AM_ET });
  assert.equal(hint, "Someone from the team is here and will pick this up.");
});

test("a real agent outside the posted hours beats the posted hours", () => {
  // Somebody working late is a stronger fact than a schedule typed in once, and telling
  // a client "we're back at 9am" while an agent is reading their message is a worse
  // failure than the silence this replaced.
  const hint = connectHint({ estimatedWaitSeconds: null, capacity: 2, businessHours: NINE_TO_FIVE, now: MONDAY_9PM_ET });
  assert.equal(hint, "Someone from the team is still here and will pick this up.");
});

test("an unusable timezone means UNKNOWN, never closed", () => {
  const broken = { tz: "Not/AZone", days: { mon: [9, 17] } };
  assert.equal(isOpenNow(broken, MONDAY_10AM_ET), null);
  assert.equal(nextOpeningLabel(broken, MONDAY_10AM_ET), null);
  // ...and with nobody on the desk that has to produce silence, not a guess.
  assert.equal(connectHint({ estimatedWaitSeconds: null, capacity: 0, businessHours: broken, now: MONDAY_10AM_ET }), null);
});

test("a malformed day slot is closed, not crashed", () => {
  const junk = { tz: "America/New_York", days: { mon: [17, 9] as any, tue: "9-5" as any } };
  assert.equal(isOpenNow(junk, MONDAY_10AM_ET), false);
});
