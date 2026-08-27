import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";
import { requireDeskAuth, requireDeskAdmin, deskUser } from "../services/deskAuth";
import { resolveBrandMap } from "../services/brandTerms";
import {
  agentSlots,
  capacitySnapshot,
  claimNext,
  estimateWaitSeconds,
  firstResponseStats,
  MAX_TIER,
  planDistribution,
  QUEUE_ORDER,
  queueWhere,
  waitSentence,
} from "../services/deskQueue";
import { slaStatusFor, serialiseSla } from "../services/slaStatus";

/**
 * Routing: pick-up order, capacity, transfer, tiers, and the numbers a manager runs the
 * desk by.
 *
 * Split from deskInbox.ts because the two answer different questions. The inbox is
 * "show me this ticket"; this file is "who works what, next" — and that distinction is
 * why the claim lives here rather than as another flag on the inbox list endpoint.
 */
export const deskQueueRouter = Router();

const STATS_WINDOW_DAYS = 7;

/** The board a manager watches: what is waiting, who is free, how fast we are. */
deskQueueRouter.get("/desk/api/queue", requireDeskAuth, async (_req: Request, res: Response) => {
  const [agents, waiting, stats] = await Promise.all([
    agentSlots(),
    prisma.conversation.findMany({
      where: queueWhere(),
      orderBy: QUEUE_ORDER,
      take: 50,
      select: {
        id: true,
        priority: true,
        tier: true,
        subject: true,
        queuedAt: true,
        lastMessageAt: true,
        agencyInstallId: true,
        // The first-response clock stops at the first human reply and never restarts, so
        // a ticket that was answered once and later re-queued has no target running. Read
        // it rather than assuming null: everything here is unassigned, which is not the
        // same as unanswered.
        firstAgentReplyAt: true,
        agencyInstall: { select: { companyName: true } },
        locationInstall: { select: { ghlLocationId: true, locationName: true } },
      },
    }),
    firstResponseStats(STATS_WINDOW_DAYS),
  ]);

  const capacity = capacitySnapshot(agents);
  const now = Date.now();

  /**
   * The same lateness the inbox shows and the automations act on. The board's own
   * `waitingSeconds` is wall clock and stays — a shift lead asking "how long has that
   * person been sitting there" wants real elapsed time — but whether it is LATE is a
   * question only the agency's target and hours can answer.
   */
  const sla = await slaStatusFor(
    waiting.map((c) => ({
      id: c.id,
      agencyInstallId: c.agencyInstallId,
      priority: c.priority,
      queuedAt: c.queuedAt,
      firstAgentReplyAt: c.firstAgentReplyAt,
    }))
  );

  const rows = await Promise.all(
    waiting.map(async (c, i) => {
      const brand = await resolveBrandMap(c.locationInstall.ghlLocationId);
      const queuedAt = c.queuedAt ?? c.lastMessageAt;
      return {
        id: c.id,
        // Position is the index in THIS order — the same order claimNext pops from,
        // which is the whole reason both read queueWhere/QUEUE_ORDER rather than each
        // sorting for themselves.
        position: i + 1,
        priority: c.priority,
        tier: c.tier,
        subject: c.subject,
        // The CLIENT's brand leads, as it does in the inbox: seeing the agency's name
        // where the client's should be is how a cross-brand slip starts.
        brandName: brand?.brandName ?? null,
        agencyName: c.agencyInstall.companyName,
        locationName: c.locationInstall.locationName,
        waitingSeconds: Math.max(0, Math.round((now - queuedAt.getTime()) / 1000)),
        sla: serialiseSla(sla.get(c.id) ?? null),
      };
    })
  );

  const estimatedWait = estimateWaitSeconds({
    position: rows.length + 1,
    medianSeconds: stats.medianSeconds,
    sampleCount: stats.count,
    free: capacity.free,
    capacity: capacity.capacity,
  });
  res.json({
    queue: rows,
    depth: rows.length,
    capacity,
    // The window is stated so nobody reads a 7-day median as "right now".
    responseTime: { ...stats, windowDays: STATS_WINDOW_DAYS },
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      tier: a.tier,
      held: a.held,
      maxConcurrent: a.maxConcurrent,
      available: a.available,
    })),
    // What a client at the back of the queue would be told right now — shown to staff
    // so the promise the widget is making is never a surprise to the desk.
    estimatedWaitSeconds: estimatedWait,
    // The literal sentence, so the desk QUOTES the promise instead of re-deriving it.
    // Re-deriving is what it used to do, with a compact desk formatter (`1h 7m`) against
    // the widget's own arithmetic (`about 67 min`) - two answers to the one question this
    // field exists to answer.
    estimatedWaitText: waitSentence(estimatedWait),
  });
});

