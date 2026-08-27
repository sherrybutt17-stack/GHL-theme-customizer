/**
 * Can anybody actually take this ticket right now?
 *
 * The queue board answers "what is waiting" and "who is on", and it drew a straight line
 * between them that does not exist. A tier-2 ticket on a desk of tier-1 agents is skipped
 * by `claimNext` (`queueWhere` filters `tier: { lte: maxTier }`), skipped by distribute,
 * and shown to every agent as an ordinary row — the oldest and reddest one on the board.
 * Measured on a live desk: it had been waiting **28 hours**, and pressing "Take next"
 * handed over a ticket queued a day later without a word about the one it stepped past.
 *
 * That is the stranded-ticket failure in a new place: every surface reports it as queued
 * and nobody can reach it. The existing alarm only fires at zero capacity, which is the
 * case where the desk already knows something is wrong.
 *
 * Extracted rather than written inline for the same reason as `slaTone` and
 * `bulkEnableLogic`: it is a judgement an agent acts on, and inside a component it can only
 * be checked by clicking.
 *
 * It invents nothing. Both halves — each queued ticket's tier, and every agent's tier and
 * availability — are already in the one `/desk/api/queue` payload, so this is a reading of
 * what the desk was shown, not a second opinion about it.
 */
export interface ReachAgent {
  tier: number;
  available: boolean;
  held: number;
  maxConcurrent: number;
}

export interface ReachTicket {
  tier: number;
}

export interface QueueReach {
  /** Tickets above the highest tier anybody ON DUTY holds. */
  unreachable: number;
  /**
   * The highest tier that could take work right now, or null when nobody is on at all —
   * which the zero-capacity alarm already covers, so this stays quiet there rather than
   * shouting the same thing twice.
   */
  topTierOnDuty: number | null;
  /**
   * TRUE when no agent holds that tier at any availability — a config gap that will not
   * clear on its own, so the remedy is "raise somebody's tier", not "wait".
   * FALSE when somebody could take it but is away, which fixes itself when they return.
   */
  unstaffed: boolean;
  /** The lowest tier that would unblock the oldest stuck ticket. */
  tierNeeded: number | null;
}

export function queueReach(tickets: ReachTicket[], agents: ReachAgent[]): QueueReach {
  const onDuty = agents.filter((a) => a.available);
  const none: QueueReach = { unreachable: 0, topTierOnDuty: null, unstaffed: false, tierNeeded: null };
  if (!onDuty.length) return none;

  const topTierOnDuty = Math.max(...onDuty.map((a) => a.tier));
  const stuck = tickets.filter((t) => t.tier > topTierOnDuty);
  if (!stuck.length) return { ...none, topTierOnDuty };

  const tierNeeded = Math.min(...stuck.map((t) => t.tier));
  // Anybody at all at that tier, on duty or not? "They are at lunch" and "nobody was ever
  // given that tier" need different sentences: one waits, the other never resolves.
  const unstaffed = !agents.some((a) => a.tier >= tierNeeded);
  return { unreachable: stuck.length, topTierOnDuty, unstaffed, tierNeeded };
}
