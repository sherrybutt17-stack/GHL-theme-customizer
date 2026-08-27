/**
 * How long a client may wait for their FIRST human reply.
 *
 * Two decisions carry this file.
 *
 * FIRST RESPONSE ONLY, deliberately. The breach check runs against conversations whose
 * `firstAgentReplyAt` is still null, so the clock stops the instant we reply and can
 * never keep escalating a ticket where the ball is in the client's court. A
 * next-response SLA would need to know whether we are waiting on them or they are
 * waiting on us — which is derivable (the newest message's role) but is not the same
 * measurement, and conflating the two produces an automation that punishes us for a
 * client who took the weekend to answer.
 *
 * COUNTED IN THE AGENCY'S OPEN HOURS, never wall clock. Against the wall, a ticket
 * raised at 9pm on a 4-hour SLA breaches at 1am, escalates a tier, breaches again, and
 * arrives at tier 3 by morning without one human having had the chance to answer it —
 * so the desk opens every day to a backlog manufactured entirely by the clock, and
 * learns to ignore the alerts. Counted in open hours it breaches mid-morning, once,
 * with somebody there to act.
 *
 * When the hours are missing or unusable we fall back to wall clock rather than
 * skipping the check. Unknown must not mean "the SLA never elapses": an SLA nobody is
 * watching is the thing this exists to prevent, so the conservative direction here is
 * to measure it crudely rather than not at all.
 */

import { openMinutesBetween } from "./businessHours";

export type TicketPriorityKey = "low" | "normal" | "high" | "urgent";

/**
 * Defaults an agency that has never opened the setting still gets.
 *
 * Spread wide on purpose: if `urgent` and `normal` are close together, priority stops
 * changing anything and the field becomes decoration.
 */
export const DEFAULT_SLA_MINUTES: Record<TicketPriorityKey, number> = {
  urgent: 15,
  high: 60,
  normal: 240,
  low: 480,
};

const PRIORITIES: TicketPriorityKey[] = ["low", "normal", "high", "urgent"];

/** Bounds a stored value: an SLA of 0 fires instantly and forever, which is not an SLA. */
const MIN_MINUTES = 5;
const MAX_MINUTES = 60 * 24 * 14;

/**
 * Read a stored `SupportConfig.slaFirstResponseMins` into a complete policy.
 *
 * Missing or malformed entries fall back PER KEY rather than discarding the whole
 * object, so an agency who set only `urgent` keeps a working policy for the rest.
 */
export function resolveSlaPolicy(stored: unknown): Record<TicketPriorityKey, number> {
  const out = { ...DEFAULT_SLA_MINUTES };
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return out;
  const raw = stored as Record<string, unknown>;
  for (const key of PRIORITIES) {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const rounded = Math.round(value);
    if (rounded < MIN_MINUTES || rounded > MAX_MINUTES) continue;
    out[key] = rounded;
  }
  return out;
}

/**
 * Validate a submitted policy for storage, or explain what's wrong.
 *
 * Returns `undefined` for "leave it alone" and `null` for "clear it", matching the
 * convention the support PUT already uses for `businessHours`.
 */
export function validateSlaPolicy(
  input: unknown
): { ok: true; value: Record<string, number> | null | undefined } | { ok: false; error: string } {
  if (input === undefined) return { ok: true, value: undefined };
  if (input === null) return { ok: true, value: null };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Response targets must be an object of priority to minutes." };
  }
  const raw = input as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!PRIORITIES.includes(key as TicketPriorityKey)) {
      return { ok: false, error: `"${key}" is not a priority.` };
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: `The target for "${key}" must be a number of minutes.` };
    }
    const rounded = Math.round(value);
    if (rounded < MIN_MINUTES || rounded > MAX_MINUTES) {
      return {
        ok: false,
        error: `The target for "${key}" must be between ${MIN_MINUTES} minutes and 14 days.`,
      };
    }
    out[key] = rounded;
  }
  return { ok: true, value: out };
}

export interface SlaCheck {
  /** Minutes of OPEN time the client has been waiting. */
  elapsedMinutes: number;
  targetMinutes: number;
  breached: boolean;
  /** True when we could not read the agency's hours and fell back to wall clock. */
  wallClockFallback: boolean;
}

/**
 * Has this ticket blown its first-response target?
 *
 * `since` is `queuedAt` — when it entered the HUMAN queue — never `startedAt`. Measuring
 * from the start of the chat counts every minute the client spent happily talking to the
 * bot as time they were kept waiting, which is the same error `supportStats` already had
 * to correct: it made the bot being useful look like the desk being slow.
 */
export function checkFirstResponseSla(input: {
  since: Date;
  now: Date;
  priority: string;
  policy: Record<TicketPriorityKey, number>;
  businessHours: unknown;
}): SlaCheck {
  const key = (PRIORITIES.includes(input.priority as TicketPriorityKey)
    ? input.priority
    : "normal") as TicketPriorityKey;
  const targetMinutes = input.policy[key];

  const open = openMinutesBetween(input.businessHours, input.since, input.now);
  const wallClockFallback = open == null;
  const elapsedMinutes =
    open ?? Math.max(0, Math.round((input.now.getTime() - input.since.getTime()) / 60_000));

  return {
    elapsedMinutes,
    targetMinutes,
    breached: elapsedMinutes >= targetMinutes,
    wallClockFallback,
  };
}
