import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Desk routing: who works what, in what order, and how long the client waits.
 *
 * Until now the inbox was a sorted LIST. That is enough for one agent and quietly
 * wrong for three: two people open the same top ticket and both start typing to the
 * same client. So the pop is an ATOMIC CLAIM, not a read followed by a write.
 *
 * The other organising rule is that there is exactly ONE definition of queue order
 * (`QUEUE_ORDER` + `queueWhere`), used by the desk's "take next", the manager's
 * distribute, and the position the client is shown. Two definitions drift, and the
 * failure is invisible from either side: the widget says "you're 2nd" while the desk
 * pops somebody else, and nobody can see both screens at once.
 *
 * Everything that can be decided without the database is a pure function below, so the
 * arithmetic that produces a promise to a real client is unit-testable.
 */

/** Fewer measured responses than this and a median is one person's afternoon. */
export const MIN_SAMPLES_FOR_ESTIMATE = 5;

/** How far down the queue a racing claim will look before giving up. */
export const CLAIM_CANDIDATES = 10;

export const MAX_TIER = 3;

/**
 * Best-first: most urgent, then longest-waiting.
 *
 * `queuedAt` and not `startedAt` - see the schema note. And not `lastMessageAt`
 * either: a client who sends "hello? anyone there?" while waiting would move
 * themselves to the BACK of the queue, which is precisely backwards.
 */
export const QUEUE_ORDER: Prisma.ConversationOrderByWithRelationInput[] = [
  { priority: "desc" },
  { queuedAt: "asc" },
];

/** Unclaimed, escalated, and within the tier this agent is allowed to take. */
export function queueWhere(maxTier?: number): Prisma.ConversationWhereInput {
  return {
    status: "escalated",
    assignedToId: null,
    ...(maxTier === undefined ? {} : { tier: { lte: maxTier } }),
  };
}

/** A ticket an agent is currently holding: claimed, and not finished. */
export function heldWhere(deskUserId: string): Prisma.ConversationWhereInput {
  return { assignedToId: deskUserId, status: { in: ["escalated", "open"] } };
}

// --- pure arithmetic -------------------------------------------------------------

export interface AgentSlot {
  id: string;
  name: string;
  tier: number;
  maxConcurrent: number;
  held: number;
  available: boolean;
}

export function freeSlots(agent: AgentSlot): number {
  return agent.available ? Math.max(0, agent.maxConcurrent - agent.held) : 0;
}

export interface CapacitySnapshot {
  /** Seats on the desk right now (available agents only). */
  capacity: number;
  /** Tickets currently held by someone. */
  inProgress: number;
  /** Seats free right now. */
  free: number;
  /** Agents marked available. */
  onDuty: number;
}

export function capacitySnapshot(agents: AgentSlot[]): CapacitySnapshot {
  const onDutyAgents = agents.filter((a) => a.available);
  return {
    capacity: onDutyAgents.reduce((n, a) => n + a.maxConcurrent, 0),
    // Counted across ALL agents, not just the available ones: a ticket held by an
    // agent who has stepped away is still not in the queue and still not answered.
    // Excluding it would make the desk look emptier than it is.
    inProgress: agents.reduce((n, a) => n + a.held, 0),
    free: onDutyAgents.reduce((n, a) => n + freeSlots(a), 0),
    onDuty: onDutyAgents.length,
  };
}

export interface ResponseStats {
  count: number;
  medianSeconds: number;
  p90Seconds: number;
}

export interface EstimateInput {
  /** 1-based place in line. */
  position: number;
  medianSeconds: number;
  sampleCount: number;
  free: number;
  capacity: number;
}

/**
 * How long this client will probably wait — or null, which is a real answer.
 *
 * A wrong ETA is worse than no ETA: "someone will be with you in 2 minutes" that turns
 * into forty is the thing they remember, and it is the same reasoning that makes
 * `businessHours.tz` refuse to store a timezone it cannot validate. So this returns
 * null in the two cases where any number would be invented:
 *
 *   - fewer than MIN_SAMPLES_FOR_ESTIMATE measured responses, so there is no basis; and
 *   - zero capacity — nobody is on the desk, and a time quoted when nobody is there is
 *     the worst version of this promise, not the most reassuring one.
 */
