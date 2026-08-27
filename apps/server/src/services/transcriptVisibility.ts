/**
 * Which message roles may leave Mosaic — and there is exactly ONE answer, because there
 * are two doors out and they had different ones.
 *
 * `Conversation`/`Message` holds the client transcript and Mosaic's own workflow in the
 * same table. The workflow rows are `system`, and they carry our staff names and our
 * internal state:
 *
 *   [transferred from Ada to Bo] check their billing first
 *   [escalated to tier 2 by Ada]
 *   [returned to the queue — Ada's account was disabled]
 *   [still unanswered] held by Ada for at least 90 minutes with no reply to the client.
 *   [raised to tier 3 automatically] no first reply after at least 240 minutes…
 *
 * The client's chat window filtered these from the day it was built. The tier-3 hand-off
 * EMAIL — the one place a transcript is sent to the AGENCY — did not, and rendered them
 * under the label "Note:", which reads as something we wrote for them on purpose.
 *
 * An ALLOWLIST, not a `!== "system"` denylist, so a role added later is invisible to both
 * doors until somebody decides otherwise. That decision was already made once here and
 * only half of it shipped; the point of one module is that it cannot be made twice again.
 *
 * No imports, deliberately: this is read by a route and by `email.ts`, and neither should
 * pull in the other's dependencies to find out what may leave the building.
 */
export const EXTERNAL_VISIBLE_ROLES: ReadonlySet<string> = new Set(["user", "bot", "agent"]);

/** The transcript as anybody outside Mosaic may see it — a client, or their agency. */
export function visibleOutsideMosaic<T extends { role: string }>(messages: readonly T[]): T[] {
  return messages.filter((m) => EXTERNAL_VISIBLE_ROLES.has(m.role));
}
