import { useCallback, useEffect, useRef, useState } from "react";
import type { AgencyArticle } from "./api";
import {
  ApiError,
  assignTicket,
  checkDraft,
  draftReply,
  escalateTier,
  fetchAgencyKb,
  fetchCannedReplies,
  fetchQueue,
  fetchTicket,
  handToAgency,
  renderCannedReply,
  createCannedReply,
  sendReply,
  transferTicket,
  updateTicket,
  fetchTicketTypes,
  type CannedReply,
  type GateFinding,
  type QueueAgent,
  type Ticket as TicketData,
  type TicketPriority,
  type TicketStatus,
  type TicketTypeOption,
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
  reloadKey,
}: {
  id: string;
  /** Tells the inbox to refresh — status, assignment and timings all move here. */
  onChanged: () => void;
  /**
   * Bumped when the transcript on screen can no longer be trusted — today, when a dead
   * session has been signed back into. This component survives the re-login overlay ON
   * PURPOSE, so that the half-written reply underneath it survives too; the cost is that
   * everything it fetched while the cookie was dead is still on screen afterwards, and an
   * agent finishing a reply cannot see what the client said in the meantime.
   *
   * Deliberately reloads the TRANSCRIPT only. The draft is the thing this whole design
   * exists to protect, and it is not touched here.
   */
  reloadKey?: number;
}) {
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [internal, setInternal] = useState(false);
  const [findings, setFindings] = useState<GateFinding[]>([]);
  const [reasons, setReasons] = useState<string[]>([]);
  // The live gate check could not run — distinct from it running and finding nothing.
  const [checkFailed, setCheckFailed] = useState(false);
  const [busy, setBusy] = useState<null | "send" | "draft" | "hand" | "route" | "template">(null);
  const [naming, setNaming] = useState(false);
  const [canned, setCanned] = useState<CannedReply[]>([]);
  /*
    THE AGENCY'S OWN CONTENT. A Mosaic agent switches between five brands in an afternoon
    and had no way to see what THIS agency has written down: the bot has ranked their own
    articles above the shared corpus since the day it was built, and the desk only ever saw
    the titles the bot happened to CITE — so on a ticket the bot answered nothing for, which
    is most of the ones that reach a human, the agent saw nothing at all.

    Collapsed by default. It is a reference, not a decision, and the brand banner directly
    above the compose box is what must stay the last thing read before typing.
  */
  const [agencyKb, setAgencyKb] = useState<{ articles: AgencyArticle[]; heldForReview: number; truncated: boolean } | null>(null);
  const [kbOpen, setKbOpen] = useState(false);
  const [kbFilter, setKbFilter] = useState("");
  const [kbOpenArticle, setKbOpenArticle] = useState<string | null>(null);
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
        /*
          A failure here leaves `agencyKb` null, which the panel renders as "couldn't load"
          rather than as "this agency has written nothing". Those are different facts and
          only one of them is a reason to stop looking — the same distinction the live gate
          check makes between a FAILED check and a CLEAN one.
        */
        void fetchAgencyKb(id).then(setAgencyKb).catch(() => setAgencyKb(null));
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

  const firstReload = useRef(true);
  useEffect(() => {
    // Not on mount — the effect above has just loaded it.
    if (firstReload.current) { firstReload.current = false; return; }
    load();
  }, [reloadKey, load]);

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

  /**
   * Turn the reply you just wrote into a reusable template.
   *
   * This is the only way to create one, and until it existed there were zero templates in
   * the product and no screen that could make one — the create endpoint had no caller, so
   * the row that shows them (`canned.length > 0`) never rendered and the whole feature was
   * invisible.
   *
   * THE BRAND NAME MUST COME OUT. A template is reused across agencies, so a draft saying
   * "the Harbour Suite team" would say Harbour Suite inside every other client's chat —
   * the single most likely cross-brand leak in daily use, because a template is the one
   * text nobody rereads. The client brand is swapped back to {{PLATFORM}} before saving,
   * and the server re-runs the same gate with an EMPTY link allowlist and refuses anything
   * that still names a brand.
   */
  async function saveAsTemplate() {
    const body = draft.trim();
    if (!body || !ticket) return;
    const title = window.prompt("Name this template", body.slice(0, 40).replace(/\s+\S*$/, ""));
    if (title === null) return;
    if (!title.trim()) { setReasons(["A template needs a name."]); return; }

    // Longest-first, or a brand name that contains another gets chopped up — the same
    // reasoning as ownBrandNames at KB ingest.
    let placeheld = body;
    for (const name of [ticket.context.brandName, ticket.agencyName].filter((n): n is string => !!n).sort((a, b) => b.length - a.length)) {
      placeheld = placeheld.split(name).join("{{PLATFORM}}");
    }

    setBusy("template");
    try {
      const created = await createCannedReply({ title: title.trim(), body: placeheld });
      setCanned((c) => [...c, { id: created.id, title: created.title, body: created.body, agencyInstallId: null }]);
      setReasons([
        placeheld === body
          ? `Saved "${created.title}" as a template.`
          : `Saved "${created.title}". The client's brand name was replaced with {{PLATFORM}} so it reads correctly on every other client's ticket.`,
      ]);
    } catch (e) {
      // A 422 here is the gate refusing it, and its reasons say which term tripped —
      // worth showing verbatim rather than "couldn't save".
      setReasons([e instanceof ApiError ? e.message : String(e)]);
    } finally {
      setBusy(null);
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
  const renamed = ctx.renamedLabels ?? [];

  /**
   * Automation entries, picked out of the transcript rather than stored separately.
   *
   * Every pass writes a bracketed `system` line, so the marker is the shape of the body.
   * Deliberately not a second table: the transcript already IS the record of what
   * happened to a ticket, and a parallel log would be one more thing to keep in step
   * with it.
   */
  const automationLog = ticket.messages.filter(
    (m) => m.role === "system" && /^\[(raised to tier|still unanswered|snooze ended|closed automatically|missed the response target|ticket raised by|returned to the queue)/.test(m.body)
  );

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

          {/**
           * Take over from the assistant.
           *
           * Claiming and replying both set this automatically, so the button is for the
           * case in between — reading a live bot conversation and deciding to step in
           * before typing anything. Without it the bot keeps answering while the agent
           * reads, which is how two voices end up in one thread.
           */}
          {!ticket.botPaused && ticket.status !== "resolved" && (
            <button
              onClick={() => void patch({ botPaused: true })}
              title="Stop the assistant answering this conversation. It stays stopped until the ticket is resolved."
            >
              Take over from the assistant
            </button>
          )}
          {ticket.botPaused && ticket.status !== "resolved" && (
            <span className="pill" title="The assistant will not answer this client until the ticket is resolved.">
              you have this
            </span>
          )}

          <button onClick={() => setNaming(true)} title="Give this conversation a subject and a type.">
            {ticket.subject ? "Edit ticket" : "Make it a ticket"}
          </button>

          {ticket.status !== "resolved" && (
            <SnoozeControl
              snoozedUntil={ticket.snoozedUntil}
              onSnooze={(iso) => void patch({ snoozedUntil: iso })}
            />
          )}

          {ticket.status !== "resolved" && (
            <button onClick={() => void patch({ status: "resolved" })}>Mark resolved</button>
          )}
        </div>
      </header>

      {naming && (
        <TicketNaming
          ticket={ticket}
          onClose={() => setNaming(false)}
          onSave={async (fields) => {
            await patch(fields);
            setNaming(false);
          }}
        />
      )}

      {ticket.snoozedUntil && new Date(ticket.snoozedUntil) > new Date() && (
        <div className="snoozed-banner">
          Snoozed until {new Date(ticket.snoozedUntil).toLocaleString()} — it's out of the
          queue until then, and comes back on its own.
          <button className="link" onClick={() => void patch({ snoozedUntil: null })}>Wake it now</button>
        </div>
      )}

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
          {ticket.origin === "desk" && (
            <span>
              raised by {ticket.createdBy?.name ?? "our team"}
              {ticket.contextSnapshot.channel ? ` from ${ticket.contextSnapshot.channel}` : ""}
            </span>
          )}
          {ticket.ticketTypeLabel && <span>{ticket.ticketTypeLabel}</span>}
          {(ticket.contactName || ticket.contactEmail) && (
            <span>{ticket.contactName ?? ticket.contactEmail}</span>
          )}
        </div>
      )}

      {/**
       * What the automations have done to this ticket.
       *
       * Free, rather than new plumbing: every pass already writes a `system` message, so
       * this is a filtered render of rows we store anyway — and `system` is exactly the
       * role the client-visible allowlist keeps off the client's screen.
       *
       * It matters because automation that acts invisibly is automation nobody can
       * debug. "Why is this at tier 3?" is the first question asked about an escalated
       * ticket, and this answers it in the place the question is asked.
       */}
      {automationLog.length > 0 && (
        <details className="automation-history">
          <summary>What happened automatically ({automationLog.length})</summary>
          <ul>
            {automationLog.map((m) => (
              <li key={m.id}>
                <span className="when">{timeOf(m.createdAt)}</span>
                <span>{m.body.replace(/^\[|\]$/g, "")}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="transcript">
        {ticket.messages.map((m) => (
          <article key={m.id} className={`msg msg-${m.role}`}>
            <div className="msg-meta">
              <strong>{ROLE_LABEL[m.role] ?? m.role}</strong>
              <span>{timeOf(m.createdAt)}</span>
            </div>
            <div className="msg-body">{m.body}</div>
            {/*
              * Gated on the TITLES, not on the array. The server maps every citation to
              * `{ title: c?.title ?? null }` — it already anticipates a missing title — so a
              * row of untitled citations passed `length > 0` and rendered a bare "from:"
              * with nothing after it. A dangling label reads as a truncated answer, which
              * on this screen is worse than saying nothing: an agent has to decide whether
              * the bot cited something they cannot see.
              */}
            {(m.citations ?? []).map((c) => c.title).filter(Boolean).length > 0 && (
              // Titles only. A URL visible here is a URL that gets pasted to a client.
              <div className="msg-cites">
                from: {(m.citations ?? []).map((c) => c.title).filter(Boolean).join(", ")}
              </div>
            )}
          </article>
        ))}
      </div>

      {/*
        THE AGENCY'S OWN CONTENT.

        Placed ABOVE the brand banner, never between it and the compose box: that banner is
        pinned immediately above the box on purpose — brand name, renamed labels, hidden
        features and forbidden terms are the last thing read before typing — and pushing it
        away from the box to make room for a reference panel would undo the one placement
        decision the desk is built around.

        Collapsed by default, and the summary carries the COUNT, so an agent can see there
        is something to look at without opening it. A disclosure whose label says nothing
        about what is inside is one nobody opens — the trap already recorded for the
        onboarding page's JavaScript snippet.
      */}
      <div className="agency-kb">
        <button
          className="agency-kb-toggle"
          onClick={() => setKbOpen((v) => !v)}
          aria-expanded={kbOpen}
        >
          <span className="agency-kb-caret">{kbOpen ? "▾" : "▸"}</span>
          {agencyKb === null
            ? "This agency's own content — couldn't load"
            : agencyKb.articles.length === 0
              ? "This agency's own content — none written yet"
              : `This agency's own content — ${agencyKb.articles.length} article${agencyKb.articles.length === 1 ? "" : "s"}`}
        </button>

        {kbOpen && (
          <div className="agency-kb-body">
            {agencyKb === null && (
              <div className="agency-kb-note">
                Couldn't load this agency's content. That is not the same as them having
                written none — reopen the ticket to try again.
              </div>
            )}

            {agencyKb !== null && agencyKb.articles.length === 0 && (
              <div className="agency-kb-note">
                This agency hasn't written any of their own articles. Theirs is the content
                that answers "how do I use YOUR process", which the shared corpus never
                will — they add it in the dashboard under "Client support → Your content".
              </div>
            )}

            {agencyKb !== null && agencyKb.articles.length > 0 && (
              <>
                <input
                  className="agency-kb-filter"
                  placeholder="Filter…"
                  value={kbFilter}
                  onChange={(e) => setKbFilter(e.target.value)}
                />
                <div className="agency-kb-list">
                  {agencyKb.articles
                    .filter((a) => {
                      const q = kbFilter.trim().toLowerCase();
                      if (!q) return true;
                      return (a.title + " " + a.body).toLowerCase().includes(q);
                    })
                    .map((a) => (
                      <div key={a.id} className="agency-kb-item">
                        <button
                          className="agency-kb-title"
                          onClick={() => setKbOpenArticle(kbOpenArticle === a.id ? null : a.id)}
                        >
                          {a.title}
                        </button>
                        {kbOpenArticle === a.id && (
                          <div className="agency-kb-text">{a.body}</div>
                        )}
                      </div>
                    ))}
                  {agencyKb.articles.filter((a) => {
                    const q = kbFilter.trim().toLowerCase();
                    return !q || (a.title + " " + a.body).toLowerCase().includes(q);
                  }).length === 0 && (
                    <div className="agency-kb-note">Nothing matches “{kbFilter}”.</div>
                  )}
                </div>
              </>
            )}

            {/*
              What is NOT on screen, and why. An article that is simply absent is
              indistinguishable from one that was never written, and a quarantined article
              is the agency's own text that we believe still names the vendor — so an agent
              hunting for it deserves to know it exists rather than concluding the panel is
              broken.
            */}
            {agencyKb !== null && agencyKb.heldForReview > 0 && (
              <div className="agency-kb-note">
                {agencyKb.heldForReview} more {agencyKb.heldForReview === 1 ? "article is" : "articles are"} held
                for review and not shown here — something brand-shaped survived in them, so the
                bot can't use them either.
              </div>
            )}
            {agencyKb !== null && agencyKb.truncated && (
              <div className="agency-kb-note">
                Showing the 100 most recently updated. Use the filter to reach the rest.
              </div>
            )}
          </div>
        )}
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
              {/* from → to: "Deals" alone leaves the agent to guess what it replaced,
                  and moving between the client's word and the platform's is the job. */}
              {renamed.slice(0, 6).map((r) => (
                <code key={r.key}>
                  {r.from} → {r.to}
                </code>
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
          <button
            onClick={() => void saveAsTemplate()}
            disabled={busy !== null || !draft.trim()}
            title="Reuse this reply on other tickets — the client's brand name is replaced automatically"
          >
            {busy === "template" ? "Saving…" : "Save as template"}
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

/**
 * Park a ticket until a stated time.
 *
 * Offered as durations rather than a datetime picker because the decision an agent is
 * actually making is "not before tomorrow", not "09:14 on the 19th". A picker invites
 * precision nobody has and is three interactions instead of one.
 *
 * The ticket leaves the queue entirely while snoozed — `queueWhere` excludes it — so it
 * stops appearing in "take next", in distribute, in the board's depth and in the client's
 * queue position. Pass 5 of the automations is the only thing that brings it back, which
 * is why that pass exists: a snooze that does not reliably return is worse than none,
 * because the agent has stopped watching on the strength of the promise.
 */
function SnoozeControl({
  snoozedUntil,
  onSnooze,
}: {
  snoozedUntil: string | null;
  onSnooze: (iso: string) => void;
}) {
  const active = snoozedUntil != null && new Date(snoozedUntil) > new Date();
  if (active) return null;

  const OPTIONS: [string, number][] = [
    ["1 hour", 60],
    ["4 hours", 240],
    ["tomorrow", 60 * 24],
    ["next week", 60 * 24 * 7],
  ];

  return (
    <select
      value=""
      onChange={(e) => {
        const minutes = Number(e.target.value);
        if (!minutes) return;
        onSnooze(new Date(Date.now() + minutes * 60_000).toISOString());
      }}
      title="Take it out of the queue until later. It comes back on its own."
    >
      <option value="">Snooze…</option>
      {OPTIONS.map(([label, minutes]) => (
        <option key={label} value={minutes}>
          {label}
        </option>
      ))}
    </select>
  );
}

/**
 * Give a conversation a subject and a type — i.e. turn a chat into a ticket.
 *
 * There is no new record behind this. A conversation already IS a ticket, so
 * "converting" one is naming it: the fields it was missing, and a place in the human
 * queue. That is why this is a PATCH of the conversation rather than a create.
 */
function TicketNaming({
  ticket,
  onClose,
  onSave,
}: {
  ticket: TicketData;
  onClose: () => void;
  onSave: (fields: { subject?: string; ticketType?: string | null; status?: TicketStatus }) => Promise<void>;
}) {
  const [subject, setSubject] = useState(ticket.subject ?? "");
  const [ticketType, setTicketType] = useState(ticket.ticketType ?? "");
  const [types, setTypes] = useState<TicketTypeOption[]>([]);
  const [queue, setQueue] = useState(ticket.status !== "escalated");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchTicketTypes().then((r) => setTypes(r.types)).catch(() => setTypes([]));
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal narrow" role="dialog" aria-label="Ticket details">
        <div className="modal-head">
          <h2>Ticket details</h2>
          <button type="button" className="icon" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="modal-body">
          <label>
            Subject
            <input
              type="text"
              value={subject}
              maxLength={200}
              placeholder="Short description of the problem"
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label>
            What kind of problem?
            <select value={ticketType} onChange={(e) => setTicketType(e.target.value)}>
              <option value="">Not sure yet</option>
              {types.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
            {ticketType && <span className="hint">{types.find((t) => t.key === ticketType)?.hint}</span>}
          </label>
          {ticket.status !== "escalated" && (
            <label className="check">
              <input type="checkbox" checked={queue} onChange={(e) => setQueue(e.target.checked)} />
              Put it in the human queue
              {/* Naming a chat usually means taking it off the bot. Offered rather than
                  assumed: an agent may be labelling a conversation the assistant is
                  handling perfectly well, and forcing it into the queue would manufacture
                  work — and a wait the client is then shown a position in. */}
            </label>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({
                  subject: subject.trim(),
                  ticketType: ticketType || null,
                  ...(queue && ticket.status !== "escalated" ? { status: "escalated" as TicketStatus } : {}),
                });
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
