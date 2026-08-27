import { prisma } from "./prisma";

/**
 * What a GHL webhook is to us, what we keep of it, and for how long.
 *
 * `WebhookEvent` is two things at once — the idempotency key that stops a redelivery
 * re-running a handler, and an audit trail. Those have very different lifetimes, and
 * conflating them is how the table became the in-repo example of unbounded growth.
 */

export type WebhookKind = "install" | "uninstall" | "location" | "unhandled";

/**
 * ONE definition of what this app acts on, read by the dispatcher AND by the retention
 * policy below.
 *
 * They must not drift. If the policy thinks an event is unhandled while the dispatcher
 * acts on it, we discard the payload of an event that can fail — and the payload is
 * exactly what you need when it does. Two lists would look correct in review and diverge
 * the first time somebody adds an event type to one of them.
 */
export function classifyWebhookEvent(eventType: string): WebhookKind {
  // ANCHORED at both ends, not a bare prefix. `/^uninstall/i` would also swallow a
  // hypothetical "UninstallReminder" or "UninstallScheduled" — and reading a *warning*
  // as the event itself would delete a live agency's menu link and stop their branding
  // while they are still a customer. That is the largest blast radius in the product,
  // reached by a webhook we would have invented the meaning of. An unknown event costs
  // nothing: it is audited by shape and ignored.
  //
  // The optional suffix keeps the granular `UninstallCompany` / `UninstallLocation`
  // aliases working. The bare word is what GHL and its SDK actually use.
  if (/^install(company|location)?$/i.test(eventType)) return "install";
  if (/^uninstall(company|location)?$/i.test(eventType)) return "uninstall";
  if (eventType === "LocationCreate" || eventType === "LocationUpdate" || eventType === "LocationDelete") {
    return "location";
  }
  return "unhandled";
}

/**
 * What gets stored in `payload`.
 *
 * The endpoint is ONE URL and GHL decides what to send it. The route audited every
 * delivery in full, including event types the dispatcher discards — so subscribing the
 * app to, say, contact events would silently accumulate the agency's own clients'
 * names, emails and phone numbers in our database, forever, in service of nothing. That
 * is a marketplace data-protection problem, not a disk one; disk is the cheap half.
 *
 * So: keep the body for events we act on (a handler that fails needs it), and for the
 * rest keep only the SHAPE — the top-level key names, no values. Shape is what you
 * actually want when deciding whether to support a new event type, and it carries no
 * personal data. Recording nothing at all would make "GHL is sending us something we
 * ignore" invisible, which is the state that led here.
 */
export function auditPayload(eventType: string, body: unknown): unknown {
  if (classifyWebhookEvent(eventType) !== "unhandled") return body as object;
  const keys =
    body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body as object).sort() : [];
  return { unhandled: true, keys };
}

/**
 * Retention windows. Deliberately far longer than GHL's retry window (hours), so pruning
 * can never delete a row that is still doing its idempotency job and let a redelivery
 * re-run a handler.
 *
 * Failed events are kept much longer, and are the reason this is two numbers rather than
 * one: a handler that has been failing for a fortnight is the single most useful thing in
 * the table, and a policy that treats it like routine traffic deletes the evidence of the
 * only problem worth finding.
 */
export const PROCESSED_RETENTION_DAYS = Number(process.env.WEBHOOK_RETENTION_DAYS ?? 30);
export const FAILED_RETENTION_DAYS = Number(process.env.WEBHOOK_FAILED_RETENTION_DAYS ?? 180);

export function retentionCutoffs(now: Date) {
  const day = 24 * 60 * 60 * 1000;
  return {
    processedBefore: new Date(now.getTime() - PROCESSED_RETENTION_DAYS * day),
    failedBefore: new Date(now.getTime() - FAILED_RETENTION_DAYS * day),
  };
}

/**
 * Delete aged-out audit rows.
 *
 * Runs on the existing 30-minute token-refresh timer rather than its own schedule: the
 * work is idempotent and cheap, so two instances racing it is harmless — unlike feed
 * polling, where a second instance would re-fetch every feed and race the same upserts.
 * Adding a scheduler for a DELETE would be more moving parts than the job is worth.
 *
 * Never called from the webhook route itself. That path is latency-sensitive in a way
 * that has bitten us elsewhere, and GHL retries on a timeout — so a slow prune would turn
 * into duplicate deliveries of the very events it is tidying up after.
 */
export async function pruneWebhookEvents(now: Date = new Date()): Promise<{ deleted: number }> {
  const { processedBefore, failedBefore } = retentionCutoffs(now);
  const { count } = await prisma.webhookEvent.deleteMany({
    where: {
      OR: [
        // `processing` is included deliberately: a row stuck in it for a month is not in
        // flight, it is a crash from before the last deploy. Leaving those forever would
        // exempt the one status nothing ever cleans up.
        { status: { in: ["processed", "received", "processing"] }, receivedAt: { lt: processedBefore } },
        { status: "failed", receivedAt: { lt: failedBefore } },
      ],
    },
  });
  if (count > 0) console.log(`[webhook-retention] pruned ${count} audit rows`);
  return { deleted: count };
}
