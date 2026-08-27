import { useState } from "react";
import { changePassword } from "./api";

/**
 * Change your own password.
 *
 * The route (`POST /desk/api/password`) and the client call have both existed since the
 * desk was built, correct and complete — and **nothing on any screen called it**, so no
 * agent could ever change the password an admin picked for them. Same shape as the canned
 * replies that were stored, rendered and gated with zero callers: a correct mechanism with
 * nothing feeding it, which reads as finished from every angle except trying to use it.
 * `create-desk-user` even tells the operator to "use the desk's password change flow".
 *
 * It matters more than "one missing screen" suggests. Accounts are created by hand and the
 * password is read out over chat or email — deliberately, there is no signup — so until the
 * person can rotate it, the credential to an account that can read EVERY agency's support
 * conversations stays permanently known by whoever set it up, and permanently sitting in
 * whatever channel it was sent through.
 */
export default function ChangePassword({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Mirrors the server's own floor so the answer is immediate — never INSTEAD of it.
  const tooShort = next.length > 0 && next.length < 12;
  const mismatch = confirm.length > 0 && next !== confirm;
  const ready = current.length > 0 && next.length >= 12 && next === confirm && !busy;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      setDone(true);
    } catch (e) {
      /**
       * A wrong current password comes back 401, and the desk's central unauthorized
       * handler reads any 401 as the session dying. App.tsx suspends that while this
       * dialog is open, so getting your own password wrong says so here instead of
       * throwing a "you have been signed out" overlay over the form.
       */
      setError(e instanceof Error ? e.message : "Could not change your password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* The same markup idiom as NewTicket: one modal shape in this app, not two. */}
      <div className="modal narrow" role="dialog" aria-label="Change your password">
        <div className="modal-head">
          <strong>Change your password</strong>
          <button type="button" className="icon" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="modal-body">
          {done ? (
            <p className="hint">
              Done. Every other browser signed in as you has been signed out — this one stays
              open.
            </p>
          ) : (
            <>
              <label>
                Current password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </label>

              <label>
                New password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submit();
                  }}
                />
              </label>
              {tooShort && <p className="error">At least 12 characters.</p>}

              <label>
                Confirm new password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submit();
                  }}
                />
              </label>
              {mismatch && <p className="error">These don't match.</p>}

              <p className="hint">
                Changing this signs out every other browser you're signed in on. This one stays
                open, so you won't lose a reply you're part-way through.
              </p>

              {error && <p className="error">{error}</p>}
            </>
          )}
        </div>

        <div className="modal-actions">
          {done ? (
            <button type="button" className="primary" onClick={onClose}>
              Close
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={() => void submit()} disabled={!ready}>
                {busy ? "Changing…" : "Change password"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
