/**
 * How late is late enough to colour — ONE definition, shared by the inbox and the queue
 * board.
 *
 * Extracted for the same reason as `bulkEnableLogic.ts`: this is a judgement an agent
 * acts on, and inline in a component it can only be checked by clicking. It is also the
 * third place this fact has lived — the inbox had its own 60/240 minutes, the board its
 * own 60/240, and the automations the agency's real target — so keeping the last copy in
 * two components would be repeating the bug at half scale.
 *
 * It deliberately makes NO judgement of its own. Whether a ticket is past its target is
 * decided on the server, against the agency's priorities and their open hours, and handed
 * over in `sla`; all this does is choose a class from it. A threshold invented here would
 * be a fourth definition.
 */

export interface SlaLike {
  targetMinutes: number;
  elapsedMinutes: number;
  breached: boolean;
  usedFraction: number;
  inOpenHours: boolean;
}

/**
 * Warn at three quarters of the target, so there is still time to act before the client
 * is owed an apology. A null sla means no first-response clock is running — never
 * escalated, or already answered — and is left UNCOLOURED rather than defaulted to fine:
 * inventing a state for "we don't know" is how the old fixed thresholds went wrong.
 */
export const WARN_AT = 0.75;

export function slaTone(sla: SlaLike | null | undefined): "" | " warn" | " bad" {
  if (!sla) return "";
  if (sla.breached) return " bad";
  return sla.usedFraction >= WARN_AT ? " warn" : "";
}

/** The number behind the colour. A colour with no number is a judgement nobody can check. */
export function slaTitle(sla: SlaLike | null | undefined): string | undefined {
  if (!sla) return undefined;
  // Which clock this counts changes what the number MEANS, so it is always stated.
  const unit = sla.inOpenHours ? "open minutes" : "minutes";
  return (
    `${sla.elapsedMinutes} of ${sla.targetMinutes} ${unit} to a first reply` +
    (sla.breached ? " — past the target" : "")
  );
}
