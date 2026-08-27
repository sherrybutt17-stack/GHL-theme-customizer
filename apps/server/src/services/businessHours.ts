/**
 * "How long until somebody picks this up?" — answered honestly, or not at all.
 *
 * `estimateWaitSeconds` deliberately returns null when it would be inventing a number:
 * fewer than five measured responses, or nobody on the desk. That rule is right and it
 * left the most common case saying NOTHING — a client who escalates outside working
 * hours sees "You're number 1 in line" and no indication whether that means two minutes
 * or Monday. Silence there is not caution, it is the worst version of the promise: they
 * sit and refresh.
 *
 * Business hours are a fact the agency has already told us, so this turns them into the
 * one sentence that is always true — "the team is back at 9am tomorrow" — without
 * predicting anything. It never manufactures a duration; where it cannot say something
 * true it returns null and the widget prints nothing, exactly as before.
 *
 * The timezone is the agency's, validated through Intl at save time (a bad tz is dropped
 * rather than stored), so anything reaching here is usable.
 */

export interface BusinessHours {
  tz: string;
  /** mon..sun -> [startHour, endHour) in the agency's own timezone, or null for closed. */
  days: Record<string, [number, number] | null>;
}

/** Sunday-first, matching the order the parts formatter reports. */
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_NAMES: Record<string, string> = {
  sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday",
  thu: "Thursday", fri: "Friday", sat: "Saturday",
};

export function isBusinessHours(hours: unknown): hours is BusinessHours {
  const h = hours as BusinessHours | null;
  return !!h && typeof h.tz === "string" && !!h.tz && !!h.days && typeof h.days === "object";
}

/**
 * Where the agency's clock is right now.
 *
 * Read through Intl rather than by offsetting a UTC date, because an offset is wrong
 * twice a year and this is precisely the code that would then tell somebody the desk
 * opens an hour later than it does.
 */
function localNow(tz: string, at: Date): { dayIndex: number; hour: number; minute: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const dayIndex = DAY_KEYS.indexOf(get("weekday").toLowerCase().slice(0, 3));
    const hour = Number(get("hour")) % 24;
    const minute = Number(get("minute"));
    if (dayIndex < 0 || Number.isNaN(hour) || Number.isNaN(minute)) return null;
    return { dayIndex, hour, minute };
  } catch {
    // An unusable timezone means we know nothing about their week - which must read as
    // "say nothing", never as "closed".
    return null;
  }
}

function slotFor(hours: BusinessHours, dayIndex: number): [number, number] | null {
  const slot = hours.days[DAY_KEYS[dayIndex]];
  if (!Array.isArray(slot) || slot.length !== 2) return null;
  const [start, end] = slot;
  if (typeof start !== "number" || typeof end !== "number" || end <= start) return null;
  return [start, end];
}

export function isOpenNow(hours: unknown, at: Date = new Date()): boolean | null {
  if (!isBusinessHours(hours)) return null;
  const now = localNow(hours.tz, at);
  if (!now) return null;
  const slot = slotFor(hours, now.dayIndex);
  if (!slot) return false;
  return now.hour >= slot[0] && now.hour < slot[1];
}

/**
 * What wall-clock time does `at` read as in `tz`, expressed as a UTC-epoch offset.
 *
 * Used only by the local->UTC conversion below. Read through Intl for the same reason
 * as `localNow`: a fixed offset is wrong twice a year.
 */
function tzOffsetMs(tz: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
      hour12: false,
    }).formatToParts(at);
    const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asIfUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour") % 24, n("minute"), n("second"));
    if (Number.isNaN(asIfUtc)) return null;
    return asIfUtc - at.getTime();
  } catch {
    return null;
  }
}

/** A local wall-clock instant in `tz`, as a UTC epoch. */
function zonedToUtc(tz: string, y: number, m: number, d: number, hour: number): number | null {
  const wall = Date.UTC(y, m, d, hour);
  const first = tzOffsetMs(tz, new Date(wall));
  if (first == null) return null;
  const utc = wall - first;
  // One refinement pass: on a DST boundary the offset at the guessed instant differs
  // from the offset at the real one, and without this the answer is an hour out on
  // exactly the two days a year somebody would notice.
  const second = tzOffsetMs(tz, new Date(utc));
  if (second == null || second === first) return utc;
  return wall - second;
}

/** Guard against an unbounded walk if two timestamps are absurdly far apart. */
const MAX_SPAN_DAYS = 400;

/**
 * Minutes the desk was OPEN between two instants — the clock an SLA must run on.
 *
 * Returns null when the agency's hours are missing or unusable, which the caller must
 * read as "we do not know" and fall back to wall clock. Null must never mean zero: an
 * SLA that silently never elapses is one nobody is watching, which is the exact failure
 * the automation exists to prevent.
 *
 * Wall-clock is the wrong measure here and the difference is not academic. A ticket
 * raised at 9pm against a 4-hour SLA breaches at 1am, escalates a tier, breaches again,
 * and by the time anyone arrives it has climbed to tier 3 without a single human being
 * given the chance to answer it. Counted in open hours it breaches mid-morning, once,
 * with somebody there to act on it.
 */
