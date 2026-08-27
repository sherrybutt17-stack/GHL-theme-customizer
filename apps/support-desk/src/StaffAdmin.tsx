import { useEffect, useState, FormEvent } from "react";
import {
  listUsers,
  createUser,
  setUserEnabled,
  setUserRouting,
  ApiError,
  DeskRole,
  DeskUserAdminView,
} from "./api";

/**
 * Staff administration, admin-only. Small on purpose: the desk has a handful of
 * accounts, all created by operators. It exists so offboarding someone is a button
 * rather than a psql session — disabling revokes their live sessions immediately.
 */
export default function StaffAdmin({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<DeskUserAdminView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<DeskRole>("mosaic_agent");
  const [busy, setBusy] = useState(false);

  /**
   * Per-row routing errors, and a per-row revision that forces the limit box to re-read
   * what the SERVER holds.
   *
   * The box is uncontrolled (a controlled one re-renders the table on every keystroke,
   * and the value only leaves the cell on blur), so a rejected save left the typed value
   * sitting on screen looking accepted. Measured before this existed: typing 99 into a
   * limit of 3 got a 400 back and the cell still read 99 — while `maxConcurrent` is the
   * number that decides "all agents are busy, you're 3rd", who distribute levels onto,
   * and whether a fourth ticket is refused. Bumping the revision remounts the input, so
   * the cell always ends up showing the stored value rather than the attempted one.
   */
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [limitRev, setLimitRev] = useState<Record<string, number>>({});
  const bumpLimit = (id: string) => setLimitRev((r) => ({ ...r, [id]: (r[id] ?? 0) + 1 }));

  async function refresh() {
    try {
      setUsers(await listUsers());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load staff accounts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createUser({ email, name, password, role });
      setEmail("");
      setName("");
      setPassword("");
      setRole("mosaic_agent");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the account.");
    } finally {
      setBusy(false);
    }
  }

  async function setRouting(id: string, patch: { tier?: number; maxConcurrent?: number }) {
    setRowError((e) => ({ ...e, [id]: "" }));
    try {
      await setUserRouting(id, patch);
      await refresh();
    } catch (err) {
      // Beside the control, not in the page banner at the top. Measured: the banner sits
      // ~390px above the first table row and further above every row under it, so on a
      // desk with more than a handful of accounts the only thing on screen was the value
      // the server had just refused.
      setRowError((e) => ({
        ...e,
        [id]: err instanceof ApiError ? err.message : "Could not update routing.",
      }));
    } finally {
      // Either way the box goes back to the stored number: success re-reads it from the
      // refresh, failure discards what was typed.
      bumpLimit(id);
    }
  }

  /**
   * An emptied box is a mid-edit state, not an instruction — so it is never sent.
   *
   * `Number("")` is 0, and 0 is a REAL value here ("route this person nothing"), so the
   * server genuinely cannot tell the two apart. Measured before this existed: selecting
   * the limit and tabbing away wrote `maxConcurrent: 0` for a live, available agent — no
   * error, no confirmation, and a blank cell. They were then invisible to `claimNext`,
   * skipped by distribute, and counted as zero capacity in the client's wait estimate,
   * which is the away-versus-disabled failure arriving through a third door: a routing
   * state nobody chose.
   */
  function commitLimit(user: DeskUserAdminView, raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      setRowError((e) => ({
        ...e,
        [user.id]: "A blank limit isn't zero — type 0 if you mean to route them nothing.",
      }));
      bumpLimit(user.id);
      return;
    }
    if (Number(trimmed) === user.maxConcurrent) {
      setRowError((e) => ({ ...e, [user.id]: "" }));
      return;
    }
    void setRouting(user.id, { maxConcurrent: Number(trimmed) });
  }

  async function toggle(user: DeskUserAdminView) {
    const disabling = user.status === "active";
    // Name the blast radius BEFORE the click, not after it. "any ticket they are
    // holding" is a hedge the reader cannot resolve; "2 clients are mid-conversation"
    // is what decides whether this happens now or at the end of their shift.
    const held = user.heldTickets;
    const heldLine = held
      ? `${held} client${held === 1 ? " is" : "s are"} mid-conversation with them right now — ${held === 1 ? "that ticket goes" : "those tickets go"} back to the queue for someone else to take.`
      : `They are holding no tickets, so nothing goes back to the queue.`;
    if (
      disabling &&
      !confirm(`Disable ${user.email}?\n\nThey are signed out immediately. ${heldLine}`)
    ) {
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const r = await setUserEnabled(user.id, !disabling);
      // Say what happened to the WORK, not just to the account. An offboarding admin has
      // no other way to find out that two clients were mid-conversation, and "returned to
      // the queue" is the fact that decides whether they go and tell someone.
      if (disabling && r.releasedTickets) {
        setNotice(
          `${user.name} is disabled. ${r.releasedTickets} ticket${r.releasedTickets === 1 ? "" : "s"} went back to the queue — check the Queue tab, clients are waiting on them.`
        );
      }
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the account.");
    }
  }

  return (
    <>
      <div className="notice" style={{ marginBottom: 24 }}>
        Every desk account can read <strong>every agency's</strong> support conversations.
        There is no self-serve sign-up by design — add people here or with{" "}
        <code>npm run create-desk-user</code>, and disable them the moment they leave.
      </div>

      {error && <div className="error">{error}</div>}
      {/* `.notice`, not the muted `.queue-notice`: "two clients are back in the queue" is
          the one thing on this screen somebody has to act on. */}
      {notice && <div className="notice" style={{ marginBottom: 16 }}>{notice}</div>}

      <h2>Add a team member</h2>
      <form className="card" onSubmit={add} style={{ marginBottom: 28 }}>
        <div className="row" style={{ marginBottom: 16 }}>
          <div>
            <label htmlFor="new-name">Name</label>
            <input id="new-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="new-email">Email</label>
            <input
              id="new-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="row">
          <div>
            <label htmlFor="new-password">Password (min 12 characters)</label>
            <input
              id="new-password"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={12}
              required
            />
          </div>
          <div>
            <label htmlFor="new-role">Role</label>
            <select id="new-role" value={role} onChange={(e) => setRole(e.target.value as DeskRole)}>
              <option value="mosaic_agent">Agent</option>
              <option value="mosaic_admin">Admin</option>
            </select>
          </div>
          <div style={{ flex: "0 0 auto" }}>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      </form>

      <h2>Team</h2>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              {/* Routing lives beside the account it belongs to. Kept off its own
                  screen deliberately: "why did nothing reach Sam" and "is Sam still
                  here" are the same question asked twice. */}
              <th title="The highest escalation tier this person can be handed">Tier</th>
              <th title="How many live tickets they're routed at once">Limit</th>
              {/* Held beside the limit it is measured against: "3 of 5" is the fact
                  distribute levels on, and the number disabling them would re-queue. */}
              <th title="Live tickets they are holding right now">Holding</th>
              <th>Last sign-in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.status === "disabled" ? "disabled" : undefined}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>
                  <span className={`pill${u.role === "mosaic_admin" ? " admin" : ""}`}>
                    {u.role === "mosaic_admin" ? "Admin" : "Agent"}
                  </span>
                </td>
                <td>
                  <select
                    value={u.tier}
                    onChange={(e) => void setRouting(u.id, { tier: Number(e.target.value) })}
                  >
                    {[1, 2, 3].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <div className="routing-cell">
                    <input
                      // The key carries the STORED value and a revision, so the box is
                      // remounted from the server's answer whenever a save settles.
                      // Without it a refused value stayed on screen looking saved, and
                      // the revert this component performs could never reach the DOM.
                      key={`${u.id}:${u.maxConcurrent}:${limitRev[u.id] ?? 0}`}
                      type="number"
                      min={0}
                      max={50}
                      defaultValue={u.maxConcurrent}
                      // Committed on blur, not on every keystroke: typing "12" over a
                      // "3" passes through "1", and saving that would quietly park the
                      // queue on one person mid-edit.
                      onBlur={(e) => commitLimit(u, e.target.value)}
                    />
                    {u.availability === "away" && <span className="muted">away</span>}
                  </div>
                  {rowError[u.id] && <div className="row-error">{rowError[u.id]}</div>}
                </td>
                <td>
                  {u.heldTickets > 0 ? (
                    <span className={u.heldTickets >= u.maxConcurrent ? "pill full" : "pill"}>
                      {u.heldTickets} of {u.maxConcurrent}
                    </span>
                  ) : (
                    <span className="muted">none</span>
                  )}
                </td>
                <td className="muted">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}
                </td>
                <td style={{ textAlign: "right" }}>
                  {u.id === currentUserId ? (
                    <span className="muted">You</span>
                  ) : (
                    <button onClick={() => void toggle(u)}>
                      {u.status === "active" ? "Disable" : "Enable"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
