import { useCallback, useEffect, useState } from "react";
import { queueReach } from "./queueReach";
import { slaTone, slaTitle } from "./slaTone";
import {
  ApiError,
  distributeQueue,
  fetchQueue,
  setAvailability,
  takeNext,
  type Availability,
  type DeskUser,
  type QueueBoard as Board,
} from "./api";
import NewTicket from "./NewTicket";

/**
 * The board a manager runs the desk by, and the button an agent actually uses.
 *
 * The old inbox answered "show me a ticket". It could not answer the two questions a
 * shift lead asks every hour — *is anybody waiting longer than they should be*, and
 * *have we got the people on to clear it* — because both are about the queue as a
 * whole rather than any row in it.
 *
 * "Take next" is the important control here. Picking a row by hand looks equivalent and
 * is not: two agents scanning the same list both open the top ticket, and the first
 * anyone learns of it is a client receiving two different replies. The claim is atomic
 * server-side; this button is what makes using it the path of least resistance.
 */

function duration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * Colour the wait, not the ticket: the number is only meaningful against a target — and
 * the target is the AGENCY's, resolved server-side against their priorities and their open
 * hours. This used to say exactly that and then hardcode 1h/4h for everybody, which put a
 * green row in front of an agent whose automation had already escalated the ticket.
 *
 * Shared with the inbox (`slaTone.ts`) so the two lists cannot disagree about one ticket.
 */