export function estimateWaitSeconds(input: EstimateInput): number | null {
  if (input.sampleCount < MIN_SAMPLES_FOR_ESTIMATE) return null;
  if (input.capacity <= 0) return null;
  if (input.medianSeconds <= 0) return null;

  // A free seat means someone can start now, so the wait is about one typical
  // response. Otherwise the desk has to turn over: each round of `capacity` tickets
  // ahead of you costs roughly another typical response.
  const rounds =
    input.position <= input.free
      ? 1
      : 1 + Math.ceil((input.position - input.free) / input.capacity);
  return rounds * input.medianSeconds;
}

/**
 * Which agent should get each waiting ticket — the manager's "distribute" button.
 *
 * Deliberately NOT round-robin. Round-robin is fair to agents and unfair to clients:
 * it hands the next ticket to whoever is merely next in rotation, including someone
 * already holding their limit.
 *
 * It levels UTILISATION — held ÷ limit — rather than absolute free seats, and that
 * distinction was a real bug caught by the live check rather than by reading this.
 * Ranking on free seats alone sends every ticket to whoever has the largest limit: a
 * manager with a limit of 5 outranks two idle agents with limits of 2 all the way
 * down, so "distribute" put all three waiting tickets on one person while two agents
 * sat empty — the exact outcome the button exists to prevent. Utilisation ties at 0%,
 * so the work spreads, and the bigger limit still earns more tickets over a full pass.
 *
 * Ties break on name, so the same input always produces the same plan — a manager
 * clicking distribute twice on an unchanged queue should not see a different split.
 */
export function planDistribution(
  tickets: { id: string; tier: number }[],
  agents: AgentSlot[]
): { conversationId: string; deskUserId: string }[] {
  const seats = agents
    .filter((a) => a.available)
    .map((a) => ({ ...a, taken: a.held, remaining: freeSlots(a) }))
    .filter((a) => a.remaining > 0);

  const load = (s: { taken: number; maxConcurrent: number }) =>
    s.maxConcurrent > 0 ? s.taken / s.maxConcurrent : 1;

  const plan: { conversationId: string; deskUserId: string }[] = [];
  for (const ticket of tickets) {
    const eligible = seats.filter((s) => s.remaining > 0 && s.tier >= ticket.tier);
    if (eligible.length === 0) continue; // stays queued; that is the honest outcome
    eligible.sort(
      (a, b) => load(a) - load(b) || b.remaining - a.remaining || a.name.localeCompare(b.name)
    );
    const pick = eligible[0];
    pick.remaining -= 1;
    pick.taken += 1;
    plan.push({ conversationId: ticket.id, deskUserId: pick.id });
  }
  return plan;
}

// --- database-backed -------------------------------------------------------------

/** Every desk account with its current load. One query, not one per agent. */
export async function agentSlots(): Promise<AgentSlot[]> {
  const users = await prisma.deskUser.findMany({
    where: { status: "active" },
    select: { id: true, name: true, tier: true, maxConcurrent: true, availability: true },
    orderBy: { name: "asc" },
  });
  const counts = await prisma.conversation.groupBy({
    by: ["assignedToId"],
    where: { assignedToId: { not: null }, status: { in: ["escalated", "open"] } },
    _count: { _all: true },
  });
  const byUser = new Map(counts.map((c) => [c.assignedToId as string, c._count._all]));
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    tier: u.tier,
    maxConcurrent: u.maxConcurrent,
    held: byUser.get(u.id) ?? 0,
    available: u.availability === "available",
  }));
}

export type ClaimOutcome =
  | { claimed: string }
  | { claimed: null; reason: "at-capacity" | "empty" | "raced" };

/**
 * Take the next ticket, atomically.
 *
 * The conditional `assignedToId: null` inside the UPDATE is the entire mechanism:
 * Postgres serialises two concurrent updates of the same row, so the loser matches
 * zero rows and moves on to the next candidate instead of both agents believing they
 * own it. A `findFirst` followed by an `update` cannot do this at any isolation level
 * we run at, and the symptom — two agents typing to the same client — is invisible on
 * the desk and obvious to the person receiving both replies.
 */
