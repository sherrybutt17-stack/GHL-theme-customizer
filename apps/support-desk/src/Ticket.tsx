import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  assignTicket,
  checkDraft,
  draftReply,
  escalateTier,
  fetchCannedReplies,
  fetchQueue,
  fetchTicket,
  handToAgency,
  renderCannedReply,
  sendReply,
  transferTicket,
  updateTicket,
  type CannedReply,
  type GateFinding,
  type QueueAgent,
  type Ticket as TicketData,
  type TicketPriority,
} from "./api";

/**
 * One ticket, and the compose box that is the real safety surface of the desk.
 *
 * Three things here are load-bearing rather than decorative:
 *
 *  1. The brand banner sits DIRECTLY above the compose box, not in a sidebar the agent
 *     stops noticing on day three. It is the last thing read before typing.
 *  2. The gate check runs as they type and **blocks the send button**. The server
 *     re-runs the identical check, so this is a fast warning and never the enforcement —
 *     but a block that only appears after clicking Send teaches nothing.
 *  3. Nothing is ever silently rewritten. The agent fixes their own words, or they
 *     don't send.
 */

const PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];

function timeOf(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const ROLE_LABEL: Record<string, string> = {
  user: "Client",
  bot: "Assistant",
  agent: "You (sent to client)",
  system: "Internal",
};

export default function Ticket({
  id,
  onChanged,
}: {
  id: string;
  /** Tells the inbox to refresh — status, assignment and timings all move here. */
  onChanged: () => void;
}) {
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [internal, setInternal] = useState(false);
  const [findings, setFindings] = useState<GateFinding[]>([]);
  const [reasons, setReasons] = useState<string[]>([]);
  // The live gate check could not run — distinct from it running and finding nothing.
  const [checkFailed, setCheckFailed] = useState(false);
  const [busy, setBusy] = useState<null | "send" | "draft" | "hand" | "route">(null);
  const [canned, setCanned] = useState<CannedReply[]>([]);
  // Colleagues, for a transfer. Read from the queue board rather than /desk/api/users,
  // which is admin-only — every agent can pass work on, not only managers.
  const [agents, setAgents] = useState<QueueAgent[]>([]);
  const composeRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(() => {
    fetchTicket(id)
      .then((t) => {
        setTicket(t);
        setError(null);
        void fetchQueue().then((b) => setAgents(b.agents)).catch(() => setAgents([]));
        return fetchCannedReplies(t.agencyInstallId).then(setCanned).catch(() => setCanned([]));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, [id]);

  /**
   * Half-written replies survive switching tickets, kept per conversation.
   *
   * Switching wiped the draft. Checking another ticket mid-reply — to see what a client
   * was told last week, or what a colleague already answered — is ordinary desk work, and
   * it silently destroyed a reply that had already been typed and gate-checked. Nothing
   * warned; the box was simply empty on the way back.
   *
   * A ref, not state: this must not trigger a render, and it deliberately does NOT
   * persist beyond the tab. A draft reply to a customer is not something to leave in
   * storage for the next person on a shared machine — the same reasoning that keeps the
   * client widget's thread in sessionStorage rather than localStorage.
   */
  const drafts = useRef<Map<string, string>>(new Map());
  const currentId = useRef(id);

  useEffect(() => {
    // Park the outgoing ticket's draft before the id changes under us.
    const previous = currentId.current;
    if (previous !== id) {
      if (draft.trim()) drafts.current.set(previous, draft);
      else drafts.current.delete(previous);
      currentId.current = id;
    }
    setDraft(drafts.current.get(id) ?? "");
    setFindings([]);
    setReasons([]);
    setCheckFailed(false);
    load();
    // `draft` is read here but must NOT re-run this effect — it changes on every
    // keystroke, and re-running would reload the ticket as you type.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, load]);

  // Debounced live gate check. An internal note is never sent to a client, so it isn't
  // gated — the point of the gate is what reaches the client's screen.
  useEffect(() => {
    if (!draft.trim() || internal) {
      setFindings([]);
      setCheckFailed(false);
      return;
    }
    const handle = setTimeout(() => {
      checkDraft(id, draft)
        .then((r) => {
          setFindings(r.findings);
          setCheckFailed(false);
        })
        // A FAILED check is not a CLEAN check. Swallowing the error to an empty findings
        // list made the two identical on screen: no warning, send enabled, and an agent
        // reasonably reading that as "this reply is fine". The server re-runs the same
        // gate on /reply so nothing can actually leak — but the whole point of the live
        // check is to teach at typing time instead of after a click, and silently
        // reporting "clean" when we checked nothing is the one answer that misleads.
        .catch(() => {
          setFindings([]);
          setCheckFailed(true);
        });
    }, 400);
    return () => clearTimeout(handle);
  }, [draft, id, internal]);

  const blocked = !internal && findings.length > 0;

  async function send() {
    if (!draft.trim() || blocked) return;
    setBusy("send");
    setReasons([]);
    try {
      await sendReply(id, draft, internal);
      setDraft("");
      setFindings([]);
      load();
      onChanged();
    } catch (e) {
      // 422 = the server refused the CONTENT. It carries per-finding reasons written
      // for a human to act on, so surface those rather than a generic failure.
      if (e instanceof ApiError && e.status === 422) {
        setReasons([e.message]);
        void checkDraft(id, draft).then((r) => setFindings(r.findings)).catch(() => {});
      } else {
        setReasons([e instanceof ApiError ? e.message : String(e)]);
      }
    } finally {
      setBusy(null);
    }
  }

  async function askForDraft() {
    setBusy("draft");
    setReasons([]);
    try {
      const r = await draftReply(id);
      if (!r.draft) {
        setReasons(["Couldn't produce a safe draft for this one — write it yourself."]);
      } else {
        setDraft(r.draft);
        composeRef.current?.focus();
        if (r.thin) {
          setReasons(["Heads up: nothing in the knowledge base matched, so check this draft carefully."]);
        }
      }
    } catch (e) {
      setReasons([e instanceof ApiError ? e.message : String(e)]);
    } finally {
      setBusy(null);
    }
  }

  async function useCanned(replyId: string) {
    try {
      const r = await renderCannedReply(id, replyId);
      setDraft((d) => (d ? `${d}\n\n${r.body}` : r.body));
      composeRef.current?.focus();
    } catch (e) {
      setReasons([e instanceof ApiError ? e.message : String(e)]);
    }
  }

  async function doHandToAgency() {
    if (!ticket) return;
    setBusy("hand");
    try {
      const r = await handToAgency(id, draft.trim());
      setReasons([`Handed to the agency (${r.recipients.join(", ")}).`]);
      setDraft("");
      load();
      onChanged();
    } catch (e) {
      setReasons([e instanceof ApiError ? e.message : String(e)]);
    } finally {
      setBusy(null);
    }
  }

  async function patch(p: Parameters<typeof updateTicket>[1]) {
    await updateTicket(id, p).catch(() => {});
    load();
    onChanged();
  }

  /** Pass it to a named colleague. Recorded in the transcript, not just reassigned. */
  async function doTransfer(deskUserId: string) {
    if (!deskUserId) return;
    setBusy("route");
    try {
      const r = await transferTicket(id, deskUserId, draft.trim() || undefined);
      setReasons([
        r.targetAway
          ? `Transferred to ${r.assignedTo.name} — heads up, they're marked away.`
          : `Transferred to ${r.assignedTo.name}.`,
      ]);
      setDraft("");
      load();
      onChanged();
    } catch (e) {
      setReasons([e instanceof ApiError ? e.message : String(e)]);
    } finally {
      setBusy(null);
    }
  }

  /** Raise the tier. Unassigns and re-queues — see the route note. */
  async function doEscalate() {
    setBusy("route");
    try {
      const r = await escalateTier(id, draft.trim() || undefined);
      setReasons([
        r.agentsAtTier === 0
          ? `Escalated to tier ${r.tier} — but NOBODY is at tier ${r.tier}, so this will sit in the queue until someone is promoted.`
          : `Escalated to tier ${r.tier} and back in the queue for one of ${r.agentsAtTier} agents.`,
      ]);
      setDraft("");
      load();
      onChanged();
    } catch (e) {
      setReasons([e instanceof ApiError ? e.message : String(e)]);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <div className="error pad">{error}</div>;
  if (!ticket) return <p className="muted pad">Loading…</p>;

  const ctx = ticket.context;
  const renamed = Object.entries(ctx.renamedLabels);

  return (
    <section className="ticket">
      <header className="ticket-head">
        <div>
          <h2>{ticket.subject || ticket.locationName || "Conversation"}</h2>
          <p className="muted small">
            {ticket.agencyName ?? "Agency"} · {ticket.locationName ?? ticket.ghlLocationId} · started{" "}
            {timeOf(ticket.startedAt)}
          </p>
        </div>
        <div className="ticket-actions">
          <select value={ticket.priority} onChange={(e) => void patch({ priority: e.target.value as TicketPriority })}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {ticket.assignedTo ? (
            <span className="pill">{ticket.assignedTo.name}</span>
          ) : (
            <button onClick={() => void assignTicket(id).then(load).then(onChanged)}>Claim</button>
          )}
          {ticket.tier > 1 && <span className="tier">tier {ticket.tier}</span>}
          {ticket.status !== "resolved" && (
            <button onClick={() => void patch({ status: "resolved" })}>Mark resolved</button>
          )}
        </div>
      </header>

      {/* Routing. Sits in the header rather than beside Send, because passing a ticket
          on is a decision about the ticket, not a way of replying to it. Whatever is in
          the compose box travels as the hand-off note — the context the next person
          needs is almost always already typed. */}
      <div className="ticket-routing">
        <select
          value=""
          disabled={busy === "route"}
          onChange={(e) => void doTransfer(e.target.value)}
          title="Pass this to a colleague. The transfer is written into the transcript."
        >
          <option value="">Transfer to…</option>
          {agents
            .filter((a) => a.id !== ticket.assignedTo?.id)
            .map((a) => (
              <option key={a.id} value={a.id} disabled={a.tier < ticket.tier}>
                {a.name} · tier {a.tier} · {a.held}/{a.maxConcurrent}
                {a.available ? "" : " · away"}
              </option>
            ))}
        </select>
        <button
          onClick={() => void doEscalate()}
          disabled={busy === "route" || ticket.tier >= 3}
          title={
            ticket.tier >= 3
              ? "Tier 3 is the top of our desk. If this is the agency's own business, hand it to the agency."
              : "Raise the tier and put it back in the queue for someone who can finish it."
          }
        >
          Escalate to tier {Math.min(ticket.tier + 1, 3)}
        </button>
      </div>

      {/* Auto-captured at conversation start, so the agent never asks "which account?" */}
      {ticket.contextSnapshot && (
        <div className="snapshot">
          {ticket.contextSnapshot.pageUrl && <span title={ticket.contextSnapshot.pageUrl}>on {new URL(ticket.contextSnapshot.pageUrl).pathname}</span>}
          {ticket.contextSnapshot.cssApplied === false && (
            <span className="warn">Mosaic CSS did NOT load for this client</span>
          )}
          {ticket.deflected && <span>bot resolved</span>}
          {ticket.handedToAgencyAt && <span className="handed">handed to agency</span>}
        </div>
      )}

      <div className="transcript">
        {ticket.messages.map((m) => (
          <article key={m.id} className={`msg msg-${m.role}`}>
            <div className="msg-meta">
              <strong>{ROLE_LABEL[m.role] ?? m.role}</strong>
              <span>{timeOf(m.createdAt)}</span>
            </div>
            <div className="msg-body">{m.body}</div>
            {m.citations && m.citations.length > 0 && (
              // Titles only. A URL visible here is a URL that gets pasted to a client.
              <div className="msg-cites">from: {m.citations.map((c) => c.title).filter(Boolean).join(", ")}</div>
            )}
          </article>
        ))}
      </div>

      {/*
        The brand banner. Pinned immediately above the compose box on purpose: it is the
        last thing read before typing, and answering as the wrong brand is the failure
        this whole product exists to prevent.
      */}
      <div className="brand-banner">
        <div className="brand-banner-main">
          You are answering as <strong>{ctx.brandName ?? "their platform"}</strong>
          {ctx.userNoun && <span className="muted"> · they call their customers “{ctx.userNoun}”</span>}
        </div>
        <div className="brand-banner-rules">
          {renamed.length > 0 && (
            <span>
              Renamed:{" "}
              {renamed.slice(0, 6).map(([key, label]) => (
                <code key={key}>{label}</code>
              ))}
              {renamed.length > 6 && ` +${renamed.length - 6}`}
            </span>
          )}
          {ctx.hiddenFeatures.length > 0 && (
            <span className="hidden-features">
              Hidden from this client: {ctx.hiddenFeatures.join(", ")}
            </span>
          )}
          <span>
            {ctx.supportBoundary === "how_to_only" && "How-to only — money and contracts go to the agency."}
            {ctx.supportBoundary === "how_to_and_account" && "How-to and account settings. Never money or contracts."}
            {ctx.supportBoundary === "custom" && (ctx.boundaryNotes || "Custom boundary — check with the agency.")}
          </span>
          {ctx.forbiddenTerms.length > 0 && (
            <span className="forbidden">Never say: {ctx.forbiddenTerms.join(", ")}</span>
          )}
          {ctx.allowedLinkDomains.length === 0 && <span>No links at all.</span>}
        </div>
      </div>

      <div className="compose">
        {blocked && (
          <div className="block-warning">
            <strong>This can't be sent yet</strong>
            <ul>
              {findings.map((f, i) => (
                <li key={i}>
                  {f.gate === "link"
                    ? `Links aren't allowed here: “${f.sample}”`
                    : f.detail === "agency-forbidden-term"
                      ? `This agency has asked us never to say “${f.sample}”.`
                      : `“${f.sample}” names the vendor — say “${ctx.brandName ?? "their brand"}” instead.`}
                </li>
              ))}
            </ul>
          </div>
        )}
        {checkFailed && !blocked && (
          <div className="notice">
            Couldn't check this reply for brand or link problems just now — it hasn't been
            cleared, only unchecked. It's still checked again on send, so nothing unsafe
            can reach the client.
          </div>
        )}
        {reasons.length > 0 && (
          <div className="notice">
            {reasons.map((r, i) => (
              <p key={i}>{r}</p>
            ))}
          </div>
        )}

        <textarea
          ref={composeRef}
          value={draft}
          rows={5}
          placeholder={internal ? "Internal note — the client never sees this." : `Reply as ${ctx.brandName ?? "their platform"}…`}
          onChange={(e) => setDraft(e.target.value)}
          className={blocked ? "blocked" : ""}
        />

        {canned.length > 0 && (
          <div className="canned-row">
            <span className="muted small">Canned:</span>
            {canned.slice(0, 6).map((c) => (
              <button key={c.id} className="chip" onClick={() => void useCanned(c.id)} title={c.body}>
                {c.title}
              </button>
            ))}
          </div>
        )}

        <div className="compose-actions">
          <label className="internal-toggle">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
            Internal note
          </label>
          <span className="spacer" />
          <button onClick={() => void askForDraft()} disabled={busy !== null}>
            {busy === "draft" ? "Drafting…" : "Draft for me"}
          </button>
          <button onClick={() => void doHandToAgency()} disabled={busy !== null} title="Their billing, contracts or custom work">
            Hand to agency
          </button>
          <button
            className="primary"
            onClick={() => void send()}
            disabled={busy !== null || !draft.trim() || blocked}
            title={blocked ? "Fix the highlighted problems first" : undefined}
          >
            {busy === "send" ? "Sending…" : internal ? "Save note" : "Send to client"}
          </button>
        </div>
      </div>
    </section>
  );
}
