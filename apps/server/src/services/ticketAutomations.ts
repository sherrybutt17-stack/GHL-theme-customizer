/**
 * The passes that make a ticket chase itself.
 *
 * WHY THIS IS A SERVICE AND NOT A TIMER. The free Render web service sleeps after ~15
 * minutes idle, so an in-process `setInterval` simply stops — and if the service ever
 * runs more than one instance, every instance would run every pass and race the same
 * rows. CLAUDE.md states the rule flatly: "A script on a schedule, never a setInterval."
 * `scripts/runTicketAutomations.ts` is the entry point and GitHub Actions is the clock,
 * exactly as `poll-feeds` already works.
 *
 * HOW EACH PASS IS MADE SAFE TO RUN TWICE. Every pass CLAIMS its right to act with a
 * conditional `updateMany`, the same idiom as `claimNext`:
 *
 *     updateMany({ where: { id, lastReminderAt: null }, data: { lastReminderAt: now } })
 *       count === 1 -> we own this notification, send it
 *       count === 0 -> another run already has it, skip
 *
 * The timestamp is the CLAIM, not a log written afterwards. Claim-then-send can lose a
 * notification if the process dies between the two; send-then-claim duplicates one, and
 * duplicates land in a real person's inbox. Email is documented here as a convenience
 * rather than the mechanism — the queue is the source of truth — so losing one is
 * plainly the better way to fail.
 *
 * WHAT IT CANNOT DO, stated rather than implied. GitHub Actions delays scheduled runs
 * under load, sometimes by many minutes. Every threshold is therefore "at least N
 * minutes", never exact, and the wording of everything this sends must match that. An
 * SLA claiming a precision the scheduler cannot deliver is worse than one that admits
 * its granularity.
 */

import { prisma } from "./prisma";
import { enterQueuePatch, MAX_TIER } from "./deskQueue";
import { slaStatusFor } from "./slaStatus";
import { notifyDeskOfEscalation } from "./email";
import { resolveBrandMap } from "./brandTerms";
import { describeError } from "./security";

/** How long an unclaimed escalation may sit before the desk is nudged. */
const UNCLAIMED_NUDGE_MINUTES = 20;
/** And how long before it is nudged AGAIN. The first one lands while people are at lunch. */
const RENUDGE_MINUTES = 60;
/** An agent holding a ticket they have not answered. */
const ASSIGNEE_NUDGE_MINUTES = 45;
/** Silence before we ask a client whether they are still there. */
const IDLE_WARN_DAYS = 3;
/** And before we stop waiting. Measured from the WARNING, not from the last message. */
const IDLE_CLOSE_DAYS = 2;

export interface AutomationOutcome {
  pass: string;
  conversationId: string;
  detail: string;
}

export interface AutomationReport {
  actions: AutomationOutcome[];
  errors: string[];
  scanned: number;
}

interface RunOptions {
  now?: Date;
  dryRun?: boolean;
}

