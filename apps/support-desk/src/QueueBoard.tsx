import { useCallback, useEffect, useState } from "react";
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

/** Colour the wait, not the ticket: the number is only meaningful against a target. */
function waitTone(seconds: number): string {
  if (seconds > 4 * 3600) return " bad";
  if (seconds > 3600) return " warn";
  return "";
}

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

  return (
    <section className="queue-board">
      <header className="queue-head">
        <div className="queue-actions">
          <button className="primary" onClick={take} disabled={busy}>
            Take next
          </button>
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
        {board.estimatedWaitSeconds !== null && (
          <> Someone joining now would be told about {duration(board.estimatedWaitSeconds)}.</>
        )}
      </p>

      {capacity.capacity === 0 && board.depth > 0 && (
        <p className="queue-alarm">
          {board.depth} waiting and nobody is available. Clients are being told a person is coming.
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
              <span className={`queue-wait${waitTone(row.waitingSeconds)}`}>{duration(row.waitingSeconds)}</span>
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