export function openMinutesBetween(hours: unknown, from: Date, to: Date): number | null {
  if (!isBusinessHours(hours)) return null;
  if (to.getTime() <= from.getTime()) return 0;

  const start = localNow(hours.tz, from);
  if (!start) return null;

  // The agency-local calendar date `from` falls on, stepped forward day by day.
  const parts = (() => {
    try {
      const p = new Intl.DateTimeFormat("en-US", {
        timeZone: hours.tz, year: "numeric", month: "numeric", day: "numeric",
      }).formatToParts(from);
      const n = (t: string) => Number(p.find((x) => x.type === t)?.value);
      return { y: n("year"), m: n("month") - 1, d: n("day") };
    } catch {
      return null;
    }
  })();
  if (!parts) return null;

  let total = 0;
  for (let offset = 0; offset < MAX_SPAN_DAYS; offset++) {
    // Step in UTC and re-read the weekday locally, so month ends and DST both fall out
    // of the calendar rather than needing their own arithmetic.
    const dayUtc = new Date(Date.UTC(parts.y, parts.m, parts.d + offset, 12));
    const local = localNow(hours.tz, dayUtc);
    if (!local) return null;

    const slot = slotFor(hours, local.dayIndex);
    if (slot) {
      const openAt = zonedToUtc(hours.tz, parts.y, parts.m, parts.d + offset, slot[0]);
      const closeAt = zonedToUtc(hours.tz, parts.y, parts.m, parts.d + offset, slot[1]);
      if (openAt == null || closeAt == null) return null;
      // Intersect the day's open window with [from, to].
      const lo = Math.max(openAt, from.getTime());
      const hi = Math.min(closeAt, to.getTime());
      if (hi > lo) total += (hi - lo) / 60_000;
    }

    if (dayUtc.getTime() > to.getTime() + 36 * 3_600_000) break;
  }
  return Math.round(total);
}

function hourLabel(h: number): string {
  if (h === 0 || h === 24) return "midnight";
  if (h === 12) return "midday";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

/**
 * When the desk next opens, phrased the way a person would say it.
 *
 * Looks a week ahead and gives up rather than wrapping around forever: an agency whose
 * every day is closed has no next opening, and "back at 9am" would be a lie.
 */
export function nextOpeningLabel(hours: unknown, at: Date = new Date()): string | null {
  if (!isBusinessHours(hours)) return null;
  const now = localNow(hours.tz, at);
  if (!now) return null;

  for (let offset = 0; offset < 8; offset++) {
    const dayIndex = (now.dayIndex + offset) % 7;
    const slot = slotFor(hours, dayIndex);
    if (!slot) continue;
    // Today only counts if the opening is still ahead of us.
    if (offset === 0 && now.hour >= slot[0]) continue;
    const when = hourLabel(slot[0]);
    if (offset === 0) return `at ${when} today`;
    if (offset === 1) return `at ${when} tomorrow`;
    return `at ${when} on ${DAY_NAMES[DAY_KEYS[dayIndex]]}`;
  }
  return null;
}

/**
 * One short, TRUE line about when a person will be there — or null.
 *
 * The order matters, and each branch is a different KIND of fact:
 *   1. A measured estimate exists: the widget already prints it, so say nothing more
 *      rather than stacking two claims about the same wait.
 *   2. Nobody is on the desk: this is the case that used to be silent. If we know the
 *      hours we can say when they are back; if we do not, we say nothing rather than
 *      guessing that "someone will be right with you".
 *   3. Somebody IS on the desk but we have too few samples to time them. "A person is
 *      here" is a fact about the present, not a prediction, so it can be said safely.
 */
export function connectHint(input: {
  estimatedWaitSeconds: number | null;
  capacity: number;
  businessHours: unknown;
  now?: Date;
}): string | null {
  if (input.estimatedWaitSeconds != null) return null;

  const at = input.now ?? new Date();
  const open = isOpenNow(input.businessHours, at);

  if (input.capacity === 0) {
    const back = nextOpeningLabel(input.businessHours, at);
    if (back) return `The team is back ${back}.`;
    // No hours configured and nobody on the desk. We genuinely do not know, and an
    // invented reassurance here is the promise people remember and quote back.
    return null;
  }

  // Somebody is on the desk. If the agency's own hours say they are closed, trust the
  // desk over the calendar - a real agent being present is a stronger fact than a
  // schedule somebody typed once.
  if (open === false) return "Someone from the team is still here and will pick this up.";
  return "Someone from the team is here and will pick this up.";
}
