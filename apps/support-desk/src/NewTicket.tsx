import { useEffect, useRef, useState } from "react";
import {
  createTicket,
  fetchDeskLocations,
  fetchTicketTypes,
  DeskLocation,
  TicketPriority,
  TicketTypeOption,
} from "./api";

/**
 * Raise a ticket for a client who reached us some other way — a phone call, a forwarded
 * email, something their agency told us.
 *
 * Until this existed the desk could only ever work tickets a client had started in the
 * widget and escalated, so anything arriving through another door simply was not recorded.
 *
 * The sub-account picker leads with the CLIENT'S BRAND NAME, not the agency's, and that
 * placement is the same decision the inbox rows already make: seeing "190 Ranch" in one
 * list and "Acme Portal" in the ticket is exactly the confusion that produces a
 * cross-brand slip, and choosing who a ticket belongs to is the first moment it can happen.
 */

const CHANNELS = ["a phone call", "an email", "their agency", "a meeting", "somewhere else"];
const PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];

export default function NewTicket({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [locations, setLocations] = useState<DeskLocation[]>([]);
  const [picked, setPicked] = useState<DeskLocation | null>(null);
  const [types, setTypes] = useState<TicketTypeOption[]>([]);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState(CHANNELS[0]);
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [ticketType, setTicketType] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactName, setContactName] = useState("");
  const [assignToMe, setAssignToMe] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTicketTypes().then((r) => setTypes(r.types)).catch(() => setTypes([]));
  }, []);

  // Debounced, because this fires on every keystroke against a list that can be large.
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      fetchDeskLocations(query).then((r) => setLocations(r.locations)).catch(() => setLocations([]));
    }, 250);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [query]);

  /**
   * Escape closes, but only when nothing has been typed.
   *
   * The same reasoning as the theme editor's discard guard: this form holds a
   * transcription of something a client said on the phone, which exists nowhere else and
   * cannot be recovered by reloading. Escape is a reflex, so it must not be able to throw
   * that away silently.
   */
  const dirty = subject.trim() !== "" || body.trim() !== "" || picked !== null;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (dirty && !window.confirm("Discard this ticket? What you've typed will be lost.")) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, onClose]);

  async function submit() {
    if (busy) return;
    if (!picked) return setError("Choose which sub-account this is for.");
    if (!subject.trim()) return setError("Give the ticket a subject.");
    if (!body.trim()) return setError("Write down what they asked.");

    setBusy(true);
    setError(null);
    try {
      const created = await createTicket({
        ghlLocationId: picked.ghlLocationId,
        subject: subject.trim(),
        body: body.trim(),
        channel,
        priority,
        ticketType: ticketType || null,
        contactEmail: contactEmail.trim() || undefined,
        contactName: contactName.trim() || undefined,
        assignToMe,
      });
      onCreated(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not raise the ticket.");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !dirty) onClose(); }}>
      <div className="modal" role="dialog" aria-label="Raise a ticket">
        <div className="modal-head">
          <h2>Raise a ticket</h2>
          <button type="button" className="icon" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <div className="modal-body">
          <label>
            Which client?
            <input
              type="text"
              value={picked ? "" : query}
              placeholder="Search sub-accounts, brands or agencies"
              onChange={(e) => { setQuery(e.target.value); setPicked(null); }}
            />
          </label>

          {picked ? (
            <div className="picked">
              {/* Brand first: it is the name the reply must be written in. */}
              <strong>{picked.brandName ?? picked.locationName ?? picked.ghlLocationId}</strong>
              <span className="muted">
                {picked.locationName ?? "unnamed sub-account"} · {picked.agencyName ?? "unknown agency"}
              </span>
              {!picked.supportEnabled && (
                // Stated, never blocking. The widget is how a reply reaches them, so its
                // absence changes how this ticket has to be followed up — but refusing to
                // record the call would lose the support request entirely.
                <span className="warn-inline">
                  This sub-account has no support widget, so a reply here won't reach them —
                  follow up however they contacted us.
                </span>
              )}
              <button type="button" className="link" onClick={() => setPicked(null)}>Change</button>
            </div>
          ) : (
            <ul className="picker">
              {locations.map((l) => (
                <li key={l.ghlLocationId}>
                  <button type="button" onClick={() => { setPicked(l); setQuery(""); }}>
                    <strong>{l.brandName ?? l.locationName ?? l.ghlLocationId}</strong>
                    <span className="muted">
                      {l.locationName ?? "unnamed"} · {l.agencyName ?? "unknown agency"}
                    </span>
                  </button>
                </li>
              ))}
              {locations.length === 0 && <li className="muted pad">No sub-accounts match.</li>}
            </ul>
          )}

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
            What did they ask?
            {/* Stored as the CLIENT's own first message, which is what makes this a
                ticket rather than a note. Their words, not a summary. */}
            <textarea
              value={body}
              rows={5}
              maxLength={4000}
              placeholder="In their words, as closely as you can."
              onChange={(e) => setBody(e.target.value)}
            />
          </label>

          <div className="row">
            <label>
              How did they reach us?
              <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>
              Priority
              <select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          </div>

          <label>
            What kind of problem?
            <select value={ticketType} onChange={(e) => setTicketType(e.target.value)}>
              <option value="">Not sure yet</option>
              {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            {ticketType && (
              <span className="hint">{types.find((t) => t.key === ticketType)?.hint}</span>
            )}
          </label>

          <div className="row">
            <label>
              Their name <span className="muted">optional</span>
              <input type="text" value={contactName} maxLength={120} onChange={(e) => setContactName(e.target.value)} />
            </label>
            <label>
              Their email <span className="muted">optional</span>
              <input type="email" value={contactEmail} maxLength={200} onChange={(e) => setContactEmail(e.target.value)} />
            </label>
          </div>
          <p className="hint">
            Without an email there is no way to follow this up outside the chat window.
          </p>

          <label className="check">
            <input type="checkbox" checked={assignToMe} onChange={(e) => setAssignToMe(e.target.checked)} />
            Assign it to me
          </label>

          {error && <p className="error">{error}</p>}
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" onClick={submit} disabled={busy}>
            {busy ? "Raising…" : "Raise ticket"}
          </button>
        </div>
      </div>
    </div>
  );
}