export async function claimNext(agent: {
  id: string;
  tier: number;
  maxConcurrent: number;
}): Promise<ClaimOutcome> {
  const held = await prisma.conversation.count({ where: heldWhere(agent.id) });
  // Refuse at capacity rather than handing over a ticket that will sit unread behind
  // the three already open. The queue is a better place for it than a full desk.
  if (held >= agent.maxConcurrent) return { claimed: null, reason: "at-capacity" };

  const candidates = await prisma.conversation.findMany({
    where: queueWhere(agent.tier),
    orderBy: QUEUE_ORDER,
    take: CLAIM_CANDIDATES,
    select: { id: true },
  });
  if (candidates.length === 0) return { claimed: null, reason: "empty" };

  for (const candidate of candidates) {
    const { count } = await prisma.conversation.updateMany({
      where: { id: candidate.id, assignedToId: null, status: "escalated" },
      data: { assignedToId: agent.id, assignedAt: new Date() },
    });
    if (count === 1) return { claimed: candidate.id };
  }
  return { claimed: null, reason: "raced" };
}

/**
 * Put everything an agent is holding back in the queue, and say so in the transcript.
 *
 * `/assign` and `/transfer` already refuse to hand a ticket to a disabled account,
 * because "assigning work to a disabled account silently parks the ticket where nobody
 * will see it". Offboarding reaches the identical state from the other direction —
 * assign to a live agent, then disable them — and nothing released what they held.
 *
 * A ticket parked on a ghost is worse than an unanswered one, because every screen
 * reports it as handled: `queueWhere` requires `assignedToId: null`, so "take next"
 * cannot reach it, distribute skips it, the board's depth omits it, and no living agent
 * has it on their list. The client gets the most reassuring version of the news —
 * `queuePosition` returns null for an assigned conversation, so the widget stops showing
 * a place in line and says somebody has picked it up. Nobody has.
 *
 * This is emphatically NOT what going `away` does. Away is a routing state and keeps the
 * tickets already held, deliberately: stepping out for lunch must not dump five
 * half-answered conversations back in the queue. Disabling is an ACCESS state — they
 * cannot sign in at all — so the same tickets have no owner rather than a paused one.
 */
export async function releaseTicketsFrom(
  deskUserId: string,
  agentName: string
): Promise<number> {
  const held = await prisma.conversation.findMany({
    where: heldWhere(deskUserId),
    select: { id: true, status: true, queuedAt: true },
  });

  let released = 0;
  for (const conversation of held) {
    // Note and release together, per ticket. Apart, a failure between them leaves a
    // transcript saying "returned to the queue" on a ticket that was not — which is the
    // one record the next agent has, so it must not be able to lie.
    await prisma.$transaction([
      // "Who had this before me" is the first thing asked when a ticket goes wrong, and
      // a re-queued ticket with no history is a conversation the next agent has to
      // reconstruct from the client. `system`, so it is never delivered —
      // `CLIENT_VISIBLE_ROLES` is an allowlist and this carries a staff name.
      prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "system",
          body: `[returned to the queue — ${agentName}'s account was disabled]`,
        },
      }),
      // `enterQueuePatch` is what keeps a client who has already waited 47 minutes at
      // the front rather than sending them to the back for something their agent did. A
      // conversation that had gone `open` (answered, live) gets a fresh clock, because
      // waiting for a NEW person to pick it up is a genuinely new wait.
      prisma.conversation.update({
        where: { id: conversation.id },
        data: { ...enterQueuePatch(conversation), assignedToId: null, assignedAt: null },
      }),
    ]);
    released++;
  }
  return released;
}

/**
 * This conversation's 1-based place in line, or null if it is not waiting.
 *
 * Counted across EVERY tier, not just the tiers that can serve it: a ticket ahead of
 * you occupies someone's attention whoever ends up taking it, so filtering by tier
 * here would show the client a position better than the one they actually hold.
 *
 * Ordering is expressed in SQL rather than by fetching and indexing the list, because
 * the list is unbounded and this runs on the client's widget.
 */
