import { SESSION_EXPIRED_MESSAGE } from "./sessionMessage";

/**
 * What to tell the agency after a bulk enable/disable that did not entirely succeed.
 *
 * Extracted for the same reason as `bulkBrandLogic.ts`: this is arithmetic that produces a
 * sentence a person acts on, and it is exactly the kind of thing that is quietly wrong by
 * one. Inline in a component it can only be checked by clicking.
 *
 * The behaviour it encodes:
 *  - Every settled result is inspected, not just the first. The old code used
 *    `Promise.all`, so one rejection abandoned the local update while the other requests
 *    carried on committing — the table said nothing changed and the database disagreed.
 *  - A session expiry is passed through UNCHANGED, because App.tsx branches on that exact
 *    string to show the amber "click Mosaic in your sidebar" banner instead of a red
 *    error. Wrapping it in a count would turn the one failure with a remedy into one
 *    without.
 *  - Total successes are stated, not just failures. "38 of 41" tells the agency to retry
 *    three; "3 failed" leaves them wondering whether the other 38 landed.
 */
export interface BulkOutcome {
  failed: number;
  /** null when everything succeeded — nothing to say. */
  message: string | null;
}

export function summariseBulk(
  results: { status: "fulfilled" | "rejected"; reason?: { message?: string } }[]
): BulkOutcome {
  const rejected = results.filter((r) => r.status === "rejected");
  if (rejected.length === 0) return { failed: 0, message: null };

  const first = rejected[0].reason;
  if (first?.message === SESSION_EXPIRED_MESSAGE) {
    // Verbatim, so the caller's banner check still matches.
    return { failed: rejected.length, message: SESSION_EXPIRED_MESSAGE };
  }

  const total = results.length;
  const ok = total - rejected.length;
  return {
    failed: rejected.length,
    message:
      `${ok} of ${total} updated — ${rejected.length} failed ` +
      `(${first?.message ?? "unknown error"}). The table below shows what actually changed.`,
  };
}
