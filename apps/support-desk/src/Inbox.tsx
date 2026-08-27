import { useEffect, useState } from "react";
import { slaTone, slaTitle } from "./slaTone";
import { fetchInbox, ApiError, type InboxRow, type InboxCounts } from "./api";

/**
 * The queue: every agency's waiting conversations in one list.
 *
 * Cross-agency by design — that IS the product. One agent works agency A's ticket then
 * agency B's, so there is no tenant partitioning here.
 *
 * Each row leads with the CLIENT's brand name rather than the agency's, because that is
 * the name the agent has to answer as. Seeing "190 Ranch" in the list and "Acme Portal"
 * in the ticket is exactly the confusion that produces a cross-brand slip.
 */

const FILTERS = [
  { key: "escalated", label: "Needs a human" },
  /**
   * Whose turn is it. Not a status — the server derives it from the newest message's
   * role, so it cannot disagree with the transcript underneath it.
   *
   * This is the list an agent actually wants: "needs a human" includes everything
   * somebody has already replied to and is waiting on the client for, and scanning past
   * those to find the ones where the ball is in our court is the whole job.
   */
  { key: "awaiting", label: "Awaiting our reply" },
  { key: "open", label: "With the bot" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "Everything" },
] as const;

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * Whether this is a problem — answered by the SERVER, against the agency's own target.
 *
 * The version this replaces was wrong three ways at once, and every one of them told an
 * agent something untrue about a real client:
 *
 *   1. it used a FIXED 60/240 minutes, so an `urgent` ticket on a 15-minute target stayed
 *      green for an hour while the automations had already breached it, raised a tier and
 *      unassigned it — the list said fine, the system said late;
 *   2. it counted WALL CLOCK, so an overnight wait went red by 4am while the target,
 *      counted in the agency's open hours, correctly had not moved. A colour that is red
 *      every morning is one people stop seeing;
 *   3. it measured from `lastMessageAt`, so a client sending "hello? anyone there?" reset
 *      their own row to green. The person who has waited longest and is chasing us looked
 *      like the freshest thing on the page. `deskQueue.ts` already refuses to order the
 *      queue that way, for exactly this reason.
 *
 * The tone itself lives in `slaTone.ts`, shared with the queue board.
 */
function waitClass(row: InboxRow): string {
  const tone = slaTone(row.sla);
  return tone === " bad" ? " wait-bad" : tone === " warn" ? " wait-warn" : "";
}

export default function Inbox({
  selectedId,
  onSelect,
  refreshKey,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Bumped by the ticket view after a reply, so the queue reflects it. */
  refreshKey: number;
}) {
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [counts, setCounts] = useState<InboxCounts>({
    escalated: 0, open: 0, unassigned: 0, awaitingReply: 0, mine: 0,
  });
  const [filter, setFilter] = useState<string>("escalated");
  const [mine, setMine] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      // "Awaiting" is a view over live conversations, not a status the server stores, so
      // it asks for everything live and filters on the derived flag.
      fetchInbox({ status: filter === "awaiting" ? "all" : filter, mine })
        .then((r) => {
          if (cancelled) return;
          setRows(
            filter === "awaiting"
              ? r.conversations.filter(
                  (c) => c.awaitingReply && (c.status === "open" || c.status === "escalated")
                )
              : r.conversations
          );
          setCounts(r.counts);
          setTruncated(r.truncated);
          setError(null);
        })
        .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : String(e)))
        .finally(() => !cancelled && setLoading(false));
    };

    setLoading(true);
    load();
    /**
     * Poll, for the reason the queue board already gives: this list changes because of
     * other people, not because of anything this tab did. `refreshKey` only fires on the
     * agent's OWN reply, so an agent parked on "Needs a human" watched a frozen list and
     * a frozen count while tickets arrived — the one number they glance at to decide
     * whether to take another. Same 15s as the board, so the two never disagree.
     *
     * No loading state on a background pass: the spinner is gated on an empty list, so a
     * refresh under a populated inbox does not flash.
     */
    const timer = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [filter, mine, refreshKey]);

  return (
    <aside className="inbox">
      <div className="inbox-head">
        <div className="inbox-filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip${filter === f.key ? " active" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {f.key === "escalated" && counts.escalated > 0 && <span className="count">{counts.escalated}</span>}
              {f.key === "awaiting" && counts.awaitingReply > 0 && (
                <span className="count">{counts.awaitingReply}</span>
              )}
            </button>
          ))}
        </div>
        <label className="mine-toggle">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          Only mine
        </label>
      </div>

      {error && <div className="error">{error}</div>}
      {loading && rows.length === 0 && <p className="muted pad">Loading…</p>}
      {!loading && rows.length === 0 && !error && (
        <p className="muted pad">
          {filter === "escalated" ? "Nothing waiting. The bot is handling everything." : "Nothing here."}
        </p>
      )}

      <ul className="inbox-list">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              className={`inbox-row${selectedId === row.id ? " selected" : ""}${waitClass(row)}`}
              onClick={() => onSelect(row.id)}
              title={slaTitle(row.sla)}
            >
              <div className="inbox-row-top">
                {/* The brand the client sees — the name this reply must be written in. */}
                <span className="brand-tag">{row.brandName ?? "Unbranded"}</span>
                {row.priority !== "normal" && <span className={`prio ${row.priority}`}>{row.priority}</span>}
                <span className="when">{ago(row.lastMessageAt)}</span>
              </div>
              <div className="inbox-row-preview">{row.subject || row.preview || "(no messages yet)"}</div>
              <div className="inbox-row-meta">
                <span>{row.locationName ?? "—"}</span>
                {/* What they pay for, when the agency has told us — the same value the
                    bot uses to say "isn't included on your Starter plan". */}
                {row.planName && <span className="plan">{row.planName}</span>}
                {row.ticketTypeLabel && <span className="ttype">{row.ticketTypeLabel}</span>}
                {row.snoozedUntil && new Date(row.snoozedUntil) > new Date() && (
                  <span className="snoozed" title={`Back at ${new Date(row.snoozedUntil).toLocaleString()}`}>
                    snoozed
                  </span>
                )}
                {row.origin === "desk" && <span className="raised" title="Raised by our team, not from the widget">raised by us</span>}
                {row.assignedTo && <span className="assignee">{row.assignedTo.name}</span>}
                {row.handedToAgencyAt && <span className="handed">with agency</span>}
                {row.brandLeakHits > 0 && (
                  <span className="leaks" title="Replies blocked for naming the vendor">
                    {row.brandLeakHits} blocked
                  </span>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>

      {/* Reported, never inferred. A list that silently stops at its cap is a list that
          quietly stops showing an agent work that exists — and there is no way to tell
          "exactly 100 matched" from "we stopped at 100" by looking. */}
      {truncated && (
        <p className="muted pad">
          Showing the first 100. Narrow the filter to see the rest.
        </p>
      )}
    </aside>
  );
}