/** Take the next ticket. Atomic — see claimNext. */
deskQueueRouter.post("/desk/api/queue/next", requireDeskAuth, async (req: Request, res: Response) => {
  const me = deskUser(req);
  if (!me) return res.status(401).json({ error: "Not signed in" });

  const account = await prisma.deskUser.findUnique({
    where: { id: me.id },
    select: { id: true, tier: true, maxConcurrent: true, availability: true },
  });
  if (!account) return res.status(401).json({ error: "Not signed in" });
  if (account.availability !== "available") {
    return res.status(409).json({ error: "You're marked away. Go available to take tickets." });
  }

  const outcome = await claimNext(account);
  if (outcome.claimed === null) {
    const messages = {
      "at-capacity": "You're already at your ticket limit. Close one first.",
      empty: "Nothing is waiting.",
      // Every candidate was taken by someone else between the read and the write —
      // which is the race working, not an error.
      raced: "Someone else just took those. Try again.",
    } as const;
    return res.status(409).json({ error: messages[outcome.reason], reason: outcome.reason });
  }
  res.json({ conversationId: outcome.claimed });
});

/**
 * Distribute the queue across the desk — the manager's button.
 *
 * Admin only, because it moves other people's work onto them.
 */
deskQueueRouter.post(
  "/desk/api/queue/distribute",
  requireDeskAuth,
  requireDeskAdmin,
  async (req: Request, res: Response) => {
    const limit = Math.min(Math.max(Number(req.body?.limit) || 25, 1), 100);
    const [agents, tickets] = await Promise.all([
      agentSlots(),
      prisma.conversation.findMany({
        where: queueWhere(),
        orderBy: QUEUE_ORDER,
        take: limit,
        select: { id: true, tier: true },
      }),
    ]);

    const plan = planDistribution(tickets, agents);
    const assigned: { conversationId: string; deskUserId: string }[] = [];
    for (const step of plan) {
      // Same conditional update as the claim: a manager distributing while agents are
      // clicking "take next" must not overwrite a ticket somebody already owns.
      const { count } = await prisma.conversation.updateMany({
        where: { id: step.conversationId, assignedToId: null, status: "escalated" },
        data: { assignedToId: step.deskUserId, assignedAt: new Date() },
      });
      if (count === 1) assigned.push(step);
    }

    res.json({
      assigned: assigned.length,
      // Said out loud rather than left as a silent difference between what was queued
      // and what moved: these are the ones no available agent could take.
      leftQueued: tickets.length - assigned.length,
      plan: assigned,
    });
  }
);

/** Go available / away. A routing state, not an access state. */
deskQueueRouter.post("/desk/api/me/availability", requireDeskAuth, async (req: Request, res: Response) => {
  const me = deskUser(req);
  if (!me) return res.status(401).json({ error: "Not signed in" });
  const value = String(req.body?.availability ?? "");
  if (value !== "available" && value !== "away") {
    return res.status(400).json({ error: "availability must be 'available' or 'away'" });
  }
  const updated = await prisma.deskUser.update({
    where: { id: me.id },
    data: { availability: value },
    select: { availability: true },
  });
  // Tickets they already hold stay with them: going for lunch must not silently dump
  // five half-answered conversations back into the queue with no context.
  res.json({ availability: updated.availability });
});

/**
 * A whole number, or null — and an EMPTY value is null, not zero.
 *
 * `Number("")`, `Number(" ")` and `Number(null)` are all 0, so a field read straight
 * through `Number()` reads a cleared text box as a deliberate zero. That matters here
 * more than anywhere: a `maxConcurrent` of 0 is a legitimate value meaning "route this
 * person nothing", so the server cannot tell an emptied box from somebody choosing it.
 * Measured on the staff screen before this existed: clearing the limit box and clicking
 * away took a live agent out of rotation, silently, with no error and a blank cell.
 */
function wholeNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isInteger(n) ? n : null;
}

/** A manager sets someone's tier and concurrent limit. */
deskQueueRouter.patch(
  "/desk/api/users/:id/routing",
  requireDeskAuth,
  requireDeskAdmin,
  async (req: Request, res: Response) => {
    const data: { tier?: number; maxConcurrent?: number } = {};
    if (req.body?.tier !== undefined) {
      const tier = wholeNumber(req.body.tier);
      if (tier === null || tier < 1 || tier > MAX_TIER) {
        return res.status(400).json({ error: `Tier must be a whole number from 1 to ${MAX_TIER}.` });
      }
      data.tier = tier;
    }
    if (req.body?.maxConcurrent !== undefined) {
      const max = wholeNumber(req.body.maxConcurrent);
      // A limit of 0 is a way to take someone out of rotation without marking them
      // away, so it is allowed; the upper bound just stops a typo parking the entire
      // queue on one person.
      if (max === null || max < 0 || max > 50) {
        return res.status(400).json({ error: "The limit must be a whole number from 0 to 50." });
      }
      data.maxConcurrent = max;
    }
    if (Object.keys(data).length === 0) return res.status(400).json({ error: "Nothing to update" });

    const updated = await prisma.deskUser.update({
      where: { id: req.params.id },
      data,
      select: { id: true, name: true, tier: true, maxConcurrent: true },
    });
    res.json(updated);
  }
);

