import { describeError } from "./security";
import { visibleOutsideMosaic } from "./transcriptVisibility";

/**
 * Outbound email, over Resend's REST API with plain `fetch`.
 *
 * No SDK on purpose: this is one POST, and the dependency would be larger than the code.
 *
 * THE RULE HERE: sending must never throw into a caller. Every use is a notification
 * ABOUT something that already happened and is already recorded — an escalation, a
 * hand-off to the agency. If the mail fails, the record still stands and a human can
 * still find the ticket. A support reply that 500s because a notification bounced would
 * be a worse product than one that quietly logs and carries on.
 *
 * Unconfigured is a supported state: with no RESEND_API_KEY this logs what it WOULD
 * have sent and returns `skipped`. That keeps local dev and the free tier working
 * without a mail provider, and makes the missing configuration visible in the log
 * rather than silent.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 8000;

export interface EmailResult {
  sent: boolean;
  skipped?: "not-configured" | "no-recipients";
  error?: string;
}

function fromAddress(): string {
  // A verified sender is a DNS setup step (SPF/DKIM). Default to something obviously
  // placeholder so an unconfigured deploy fails loudly at the provider rather than
  // sending from a plausible-looking address nobody owns.
  return process.env.EMAIL_FROM?.trim() || "Mosaic Support <onboarding@resend.dev>";
}

export async function sendEmail(input: {
  to: string[];
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<EmailResult> {
  const to = input.to.map((t) => t.trim()).filter(Boolean);
  if (to.length === 0) return { sent: false, skipped: "no-recipients" };

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn(
      `[email] RESEND_API_KEY not set — would have sent "${input.subject}" to ${to.join(", ")}`
    );
    return { sent: false, skipped: "not-configured" };
  }

  // A hung mail provider must not hold a request open. The caller has already committed
  // its state change, so timing out here costs a notification, never data.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromAddress(),
        to,
        subject: input.subject,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[email] send failed ${res.status}: ${body.slice(0, 300)}`);
      return { sent: false, error: `provider returned ${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.error(`[email] send failed: ${describeError(e)}`);
    return { sent: false, error: describeError(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Trim a transcript into something readable in an email client.
 *
 * FILTERED, and filtered here rather than at the call site. `system` rows are Mosaic's
 * own workflow — transfers, tier raises, "held by Ada for at least 90 minutes with no
 * reply to the client", "Ada's account was disabled" — sharing one table with the
 * conversation. They were going out under the label "Note:", which reads as something we
 * wrote for the agency deliberately.
 *
 * The route hands over `conversation.messages` whole, and so would the next caller. The
 * allowlist is the guarantee, so it lives where it cannot be forgotten — the same reason
 * `searchKb` keeps its `status = 'ready'` filter in the SQL rather than in its callers.
 */
function renderTranscript(messages: { role: string; body: string }[], limit = 20): string {
  const label: Record<string, string> = { user: "Client", bot: "Assistant", agent: "Mosaic" };
  const visible = visibleOutsideMosaic(messages).slice(-limit);
  // A heading with nothing under it reads as a truncated email, which on this one is the
  // difference between "they said nothing" and "we sent you nothing".
  if (visible.length === 0) return "(nothing the client wrote or was told is on this conversation yet.)";
  return visible.map((m) => `${label[m.role] ?? m.role}: ${m.body}`).join("\n\n");
}

/**
 * Tier-3: tell the AGENCY that something is theirs to answer.
 *
 * Written for a reader who already knows the platform is GoHighLevel — they're a GHL
 * agency. So no brand substitution and no gating here; that machinery exists for text
 * that reaches a CLIENT.
 *
 * What it must never contain is Mosaic's own workings. Two of those, and only one had
 * ever been thought about: source URLs (the caller strips citations) and `system`
 * messages, which are filtered by `renderTranscript` below. `note` is the deliberate
 * channel for anything our team wants this reader to know — the transcript is not.
 */
export async function notifyAgencyOfHandoff(input: {
  to: string[];
  brandName: string;
  locationName: string | null;
  note: string;
  messages: { role: string; body: string }[];
  agentName: string;
}): Promise<EmailResult> {
  const where = input.locationName ? `${input.locationName} (${input.brandName})` : input.brandName;
  return sendEmail({
    to: input.to,
    subject: `Support request needs you — ${where}`,
    text: [
      `One of your clients asked something we can't answer on your behalf.`,
      ``,
      `Sub-account: ${where}`,
      `Passed over by: ${input.agentName}`,
      input.note ? `\nNote from our team:\n${input.note}` : "",
      ``,
      `--- Conversation so far ---`,
      renderTranscript(input.messages),
      ``,
      `Reply to your client directly — they're waiting on you, not on us.`,
    ]
      .filter((l) => l !== "")
      .join("\n"),
  });
}

/**
 * Tell Mosaic's own team that a client is waiting.
 *
 * Goes to DESK_NOTIFY_EMAIL. Unset means no alert — which is why the inbox shows
 * waiting time prominently: the queue must work as the source of truth on its own,
 * with email as a convenience rather than the mechanism.
 */
export async function notifyDeskOfEscalation(input: {
  brandName: string;
  locationName: string | null;
  agencyName: string | null;
  question: string;
  conversationId: string;
  reason: string;
}): Promise<EmailResult> {
  const to = (process.env.DESK_NOTIFY_EMAIL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (to.length === 0) return { sent: false, skipped: "no-recipients" };

  const deskUrl = process.env.SUPPORT_DESK_URL?.replace(/\/$/, "") ?? "";
  return sendEmail({
    to,
    subject: `Client waiting — ${input.brandName}`,
    text: [
      `A support conversation needs a human.`,
      ``,
      `Answer as:   ${input.brandName}`,
      `Sub-account: ${input.locationName ?? "unknown"}`,
      `Agency:      ${input.agencyName ?? "unknown"}`,
      `Why:         ${input.reason}`,
      ``,
      `They asked:`,
      input.question,
      ``,
      deskUrl ? `Open the desk: ${deskUrl}` : `Open the desk to reply.`,
    ].join("\n"),
  });
}
