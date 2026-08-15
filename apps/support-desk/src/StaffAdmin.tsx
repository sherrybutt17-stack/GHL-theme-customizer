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
    try {
      await setUserRouting(id, patch);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update routing.");
    }
  }

  async function toggle(user: DeskUserAdminView) {
    const disabling = user.status === "active";
    if (
      disabling &&
      !confirm(
        `Disable ${user.email}?\n\nThey are signed out immediately, and any ticket they are holding goes back to the queue for someone else to take.`
      )
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
                      type="number"
                      min={0}
                      max={50}
                      defaultValue={u.maxConcurrent}
                      // Committed on blur, not on every keystroke: typing "12" over a
                      // "3" passes through "1", and saving that would quietly park the
                      // queue on one person mid-edit.
                      onBlur={(e) => void setRouting(u.id, { maxConcurrent: Number(e.target.value) })}
                    />
                    {u.availability === "away" && <span className="muted">away</span>}
                  </div>
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