function minutesAgo(now: Date, minutes: number): Date {
  return new Date(now.getTime() - minutes * 60_000);
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/**
 * Pass 1 — an escalation nobody has picked up.
 *
 * Re-nudges rather than firing once: the first alert routinely lands while everybody is
 * at lunch, and a single unanswered nudge is indistinguishable from no nudge at all.
 */
async function nudgeUnclaimed(now: Date, opts: RunOptions): Promise<AutomationOutcome[]> {
  const out: AutomationOutcome[] = [];
  const candidates = await prisma.conversation.findMany({
    where: {
      status: "escalated",
      assignedToId: null,
      queuedAt: { lte: minutesAgo(now, UNCLAIMED_NUDGE_MINUTES) },
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
      AND: [
        { OR: [{ lastReminderAt: null }, { lastReminderAt: { lte: minutesAgo(now, RENUDGE_MINUTES) } }] },
      ],
    },
    select: {
      id: true, queuedAt: true, lastReminderAt: true, priority: true, tier: true,
      locationInstall: { select: { ghlLocationId: true, locationName: true } },
      agencyInstall: { select: { companyName: true } },
      messages: { where: { role: "user" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
    take: 200,
  });

  for (const c of candidates) {
    if (opts.dryRun) {
      out.push({ pass: "unclaimed", conversationId: c.id, detail: "would nudge the desk" });
      continue;
    }
    // Claim: only one runner may notify for this ticket in this window.
    const { count } = await prisma.conversation.updateMany({
      where: { id: c.id, lastReminderAt: c.lastReminderAt },
      data: { lastReminderAt: now },
    });
    if (count !== 1) continue;

    const waited = c.queuedAt ? Math.round((now.getTime() - c.queuedAt.getTime()) / 60_000) : 0;
    const brand = await resolveBrandMap(c.locationInstall.ghlLocationId);
    await notifyDeskOfEscalation({
      brandName: brand?.brandName ?? "their platform",
      locationName: c.locationInstall.locationName,
      agencyName: c.agencyInstall.companyName,
      question: c.messages[0]?.body ?? "(no message recorded)",
      conversationId: c.id,
      // "At least", because the scheduler's own timing is approximate and a precise
      // number here would be a number we cannot stand behind.
      reason: `still unclaimed after at least ${waited} minutes`,
    });
    out.push({ pass: "unclaimed", conversationId: c.id, detail: `nudged after ~${waited}m` });
  }
  return out;
}

/**
 * Pass 2 — the first-response SLA.
 *
 * Only ever looks at conversations with NO agent reply yet, which is what stops it
 * punishing us for a client who took the weekend to come back: the clock stops the
 * instant a human answers.
 */
async function escalateBreachedSla(now: Date, opts: RunOptions): Promise<AutomationOutcome[]> {
  const out: AutomationOutcome[] = [];
  const candidates = await prisma.conversation.findMany({
    where: {
      status: "escalated",
      firstAgentReplyAt: null,
      slaBreachedAt: null,
      queuedAt: { not: null },
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
    },
    select: {
      id: true, queuedAt: true, priority: true, tier: true, status: true, agencyInstallId: true,
      locationInstall: { select: { ghlLocationId: true, locationName: true } },
      agencyInstall: { select: { companyName: true } },
      messages: { where: { role: "user" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
    take: 200,
  });
  if (candidates.length === 0) return out;

  /**
   * THE SAME RESOLVER THE DESK READS.
   *
   * It used to build its own config map and call the check itself, which was correct and
   * duplicated — and duplication is precisely how the desk's own staleness colours came to
   * disagree with this pass in both directions. `deskQueue.ts` already keeps one definition
   * of queue ORDER for the same reason; lateness is the same fact. If this ever diverges
   * again, an agent's list and the automation acting on it stop describing the same ticket.
   */
  const statuses = await slaStatusFor(
    candidates.map((c) => ({
      id: c.id,
      agencyInstallId: c.agencyInstallId,
      priority: c.priority,
      queuedAt: c.queuedAt,
      firstAgentReplyAt: null,
    })),
    now
  );

  for (const c of candidates) {
    const check = statuses.get(c.id);
    if (!check?.breached) continue;

    if (opts.dryRun) {
      out.push({
        pass: "sla",
        conversationId: c.id,
        detail: `would breach: ${check.elapsedMinutes}/${check.targetMinutes} open minutes`,
      });
      continue;
    }

    // Claim the breach. slaBreachedAt is set exactly once per waiting period, and is
    // cleared when the ticket is resolved, so a genuinely new wait alerts afresh.
    const { count } = await prisma.conversation.updateMany({
      where: { id: c.id, slaBreachedAt: null },
      data: { slaBreachedAt: now },
    });
    if (count !== 1) continue;

    const nextTier = c.tier + 1;
    const brand = await resolveBrandMap(c.locationInstall.ghlLocationId);
    const brandName = brand?.brandName ?? "their platform";

    if (nextTier > MAX_TIER) {
      /**
       * Already at the top. Do NOT silently stall — say the real next step.
       *
       * The route refuses to escalate past tier 3 and names handing it to the agency
       * instead; an automation that quietly gave up here would leave the most overdue
       * ticket in the system as the one nothing further happens to.
       */
      await prisma.message.create({
        data: {
          conversationId: c.id,
          role: "system",
          body:
            `[missed the response target — already at tier ${MAX_TIER}] ` +
            `waited ${check.elapsedMinutes} of ${check.targetMinutes} minutes. ` +
            `The next step is to hand this to the agency.`,
        },
      });
      await notifyDeskOfEscalation({
        brandName,
        locationName: c.locationInstall.locationName,
        agencyName: c.agencyInstall.companyName,
        question: c.messages[0]?.body ?? "(no message recorded)",
        conversationId: c.id,
        reason: `missed its response target at tier ${MAX_TIER} — hand it to the agency`,
      });
      out.push({ pass: "sla", conversationId: c.id, detail: `breached at max tier` });
      continue;
    }

    // Note and mutate together, so the transcript cannot describe a raise that did not
    // happen — the same reasoning as releaseTicketsFrom.
    await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId: c.id,
          role: "system",
          body:
            `[raised to tier ${nextTier} automatically] no first reply after at least ` +
            `${check.elapsedMinutes} minutes` +
            (check.wallClockFallback ? "" : " of open hours") +
            `, against a target of ${check.targetMinutes}.`,
        },
      }),
      prisma.conversation.update({
        where: { id: c.id },
        data: {
          tier: nextTier,
          // Unassign, exactly as a manual escalation does: raising a tier says the
          // current holder cannot finish it, so leaving it on their list leaves it with
          // the one person who can't.
          assignedToId: null,
          assignedAt: null,
          ...enterQueuePatch({ status: c.status, queuedAt: c.queuedAt }),
        },
      }),
    ]);

    await notifyDeskOfEscalation({
      brandName,
      locationName: c.locationInstall.locationName,
      agencyName: c.agencyInstall.companyName,
      question: c.messages[0]?.body ?? "(no message recorded)",
      conversationId: c.id,
      reason: `missed its response target and was raised to tier ${nextTier}`,
    });
    out.push({ pass: "sla", conversationId: c.id, detail: `raised to tier ${nextTier}` });
  }
  return out;
}

/**
 * Pass 3 — idle conversations, WARNED before they are closed.
 *
 * Two stages, and the warning is the important half: silently marking somebody's
 * conversation dead is how a client discovers days later that nobody was coming. The
 * warning also costs nothing to deliver — it is an ordinary message in the transcript,
 * so the widget's existing poller shows it with no email involved at all.
 *
 * IT MUST NEVER TOUCH AN ESCALATED TICKET. An escalated conversation is waiting on US;
 * sweeping those would delete our own backlog and leave every screen reporting a healthy
 * queue — the same failure as a ticket stranded on a disabled account.
 */
async function sweepIdle(now: Date, opts: RunOptions): Promise<AutomationOutcome[]> {
  const out: AutomationOutcome[] = [];

  const toWarn = await prisma.conversation.findMany({
    where: {
      status: "open",
      assignedToId: null,
      idleWarnedAt: null,
      lastMessageAt: { lte: daysAgo(now, IDLE_WARN_DAYS) },
    },
    select: { id: true, locationInstall: { select: { ghlLocationId: true } } },
    take: 200,
  });

  for (const c of toWarn) {
    if (opts.dryRun) {
      out.push({ pass: "idle-warn", conversationId: c.id, detail: "would warn the client" });
      continue;
    }
    const { count } = await prisma.conversation.updateMany({
      where: { id: c.id, idleWarnedAt: null },
      data: { idleWarnedAt: now },
    });
    if (count !== 1) continue;

    /**
     * Written as `bot`, so the client sees it in the same voice as every other automatic
     * message. `system` would be invisible to them — the client-visible allowlist keeps
     * that role off their screen — which would make this a warning nobody was warned by.
     *
     * It names no brand and carries no link, so there is nothing for the gates to catch;
     * it is a fixed string, not model output.
     */
    await prisma.message.create({
      data: {
        conversationId: c.id,
        role: "bot",
        body:
          "It's been a few days since we heard from you, so I'll close this conversation " +
          "shortly. If you still need a hand, just reply here and we'll pick it straight back up.",
      },
    });
    out.push({ pass: "idle-warn", conversationId: c.id, detail: "warned the client" });
  }

  const toClose = await prisma.conversation.findMany({
    where: {
      status: "open",
      assignedToId: null,
      idleWarnedAt: { not: null, lte: daysAgo(now, IDLE_CLOSE_DAYS) },
      // Nothing since the warning went out. If they answered, `lastMessageAt` moved past
      // it and the conversation is alive again.
      lastMessageAt: { lte: daysAgo(now, IDLE_CLOSE_DAYS) },
    },
    select: { id: true, idleWarnedAt: true, lastMessageAt: true },
    take: 200,
  });

  for (const c of toClose) {
    // The client replying after the warning is exactly the outcome the warning is for,
    // so a message newer than it means this conversation is not idle at all.
    if (c.idleWarnedAt && c.lastMessageAt > c.idleWarnedAt) continue;
    if (opts.dryRun) {
      out.push({ pass: "idle-close", conversationId: c.id, detail: "would mark abandoned" });
      continue;
    }
    const { count } = await prisma.conversation.updateMany({
      where: { id: c.id, status: "open", assignedToId: null },
      data: { status: "abandoned", botPaused: false },
    });
    if (count !== 1) continue;
    await prisma.message.create({
      data: {
        conversationId: c.id,
        role: "system",
        body: "[closed automatically — no reply after the idle warning]",
      },
    });
    out.push({ pass: "idle-close", conversationId: c.id, detail: "marked abandoned" });
  }

  return out;
}

/** Pass 4 — an agent is holding a ticket they have not answered. Reminds; never releases. */
async function nudgeAssignees(now: Date, opts: RunOptions): Promise<AutomationOutcome[]> {
  const out: AutomationOutcome[] = [];
  const candidates = await prisma.conversation.findMany({
    where: {
      status: "escalated",
      assignedToId: { not: null },
      firstAgentReplyAt: null,
      assignedAt: { lte: minutesAgo(now, ASSIGNEE_NUDGE_MINUTES) },
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
      AND: [
        { OR: [{ lastReminderAt: null }, { lastReminderAt: { lte: minutesAgo(now, RENUDGE_MINUTES) } }] },
      ],
    },
    select: {
      id: true, assignedAt: true, lastReminderAt: true,
      assignedTo: { select: { name: true, email: true } },
    },
    take: 200,
  });

  for (const c of candidates) {
    if (opts.dryRun) {
      out.push({ pass: "assignee", conversationId: c.id, detail: `would remind ${c.assignedTo?.name}` });
      continue;
    }
    const { count } = await prisma.conversation.updateMany({
      where: { id: c.id, lastReminderAt: c.lastReminderAt },
      data: { lastReminderAt: now },
    });
    if (count !== 1) continue;

    const held = c.assignedAt ? Math.round((now.getTime() - c.assignedAt.getTime()) / 60_000) : 0;
    /**
     * Recorded in the transcript rather than emailed to the individual.
     *
     * A reminder in the ticket is visible to whoever picks it up next, which is the
     * person who actually needs to know it has been sitting. It also means an agent's
     * inbox is not the only place this exists — an inbox nobody else can see is where a
     * held-but-unanswered ticket goes quiet in the first place.
     */
    await prisma.message.create({
      data: {
        conversationId: c.id,
        role: "system",
        body: `[still unanswered] held by ${c.assignedTo?.name ?? "an agent"} for at least ${held} minutes with no reply to the client.`,
      },
    });
    out.push({ pass: "assignee", conversationId: c.id, detail: `reminded after ~${held}m` });
  }
  return out;
}

/**
 * Pass 5 — bring back what was snoozed.
 *
 * A snooze that does not reliably return is worse than no snooze at all: the agent has
 * stopped watching the ticket on the strength of a promise this pass is the only thing
 * keeping.
 */
async function unsnooze(now: Date, opts: RunOptions): Promise<AutomationOutcome[]> {
  const out: AutomationOutcome[] = [];
  const due = await prisma.conversation.findMany({
    where: { snoozedUntil: { not: null, lte: now }, status: { in: ["open", "escalated"] } },
    select: { id: true, status: true, queuedAt: true },
    take: 200,
  });

  for (const c of due) {
    if (opts.dryRun) {
      out.push({ pass: "unsnooze", conversationId: c.id, detail: "would return to the queue" });
      continue;
    }
    const { count } = await prisma.conversation.updateMany({
      where: { id: c.id, snoozedUntil: { not: null, lte: now } },
      data: {
        snoozedUntil: null,
        // enterQueuePatch preserves an existing queuedAt, so a client who had already
        // waited before being snoozed keeps their place rather than starting again.
        ...enterQueuePatch({ status: c.status, queuedAt: c.queuedAt }),
      },
    });
    if (count !== 1) continue;
    await prisma.message.create({
      data: { conversationId: c.id, role: "system", body: "[snooze ended — back in the queue]" },
    });
    out.push({ pass: "unsnooze", conversationId: c.id, detail: "returned to the queue" });
  }
  return out;
}

/**
 * Run every pass.
 *
 * One pass throwing must not stop the rest: they are independent, and an unclaimed
 * escalation going un-nudged because the snooze query failed would be a bug caused
 * entirely by bundling.
 */
export async function runTicketAutomations(opts: RunOptions = {}): Promise<AutomationReport> {
  const now = opts.now ?? new Date();
  const actions: AutomationOutcome[] = [];
  const errors: string[] = [];

  const passes: [string, () => Promise<AutomationOutcome[]>][] = [
    ["unsnooze", () => unsnooze(now, opts)],
    ["unclaimed", () => nudgeUnclaimed(now, opts)],
    ["sla", () => escalateBreachedSla(now, opts)],
    ["assignee", () => nudgeAssignees(now, opts)],
    ["idle", () => sweepIdle(now, opts)],
  ];

  for (const [name, run] of passes) {
    try {
      actions.push(...(await run()));
    } catch (e) {
      errors.push(`${name}: ${describeError(e)}`);
    }
  }

  const scanned = await prisma.conversation.count({ where: { status: { in: ["open", "escalated"] } } });
  return { actions, errors, scanned };
}
