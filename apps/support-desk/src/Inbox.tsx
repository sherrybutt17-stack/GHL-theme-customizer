import { useEffect, useState } from "react";
import { fetchInbox, ApiError, type InboxRow } from "./api";

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

/** How long it has been waiting, and whether that's a problem. */
function waitClass(row: InboxRow): string {
  if (row.firstAgentReplyAt) return "";
  const mins = (Date.now() - new Date(row.lastMessageAt).getTime()) / 60000;
  if (mins > 240) return " wait-bad";
  if (mins > 60) return " wait-warn";
  return "";
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
  const [counts, setCounts] = useState({ escalated: 0, open: 0, unassigned: 0 });
  const [filter, setFilter] = useState<string>("escalated");
  const [mine, setMine] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchInbox({ status: filter, mine })
        .then((r) => {
          if (cancelled) return;
          setRows(r.conversations);
          setCounts(r.counts);
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
    </aside>
  );
}
