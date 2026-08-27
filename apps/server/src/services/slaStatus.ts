/**
 * How a waiting ticket stands against its agency's response target — resolved ONCE and
 * read by everything that shows or acts on it.
 *
 * WHY THIS EXISTS AS A SERVICE. The desk had two staleness heuristics of its own: the
 * inbox reddened a row after 60 minutes, the queue board after 60 and again after 240,
 * both wall clock, both identical for every agency and every priority. Then the
 * automations arrived with a real target — per priority, configurable, and counted in the
 * agency's OPEN hours — and the three disagreed:
 *
 *   - an `urgent` ticket on a 15-minute target sat GREEN on both screens for 59 minutes,
 *     while the automation had already breached it, raised a tier and unassigned it. The
 *     agent's own list said the thing was fine;
 *   - overnight the reverse — every row turned red by 4am while the automation correctly
 *     did nothing, because none of those minutes were open hours. A colour that cries
 *     wolf every morning is one people stop reading, which is the failure mode the SLA
 *     itself is careful to avoid.
 *
 * `deskQueue.ts` already carries this lesson for ordering: ONE definition of queue order,
 * read by the pop, the distribute and the client's position line, "because two definitions
 * drift and nobody can see both screens at once to notice". Lateness is the same fact and
 * gets the same treatment.
 *
 * It must be computed HERE and not in the browser: the target lives on the agency's
 * SupportConfig and the clock runs in their business hours, and the desk knows neither.
 */

import { prisma } from "./prisma";
import { checkFirstResponseSla, resolveSlaPolicy, type SlaCheck } from "./ticketSla";

export interface SlaStatus extends SlaCheck {
  /** 0..1+ — how much of the target has been used. Lets a UI warn BEFORE the breach. */
  usedFraction: number;
}

/** The fields any caller must supply. Deliberately structural, so route selects stay lean. */
export interface SlaSubject {
  id: string;
  agencyInstallId: string;
  priority: string;
  queuedAt: Date | null;
  firstAgentReplyAt: Date | null;
}

/**
 * Status per conversation, or NULL where no clock is running.
 *
 * Null is a real answer and not an absence: a conversation that was never escalated has
 * no first-response target at all, and one a human has already answered has stopped its
 * clock for good. Returning zero for those would paint "0 of 240 minutes" on a ticket
 * that is not waiting on us, which is worse than saying nothing.
 */
export async function slaStatusFor(
  subjects: SlaSubject[],
  now: Date = new Date()
): Promise<Map<string, SlaStatus | null>> {
  const out = new Map<string, SlaStatus | null>();
  for (const s of subjects) out.set(s.id, null);

  const running = subjects.filter((s) => s.queuedAt && !s.firstAgentReplyAt);
  if (running.length === 0) return out;

  // One config read per AGENCY, never per ticket: the desk inbox is cross-agency by
  // design and a page of 100 rows would otherwise be 100 queries for a colour.
  const configs = new Map<string, { sla: unknown; hours: unknown }>();
  for (const agencyInstallId of new Set(running.map((s) => s.agencyInstallId))) {
    const cfg = await prisma.supportConfig.findUnique({
      where: { agencyInstallId },
      select: { slaFirstResponseMins: true, businessHours: true },
    });
    configs.set(agencyInstallId, { sla: cfg?.slaFirstResponseMins, hours: cfg?.businessHours });
  }

  for (const s of running) {
    const cfg = configs.get(s.agencyInstallId);
    const check = checkFirstResponseSla({
      since: s.queuedAt!,
      now,
      priority: s.priority,
      policy: resolveSlaPolicy(cfg?.sla),
      businessHours: cfg?.hours,
    });
    out.set(s.id, {
      ...check,
      usedFraction: check.targetMinutes > 0 ? check.elapsedMinutes / check.targetMinutes : 0,
    });
  }
  return out;
}

/**
 * The shape sent to a screen. Trimmed on purpose — a desk row needs to know how late
 * something is, not to re-derive it.
 */
export function serialiseSla(status: SlaStatus | null) {
  if (!status) return null;
  return {
    targetMinutes: status.targetMinutes,
    elapsedMinutes: status.elapsedMinutes,
    breached: status.breached,
    usedFraction: Math.round(status.usedFraction * 100) / 100,
    /**
     * Stated, because it changes what the number MEANS. With hours configured this is
     * open minutes and an overnight wait barely moves it; without them it is wall clock.
     * A UI that does not say which is showing two different measurements in one column.
     */
    inOpenHours: !status.wallClockFallback,
  };
}
