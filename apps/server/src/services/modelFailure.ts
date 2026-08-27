/**
 * Why the model call failed — because the answers need different people, and the client
 * sees the same sentence for all of them.
 *
 * `answerQuestion` catches everything and returns *"Sorry — I'm having trouble right now.
 * Let me get someone from the team to help."* That is exactly right for the client: a
 * customer's chat window inside their CRM is no place for `insufficient_quota`. It is
 * useless for the AGENCY, who runs the dry run before switching support on, reads six
 * polite hand-offs, and has nothing on screen telling them which of these it was:
 *
 *   not-configured — OPENAI_API_KEY is unset. Our own throw, before any request.
 *   auth           — the key is set and the provider rejects it (401): wrong, revoked,
 *                    or from another organisation.
 *   no-credits     — the key is fine and the account is out of money (429
 *                    insufficient_quota). NOTHING retries its way out of this, and it is
 *                    the failure a working deployment actually meets, months in.
 *   rate-limited   — a real 429. It clears on its own; retrying is right.
 *   transient      — 5xx, a timeout, a socket. Retry.
 *
 * CLAUDE.md's deployment note said the way to catch a dead bot was "if all six answers are
 * hand-offs, the key is missing". Measured 2026-08-26 on this repo's own account: the key
 * was set and valid, the credits were spent, and that diagnosis sent the reader to check
 * the one thing that was fine.
 *
 * Same shape and the same reasoning as `tokenFailure.ts`, and no imports for the same
 * reason: `supportBot.ts` constructs an OpenAI client at module load, so anything
 * downstream of it is awkward to reach from a unit test.
 */
export type ModelFailure = "not-configured" | "auth" | "no-credits" | "rate-limited" | "transient";

/** Classified from the RAW error. Callers must still log through `describeError`. */
export function classifyModelFailure(error: unknown): ModelFailure {
  const message = error instanceof Error ? error.message : String(error ?? "");
  // Our own guard, thrown before a request is made.
  if (/OPENAI_API_KEY/i.test(message)) return "not-configured";

  const status = (error as { status?: number; response?: { status?: number } })?.status
    ?? (error as { response?: { status?: number } })?.response?.status;
  const code = String(
    (error as { code?: string })?.code
      ?? (error as { error?: { type?: string; code?: string } })?.error?.type
      ?? (error as { error?: { code?: string } })?.error?.code
      ?? ""
  );

  // Quota is reported as a 429, which is also what an ordinary rate limit uses — and the
  // two need opposite actions, so the code/message is what separates them, not the status.
  if (/insufficient_quota|billing_hard_limit_reached/i.test(code) || /no credits remaining|exceeded your current quota|billing/i.test(message)) {
    return "no-credits";
  }
  if (status === 401 || status === 403 || /invalid_api_key|invalid_request_error.*api key/i.test(code)) return "auth";
  if (status === 429) return "rate-limited";

  // Anything unrecognised is transient, so an unfamiliar message never tells an operator
  // to go and change billing details that are fine.
  return "transient";
}

/** What the AGENCY should be told, in the terms of the screen they are looking at. */
export const MODEL_REMEDY: Record<ModelFailure, string> = {
  "not-configured":
    "OPENAI_API_KEY is not set on the server, so the assistant can't answer anything. " +
    "Until it is, every client question becomes a hand-off to your team.",
  auth:
    "The server's OpenAI key was rejected. It may have been revoked, or it belongs to a " +
    "different organisation. Replace OPENAI_API_KEY and restart.",
  "no-credits":
    "The OpenAI account has no credits left. The key is fine — nothing here will start " +
    "working again until credits are added, and retrying can't fix it.",
  "rate-limited":
    "OpenAI is rate-limiting us right now. This clears on its own; try the dry run again " +
    "in a minute.",
  transient:
    "The model call failed for a reason that usually clears on its own. Try again; if every " +
    "answer is still a hand-off, check the server log.",
};

/** True when the failure will still be there however many times somebody presses Try it. */
export function isPermanentModelFailure(kind: ModelFailure): boolean {
  return kind === "not-configured" || kind === "auth" || kind === "no-credits";
}
