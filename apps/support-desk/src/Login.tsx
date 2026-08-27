import { useState, FormEvent } from "react";
import { login, ApiError, DeskUser } from "./api";

/**
 * `reason` is set when this is a RE-authentication over a desk that is still on screen
 * (see App.tsx). The form is otherwise identical — same endpoint, same deliberately
 * uninformative failure message — because signing back in after a session ends is the
 * same act as signing in, and a second implementation of it would be a second place to
 * get the enumeration-safe wording wrong.
 */
export default function Login({
  onSignedIn,
  reason,
}: {
  onSignedIn: (user: DeskUser) => void;
  reason?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await login(email, password);
      onSignedIn(user);
    } catch (err) {
      // The server deliberately returns one message for unknown-email, wrong-password
      // and disabled-account so the form can't be used to enumerate staff accounts.
      // Surface it verbatim rather than trying to be more helpful.
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <h1 className="brand">Mosaic</h1>
        <p className="brand-sub">Support Desk</p>

        {reason && <div className="notice">{reason}</div>}
        {error && <div className="error">{error}</div>}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button className="primary" type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p className="muted" style={{ marginTop: 18, marginBottom: 0 }}>
          Desk accounts are created by a Mosaic admin — there's no sign-up. Ask an admin
          to run <code>create-desk-user</code> if you need access.
        </p>
      </form>
    </div>
  );
}
