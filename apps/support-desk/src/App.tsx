import { useEffect, useRef, useState } from "react";
import { me, logout, setUnauthorizedHandler, ApiError, DeskUser } from "./api";
import Login from "./Login";
import StaffAdmin from "./StaffAdmin";
import Inbox from "./Inbox";
import Ticket from "./Ticket";
import QueueBoard from "./QueueBoard";
import ChangePassword from "./ChangePassword";

export default function App() {
  const [user, setUser] = useState<DeskUser | null>(null);
  const [view, setView] = useState<"queue" | "inbox" | "staff">("queue");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Bumped whenever a ticket changes, so the queue re-reads rather than going stale
  // behind an agent who just replied.
  const [refreshKey, setRefreshKey] = useState(0);
  // Three states, not two: until /me answers we don't know whether the cookie is
  // valid, and flashing the login form at an already-signed-in agent on every
  // refresh is exactly the kind of papercut that makes a tool feel unreliable.
  const [checking, setChecking] = useState(true);
  // Set when the server stops accepting our session while the desk is on screen.
  const [sessionEnded, setSessionEnded] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  /**
   * Suspend the "your session ended" handler while the password dialog is open.
   *
   * A WRONG CURRENT PASSWORD comes back 401, and the central handler reads any 401 as the
   * session dying — so getting your own password wrong would throw the re-login overlay
   * over the top of the form, which is both false and unrecoverable-looking. A ref, not
   * state, because the handler is registered once and must not close over a stale value:
   * the same reason `hasSignedIn` is one.
   */
  const suppressUnauthorized = useRef(false);
  // Whether we have EVER been signed in this page load. /me 401s on a first visit, which
  // is the ordinary path and not a session ending; a ref because the handler is
  // registered once and must not close over a stale `user`.
  const hasSignedIn = useRef(false);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (suppressUnauthorized.current) return;
      if (hasSignedIn.current) setSessionEnded(true);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    if (user) hasSignedIn.current = true;
  }, [user]);

  useEffect(() => {
    me()
      .then(({ user }) => setUser(user))
      .catch((err) => {
        // 401 just means "not signed in" - the expected path on first visit.
        if (!(err instanceof ApiError) || err.status !== 401) {
          console.warn("Session check failed:", err);
        }
      })
      .finally(() => setChecking(false));
  }, []);

  async function signOut() {
    try {
      await logout();
    } catch {
      // Even if the revoke call fails, drop the local state - the cookie is
      // httpOnly so this is the only lever the UI has, and leaving someone
      // apparently signed in after they clicked "Sign out" is worse.
    }
    setUser(null);
    setSessionEnded(false);
    hasSignedIn.current = false;
    setSelectedId(null);
  }

  /**
   * Re-authenticating over the live desk, rather than replacing it with the login screen.
   *
   * An agent whose session ends mid-shift has very likely typed a reply to a real client
   * — one that has already been through the brand and link gates as they typed. Swapping
   * the whole app for <Login> unmounts Ticket and throws that away, which is a worse
   * outcome than the expiry itself and the sort of thing that teaches people to draft
   * somewhere else. Keeping the desk mounted underneath an overlay means signing back in
   * restores exactly what was on screen, mid-sentence.
   *
   * UNLESS it is a different person. Then the draft belongs to the previous agent, and
   * carrying it over would put one agent's words under another's name on a message going
   * to a customer. A different id resets the view deliberately.
   */
  function onReauthenticated(next: DeskUser) {
    if (user && next.id !== user.id) setSelectedId(null);
    setUser(next);
    setSessionEnded(false);
    /**
     * Tell everything underneath to fetch again.
     *
     * The desk stays mounted behind the overlay and goes on polling with a cookie that no
     * longer names anything, so by the time somebody signs back in the lists have been
     * emptied by 401s — and nothing in the sign-in path asked them to try again. Measured:
     * the inbox was BLANK for about twelve seconds afterwards, until the next 15s tick.
     *
     * An empty inbox is not a neutral thing to show an agent. It is indistinguishable from
     * "nothing is waiting", which is the same trap the away banner exists for: a quiet desk
     * that looks like a quiet day. And the whole point of re-authenticating over the live
     * desk is that signing back in restores what was on screen — restoring the compose box
     * and not the work queue keeps half of that promise.
     */
    setRefreshKey((k) => k + 1);
  }

  if (checking) {
    return (
      <div className="login-wrap">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!user) return <Login onSignedIn={setUser} />;

  return (
    <>
      {sessionEnded && (
        <div className="session-overlay" role="dialog" aria-modal="true" aria-label="Session ended">
          <Login
            reason="Your session ended. Sign in again to carry on — anything you were typing is still here."
            onSignedIn={onReauthenticated}
          />
        </div>
      )}
      {/**
       * Away is a decision that goes on producing an effect long after it was made.
       *
       * `POST /desk/api/queue/next` already 409s for exactly this reason, and the
       * availability toggle already says what away means — but both of those are things
       * you have to go and look at. Once it is set, nothing on screen says so, and the
       * symptom is a quiet desk that looks like a quiet day. This is deliberately a
       * standing banner rather than a toast: the state persists, so the notice must too.
       */}
      {user.availability === "away" && (
        <div className="away-banner" role="status">
          <strong>You're set to away.</strong> New tickets won't be routed to you — the
          ones you already hold are still yours.
        </div>
      )}

      {changingPassword && (
        <ChangePassword
          onClose={() => {
            setChangingPassword(false);
            suppressUnauthorized.current = false;
          }}
        />
      )}

      <header className="topbar">
        <div className="topbar-left">
          <strong>Mosaic</strong> <span className="muted">Support Desk</span>
          <nav className="topbar-nav">
            {/* Queue first, and the default: an agent arriving should be shown what is
                waiting and a button that claims it, not a list to browse. */}
            <button className={view === "queue" ? "active" : ""} onClick={() => setView("queue")}>
              Queue
            </button>
            <button className={view === "inbox" ? "active" : ""} onClick={() => setView("inbox")}>
              Inbox
            </button>
            {user.role === "mosaic_admin" && (
              <button className={view === "staff" ? "active" : ""} onClick={() => setView("staff")}>
                Staff
              </button>
            )}
          </nav>
        </div>
        <div className="who">
          <span>{user.name}</span>
          <span className={`pill${user.role === "mosaic_admin" ? " admin" : ""}`}>
            {user.role === "mosaic_admin" ? "Admin" : "Agent"}
          </span>
          <button
            onClick={() => {
              suppressUnauthorized.current = true;
              setChangingPassword(true);
            }}
          >
            Password
          </button>
          <button onClick={() => void signOut()}>Sign out</button>
        </div>
      </header>

      {view === "staff" && user.role === "mosaic_admin" ? (
        <main className="page">
          <StaffAdmin currentUserId={user.id} />
        </main>
      ) : view === "queue" ? (
        <main className="desk">
          <QueueBoard
            me={user}
            refreshKey={refreshKey}
            onChanged={() => setRefreshKey((k) => k + 1)}
            // Taking the next ticket opens it immediately. A claim that left the agent
            // looking at the board would be a claim they might forget they made, with
            // the ticket now invisible to everyone else.
            onOpen={(id) => {
              setSelectedId(id);
              setView("inbox");
            }}
          />
          {selectedId ? (
            <Ticket id={selectedId} reloadKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
          ) : (
            <section className="ticket empty">
              <p className="muted">Take the next ticket, or pick one from the queue.</p>
            </section>
          )}
        </main>
      ) : (
        <main className="desk">
          <Inbox selectedId={selectedId} onSelect={setSelectedId} refreshKey={refreshKey} />
          {selectedId ? (
            <Ticket id={selectedId} reloadKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
          ) : (
            <section className="ticket empty">
              <p className="muted">Pick a conversation to work on.</p>
            </section>
          )}
        </main>
      )}
    </>
  );
}