/**
 * Pass a ticket to a named colleague.
 *
 * Distinct from /assign, which is a bare field write. A transfer is a hand-off between
 * two people and is RECORDED as one: the next agent needs to know they were given this
 * rather than that it drifted to them, and "who had it before me" is the first thing
 * asked when a ticket goes wrong.
 */
deskQueueRouter.post(
  "/desk/api/conversations/:id/transfer",
  requireDeskAuth,
  async (req: Request, res: Response) => {
    const me = deskUser(req);
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      select: { id: true, tier: true, assignedTo: { select: { name: true } } },
    });
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });

    const target = await prisma.deskUser.findUnique({
      where: { id: String(req.body?.deskUserId ?? "") },
      select: { id: true, name: true, status: true, tier: true, availability: true },
    });
    if (!target || target.status !== "active") {
      return res.status(400).json({ error: "That desk user doesn't exist or is disabled." });
    }
    if (target.tier < conversation.tier) {
      // Same reason auto-routing won't do it: it would LOOK assigned, so nobody would
      // escalate it, and the client waits behind someone who cannot answer them.
      return res.status(400).json({
        error: `${target.name} is tier ${target.tier} and this is a tier ${conversation.tier} ticket. Lower the tier first if that's deliberate.`,
      });
    }

    const note = String(req.body?.note ?? "").trim().slice(0, 1000);
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        // `system`, so it can never be mistaken for something the client saw.
        role: "system",
        body: `[transferred from ${conversation.assignedTo?.name ?? me?.name ?? "the queue"} to ${target.name}]${note ? ` ${note}` : ""}`,
      },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { assignedToId: target.id, assignedAt: new Date() },
    });

    res.json({
      id: conversation.id,
      assignedTo: { id: target.id, name: target.name },
      // Not a refusal — a manager may well be handing work to someone about to come
      // back — but the UI should say it rather than let the ticket go quiet.
      targetAway: target.availability !== "available",
    });
  }
);

/**
 * Escalate to the next tier inside Mosaic.
 *
 * Raising the tier UNASSIGNS, deliberately: escalating means "I can't finish this", and
 * a ticket that stays on the escalating agent's list is one they have already told us
 * they cannot answer. It goes back to the queue where someone qualified will pop it.
 *
 * `queuedAt` resets because that is the ordering clock and this is a genuinely new
 * wait for a new person. `firstAgentReplyAt` does NOT, so the desk's first-response
 * number keeps measuring the first human reply rather than being reset by every hop.
 */
deskQueueRouter.post(
  "/desk/api/conversations/:id/escalate",
  requireDeskAuth,
  async (req: Request, res: Response) => {
    const me = deskUser(req);
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      select: { id: true, tier: true, status: true, queuedAt: true },
    });
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });

    const requested = req.body?.tier === undefined ? conversation.tier + 1 : Number(req.body.tier);
    if (!Number.isInteger(requested) || requested <= conversation.tier) {
      return res.status(400).json({ error: "Escalating means raising the tier." });
    }
    if (requested > MAX_TIER) {
      // There is a real next step and it is not a fourth tier — say which.
      return res.status(400).json({
        error: `Tier ${MAX_TIER} is the top of our desk. If this is the agency's own business — their billing, contracts or custom work — hand it to the agency instead.`,
      });
    }

    const note = String(req.body?.note ?? "").trim().slice(0, 1000);
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "system",
        body: `[escalated to tier ${requested} by ${me?.name ?? "desk"}]${note ? ` ${note}` : ""}`,
      },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        tier: requested,
        assignedToId: null,
        assignedAt: null,
        status: "escalated",
        // Explicitly a NEW clock, not enterQueuePatch: this is a fresh wait for a
        // different person, so it starts now even though the ticket was already
        // escalated. firstAgentReplyAt is deliberately untouched, so the desk's
        // first-response number keeps measuring the first human reply rather than
        // being reset by every hop.
        queuedAt: new Date(),
      },
    });

    // A tier nobody staffs is a black hole: the ticket leaves one person's list and
    // arrives on nobody's. Not a refusal — the agent genuinely cannot help — but the
    // desk is told, because the fix is to promote somebody, not to un-escalate.
    const coverage = await prisma.deskUser.count({
      where: { status: "active", tier: { gte: requested } },
    });
    res.json({ id: conversation.id, tier: requested, agentsAtTier: coverage });
  }
);