export default function QueueBoard({
  me,
  onOpen,
  refreshKey,
  onChanged,
}: {
  me: DeskUser;
  onOpen: (conversationId: string) => void;
  refreshKey: number;
  onChanged: () => void;
}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [availability, setLocalAvailability] = useState<Availability>(me.availability ?? "available");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    fetchQueue()
      .then((b) => {
        setBoard(b);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  useEffect(() => {
    load();
    // The queue changes because of other people, not because of anything this tab did,
    // so it has to poll. 15s is slow enough to be free and fast enough that a waiting
    // client is never a surprise.
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [load, refreshKey]);

  async function take() {
    setBusy(true);
    setNotice(null);
    try {
      const { conversationId } = await takeNext();
      onOpen(conversationId);
      onChanged();
      load();
    } catch (e) {
      // 409 is the ordinary answer — empty queue, at your limit, or someone beat you to
      // it. Showing it as an error would train agents to ignore errors.
      setNotice(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function distribute() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await distributeQueue();
      setNotice(
        r.leftQueued > 0
          ? `Assigned ${r.assigned}. ${r.leftQueued} stayed queued — no available agent had room, or they need a higher tier.`
          : `Assigned ${r.assigned}.`
      );
      onChanged();
      load();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleAvailability() {
    const next: Availability = availability === "available" ? "away" : "available";
    setLocalAvailability(next);
    try {
      await setAvailability(next);
      load();
    } catch (e) {
      setLocalAvailability(availability);
      setNotice(e instanceof ApiError ? e.message : String(e));
    }
  }

  if (error) return <div className="error">{error}</div>;
  if (!board) return <p className="muted pad">Loading the queue…</p>;

  const { capacity, responseTime } = board;
  // Reading of what this same payload already says: each queued ticket's tier against the
  // tiers actually on duty. See queueReach.ts for why it is not inline.
  const reach = queueReach(board.queue, board.agents);

  return (
    <section className="queue-board">
      {creating && (
        <NewTicket
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            // Refresh the board AND open what was just raised: the agent's next action is
            // always to work it, and leaving them on the list to hunt for the row they
            // just created is a step nobody wants.
            load();
            onChanged();
            onOpen(id);
          }}
        />
      )}
      <header className="queue-head">
        <div className="queue-actions">
          <button className="primary" onClick={take} disabled={busy}>
            Take next
          </button>
          {/* Beside "Take next" rather than in the top bar: this is the existing action
              cluster, and the Queue tab is the deliberate landing view. A fourth top-bar
              tab would imply a fourth pane. */}
          <button onClick={() => setCreating(true)}>New ticket</button>
          {me.role === "mosaic_admin" && (
            <button onClick={distribute} disabled={busy || board.depth === 0}>
              Distribute queue
            </button>
          )}
          <button
            className={`availability ${availability}`}
            onClick={toggleAvailability}
            title="Away stops new tickets being routed to you. It does not sign you out or take away the ones you already hold."
          >
            {availability === "available" ? "● Available" : "○ Away"}
          </button>
        </div>
        {notice && <p className="queue-notice">{notice}</p>}
      </header>

      <div className="queue-stats">
        <div className="stat">
          <span className="stat-value">{board.depth}</span>
          <span className="stat-label">waiting</span>
        </div>
        <div className="stat">
          <span className="stat-value">
            {capacity.inProgress}
            <em>/{capacity.capacity}</em>
          </span>
          <span className="stat-label">in progress</span>
        </div>
        <div className="stat">
          <span className="stat-value">{capacity.onDuty}</span>
          <span className="stat-label">agents on</span>
        </div>
        <div className="stat">
          {/* Median, and it says so. A mean would be dragged somewhere no real client
              sits by a single ticket answered the next morning. */}
          <span className="stat-value">
            {responseTime.count > 0 ? duration(responseTime.medianSeconds) : "—"}
          </span>
          <span className="stat-label">median reply</span>
        </div>
        <div className="stat">
          <span className="stat-value">
            {responseTime.count > 0 ? duration(responseTime.p90Seconds) : "—"}
          </span>
          <span className="stat-label">slowest 10%</span>
        </div>
      </div>

      <p className="queue-basis muted">
        {responseTime.count > 0 ? (
          <>
            From <strong>{responseTime.count}</strong> chats answered in the last{" "}
            {responseTime.windowDays} days, timed from when each one asked for a person.
          </>
        ) : (
          <>No chats have reached a person in the last {responseTime.windowDays} days, so there is no average yet.</>
        )}
        {board.estimatedWaitText && (
          // QUOTED, not paraphrased. This line exists to show the promise the widget is
          // making; formatting the seconds again with the desk's own compact `1h 7m`
          // produced a different sentence from the one the client actually reads.
          <> Someone joining now would be told: “{board.estimatedWaitText}”</>
        )}
      </p>

      {capacity.capacity === 0 && board.depth > 0 && (
        <p className="queue-alarm">
          {board.depth} waiting and nobody is available. Clients are being told a person is coming.
        </p>
      )}

      {/*
        * A ticket nobody on duty is allowed to take. `claimNext` and distribute both skip
        * it silently, so it sat here as an ordinary row — measured on a live desk, the
        * OLDEST and reddest one, 28 hours in, while "Take next" kept handing over tickets
        * queued a day later. Every surface said queued; nobody could reach it.
        *
        * Split by remedy, because the two states are not the same problem: an unstaffed
        * tier never clears on its own, while an away colleague does.
        */}
      {reach.unreachable > 0 && (
        <p className="queue-alarm">
          {reach.unreachable === 1 ? "1 ticket needs" : `${reach.unreachable} tickets need`} tier{" "}
          {reach.tierNeeded} and the highest tier on duty is {reach.topTierOnDuty}.{" "}
          {reach.unstaffed
            ? `No account is at tier ${reach.tierNeeded} at all — “Take next” steps past these, so they wait until somebody's tier is raised or they go to the agency.`
            : "Whoever holds that tier is away — these wait until they are back."}
        </p>
      )}

      <ol className="queue-list">
        {board.queue.map((row) => (
          <li key={row.id}>
            <button className="queue-row" onClick={() => onOpen(row.id)}>
              <span className="queue-pos">{row.position}</span>
              <span className="queue-main">
                {/* The CLIENT's brand leads here as it does everywhere else on the
                    desk — the name this reply has to be written in. */}
                <span className="brand-tag">{row.brandName ?? "Unbranded"}</span>
                {row.priority !== "normal" && <span className={`prio ${row.priority}`}>{row.priority}</span>}
                {row.tier > 1 && <span className="tier">tier {row.tier}</span>}
                <span className="queue-subject">{row.subject || row.locationName || "—"}</span>
              </span>
              <span
              className={`queue-wait${slaTone(row.sla)}`}
              title={slaTitle(row.sla) ?? "No response target is running for this ticket"}
            >
              {duration(row.waitingSeconds)}
            </span>
            </button>
          </li>
        ))}
        {board.depth === 0 && <li className="muted pad">Nothing waiting.</li>}
      </ol>

      <table className="agent-load">
        <tbody>
          {board.agents.map((a) => (
            <tr key={a.id} className={a.available ? "" : "away"}>
              <td>{a.name}</td>
              <td className="tier-cell">tier {a.tier}</td>
              <td>
                {a.held}/{a.maxConcurrent}
              </td>
              <td>{a.available ? "" : "away"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