export async function queuePosition(conversationId: string): Promise<number | null> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { status: true, assignedToId: true, priority: true, queuedAt: true, lastMessageAt: true },
  });
  if (!conversation) return null;
  if (conversation.status !== "escalated" || conversation.assignedToId) return null;

  const queuedAt = conversation.queuedAt ?? conversation.lastMessageAt;
  // TicketPriority is declared low → urgent, and Postgres orders an enum by its
  // declaration order, so `>` here means "more urgent" exactly as `priority: desc` does.
  const rows = await prisma.$queryRaw<{ ahead: bigint }[]>`
    SELECT count(*) AS ahead
      FROM "Conversation"
     WHERE "status" = 'escalated'
       AND "assignedToId" IS NULL
       AND "id" <> ${conversationId}
       AND (
         "priority" > ${conversation.priority}::"TicketPriority"
         OR (
           "priority" = ${conversation.priority}::"TicketPriority"
           AND COALESCE("queuedAt", "lastMessageAt") < ${queuedAt}
         )
       )
  `;
  return Number(rows[0]?.ahead ?? 0) + 1;
}

/**
 * Desk-wide first-response times over a window, aggregated IN POSTGRES.
 *
 * Measured from `queuedAt`, so it answers "how long did a client wait for a person"
 * and not "how long was this conversation open" — the second number moves whenever the
 * bot is chattier, which has nothing to do with desk coverage.
 *
 * The aggregation is in SQL rather than JS because of who calls it. This runs on every
 * queue poll — every waiting client every 20s, every signed-in agent every 15s — and
 * the JS version pulled EVERY row in the window across the pipe to take a median of
 * them. Measured: 66ms at 2,000 settled conversations and **97% of the whole poll**,
 * growing linearly with history forever, on a single-threaded free instance. This
 * version returns one row whatever the volume.
 *
 * `percentile_cont` interpolates, so two samples of 20 and 40 give 30 — matching what
 * `supportStats` reports to the agency, which matters because the two surfaces describe
 * the same wait and a client would notice them disagreeing before we did.
 */
export async function firstResponseStats(sinceDays: number): Promise<ResponseStats> {
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const rows = await prisma.$queryRaw<{ count: bigint; median: number | null; p90: number | null }[]>`
    SELECT count(*)                                                   AS count,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds)       AS median,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY seconds)       AS p90
      FROM (
        SELECT EXTRACT(EPOCH FROM ("firstAgentReplyAt" - "queuedAt")) AS seconds
          FROM "Conversation"
         WHERE "queuedAt" >= ${since}
           AND "firstAgentReplyAt" IS NOT NULL
           -- A reply stamped before the hand-off is a data problem, not an instant
           -- answer; counting it as zero would flatter the number.
           AND "firstAgentReplyAt" >= "queuedAt"
      ) s
  `;
  const row = rows[0];
  return {
    count: Number(row?.count ?? 0),
    medianSeconds: Math.round(Number(row?.median ?? 0)),
    p90Seconds: Math.round(Number(row?.p90 ?? 0)),
  };
}

/**
 * What to write when a conversation enters the human queue.
 *
 * Keeps an existing `queuedAt` when it is ALREADY escalated, so a client sending a
 * follow-up into a waiting ticket does not restart their own wait clock and drop
 * themselves to the back of the line. A ticket that had been resolved and comes back
 * is a genuinely new wait and does get a fresh one.
 */
export function enterQueuePatch(current: { status: string; queuedAt: Date | null }): {
  status: "escalated";
  queuedAt: Date;
} {
  return {
    status: "escalated",
    queuedAt: current.status === "escalated" && current.queuedAt ? current.queuedAt : new Date(),
  };
}

export function formatWait(seconds: number): string {
  if (seconds < 60) return "under a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round((seconds / 3600) * 10) / 10;
  return `${hours} hr`;
}
