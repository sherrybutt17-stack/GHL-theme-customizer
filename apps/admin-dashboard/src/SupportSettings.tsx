import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "./Dialog";
import { SupportActivity } from "./SupportActivity";
import { SupportKnowledge } from "./SupportKnowledge";
import { SupportDryRun } from "./SupportDryRun";
import {
  fetchSupportConfig,
  saveSupportConfig,
  type BusinessHours,
  type LocationRow,
  type SupportBoundary,
  type SupportConfig,
} from "./api";

/**
 * The agency's support policy — the settings the bot and Mosaic's own support agents
 * operate under.
 *
 * Deliberately small. The agency does NOT get a desk here: they can't read tickets or
 * reply. This screen answers three questions: is support on, what may we say on their
 * behalf, and who do we hand the rest to.
 *
 * Every field has a safe fallback server-side, so a half-filled form yields a VAGUE
 * bot, never a leaky one. The one true blocker is the escalation address — without it
 * anything we can't answer has nowhere to go, so the master switch stays locked.
 */

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

const BOUNDARY_OPTIONS: { value: SupportBoundary; label: string; hint: string }[] = [
  {
    value: "how_to_only",
    label: "How-to questions only",
    hint: "Anything touching money, contracts or account changes goes straight to you. The safe default.",
  },
  {
    value: "how_to_and_account",
    label: "How-to and account settings",
    hint: "We'll also help with settings and account questions — still never money or contracts.",
  },
  { value: "custom", label: "Custom — I'll write the rules", hint: "Describe exactly what we may and may not answer." },
];

function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

/**
 * Ordered most urgent first, and the fallbacks match `DEFAULT_SLA_MINUTES` on the server.
 * They are only ever a display fallback: the GET returns a resolved policy, so these show
 * up solely if a response arrives without one.
 */
/** The server refuses anything below this, so the form must not offer it either. */
const SLA_FLOOR_MINS = 5;

const SLA_LEVELS: { key: string; label: string; fallback: number }[] = [
  { key: "urgent", label: "Urgent", fallback: 15 },
  { key: "high", label: "High", fallback: 60 },
  { key: "normal", label: "Normal", fallback: 240 },
  { key: "low", label: "Low", fallback: 480 },
];

function defaultHours(): BusinessHours {
  const days: Record<string, [number, number] | null> = {};
  for (const d of DAYS) days[d.key] = ["sat", "sun"].includes(d.key) ? null : [9, 17];
  return { tz: localTimezone(), days };
}

function hourLabel(h: number): string {
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  if (h === 24) return "midnight";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

/** A comma/Enter-separated list rendered as removable chips. */
function ChipInput({
  value,
  onChange,
  placeholder,
  max,
  invalid,
}: {
  value: string[] | null;
  onChange: (next: string[]) => void;
  placeholder: string;
  max: number;
  /** Return a reason string to mark a chip as rejected, or null if it's fine. */
  invalid?: (v: string) => string | null;
}) {
  const [draft, setDraft] = useState("");

  /**
   * A missing list is an EMPTY list, never a crash.
   *
   * The server is the real fix for the one column that did this (quickActions), but this
   * component renders four different fields and the cost of it being wrong is not a blank
   * field — it is `.map` of null, which unmounts the entire dashboard and leaves a white
   * page with nothing on screen saying why. No form input is worth that failure mode, so
   * the type admits null and the component absorbs it.
   */
  const chips = Array.isArray(value) ? value : [];

  function commit(raw: string) {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...chips];
    for (const p of parts) if (!next.includes(p) && next.length < max) next.push(p);
    onChange(next);
    setDraft("");
  }

  return (
    <div className="chip-input">
      <div className="chip-row">
        {chips.map((v) => {
          const why = invalid?.(v) ?? null;
          return (
            <span className={`chip${why ? " chip-bad" : ""}`} key={v} title={why ?? undefined}>
              {v}
              <button type="button" onClick={() => onChange(chips.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
                &times;
              </button>
            </span>
          );
        })}
      </div>
      <input
        type="text"
        value={draft}
        placeholder={chips.length >= max ? `Limit of ${max} reached` : placeholder}
        disabled={chips.length >= max}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && chips.length) {
            onChange(chips.slice(0, -1));
          }
        }}
      />
    </div>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

export function SupportSettingsModal({
  agencyId,
  locations,
  onClose,
  onSaved,
}: {
  agencyId: string;
  /** Needed so the dry run can be aimed at a REAL sub-account, not a hypothetical one. */
  locations: LocationRow[];
  onClose: () => void;
  /** Lets the parent re-render the per-row toggles once the master switch changes. */
  onSaved: (config: SupportConfig) => void;
}) {
  const [config, setConfig] = useState<SupportConfig | null>(null);
  const [counts, setCounts] = useState({ enabled: 0, total: 0 });
  const [tab, setTab] = useState<"setup" | "voice" | "knowledge" | "activity">("setup");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dryRun, setDryRun] = useState(false);

  useEffect(() => {
    fetchSupportConfig(agencyId)
      .then((r) => {
        setConfig(r.config);
        pristine.current = JSON.stringify(r.config);
        setCounts({ enabled: r.locationsEnabled, total: r.locationsTotal });
      })
      .catch((e) => setError((e as Error).message));
  }, [agencyId]);

  /**
   * Closing with unsaved policy asks first — the same guard the theme editor needed, and
   * for a sharper reason: THIS overlay closes on a backdrop click as well as on Escape.
   *
   * What is at risk reads small and isn't. A "words we should never use" list is up to 25
   * chips typed one at a time, boundary notes are free text describing what Mosaic may say
   * on the agency's behalf, and none of it exists anywhere but this modal until Save. A
   * stray click on the dimmed area behind it threw all of it away with no warning.
   *
   * Fingerprinted against what was LOADED, and the whole config object is the save
   * payload, so a field added later is covered without anyone remembering to add it here.
   */
  const pristine = useRef<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /**
   * The knowledge tab reports its own draft up, because this fingerprint is taken from
   * the support CONFIG and cannot see a half-written article. Left out, the guard would
   * protect a one-word tone field and let Escape close the modal over the longest piece
   * of free text on the screen — which is worse than no guard, because it reads as one.
   */
  const [knowledgeDirty, setKnowledgeDirty] = useState(false);
  const configDirty = config !== null && pristine.current !== null && pristine.current !== JSON.stringify(config);
  const isDirty = configDirty || knowledgeDirty;

  function requestClose() {
    if (isDirty) setConfirmDiscard(true);
    else onClose();
  }

  /**
   * The third way to lose an article, and the least obvious: only the active tab is
   * mounted, so leaving "Your content" mid-sentence to check what the boundary setting
   * says unmounts the editor and takes the draft with it. Same guard rather than a
   * restructure — it fires only when there is genuinely something to lose, and the
   * config half needs no equivalent because that state lives here and survives the tab.
   */
  const [pendingTab, setPendingTab] = useState<typeof tab | null>(null);
  function goToTab(next: typeof tab) {
    if (next !== tab && knowledgeDirty) setPendingTab(next);
    else setTab(next);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape belongs to the topmost thing on screen. Without this guard it closes the
      // settings modal out from under the dry run the agency is still reading — or out
      // from under the discard prompt, which answers itself.
      if (e.key === "Escape" && !dryRun && !confirmDiscard && !pendingTab) requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, dryRun, confirmDiscard, pendingTab, isDirty]);

  const set = <K extends keyof SupportConfig>(key: K, v: SupportConfig[K]) =>
    setConfig((c) => (c ? { ...c, [key]: v } : c));

  // What's stopping the master switch from going on. Shown up front rather than as a
  // save-time error, so nobody fills the whole form to be told "no" at the end.
  const blockers = useMemo(() => {
    if (!config) return [];
    const out: string[] = [];
    if (!config.escalationEmails.length) out.push("Add an escalation email — where we send what we can't answer.");
    if (config.supportBoundary === "custom" && !config.boundaryNotes?.trim()) {
      out.push("You picked custom boundaries — describe what we may and may not answer.");
    }
    return out;
  }, [config]);

  const hours = config?.businessHours ?? null;
  const setHours = (next: BusinessHours | null) => set("businessHours", next);

  /**
   * The GET always returns a complete policy (the server resolves the stored value
   * against its own defaults), so the form has one code path and the numbers on screen
   * are the ones the automations actually use — never a placeholder that differs from
   * what would happen today.
   */
  const sla = config?.slaFirstResponseMins ?? {};

  /**
   * The box holds TEXT while it is being typed, and the policy is written on BLUR.
   *
   * It used to clamp on every keystroke — `Math.max(5, Math.round(minutes))` inside
   * onChange — with the reason written down: "below the server's floor the save is
   * refused outright, which would lose the rest of the form's edits to a stray keystroke
   * in a number box." Right about the problem, wrong about the fix, and it made the field
   * report a number nobody typed. Measured keystroke by keystroke:
   *
   *   type 240 into Normal -> 2 becomes 5, then 54, then 540
   *   type  30 into Urgent -> 3 becomes 5, then 50
   *   clear a box entirely -> 5
   *
   * Any first digit below 5 is rewritten to a 5 and the rest appended to it, so the
   * common targets (15, 30, 45, 120, 240, 480) all store something else. This is the
   * field the automations read to decide when a ticket is chased, escalated a tier and
   * unassigned: 240 -> 540 leaves a client waiting nine hours while the agency believes
   * four, and a cleared box means every ticket at that priority breaches almost at once —
   * the "backlog manufactured entirely by the clock" the open-hours rule exists to
   * prevent, arriving through the form instead.
   *
   * So: never rewrite what somebody is typing. A blank or out-of-range value is REFUSED
   * on blur, said beside the row, and the box goes back to what is actually stored —
   * the desk's `maxConcurrent` fix exactly, in the other app.
   */
  const [slaText, setSlaText] = useState<Record<string, string>>({});
  const [slaError, setSlaError] = useState<Record<string, string>>({});
  const slaValue = (key: string, fallback: number) => slaText[key] ?? String(sla[key] ?? fallback);

  const setSla = (key: string, minutes: number) =>
    set("slaFirstResponseMins", {
      ...SLA_LEVELS.reduce<Record<string, number>>((acc, l) => {
        acc[l.key] = sla[l.key] ?? l.fallback;
        return acc;
      }, {}),
      [key]: minutes,
    });

  function commitSla(key: string, raw: string, fallback: number): void {
    const stored = sla[key] ?? fallback;
    const trimmed = raw.trim();
    // A blank box is a mid-edit state, not an instruction to pick a number for them.
    const n = trimmed === "" ? NaN : Number(trimmed);
    if (!Number.isFinite(n) || n < SLA_FLOOR_MINS) {
      setSlaError((e) => ({ ...e, [key]: `Must be a whole number of minutes, ${SLA_FLOOR_MINS} or more.` }));
      setSlaText((t) => ({ ...t, [key]: String(stored) }));
      return;
    }
    const rounded = Math.round(n);
    setSlaError((e) => ({ ...e, [key]: "" }));
    setSlaText((t) => ({ ...t, [key]: String(rounded) }));
    if (rounded !== stored) setSla(key, rounded);
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveSupportConfig(agencyId, config);
      onSaved(saved);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    // The dry run is a SIBLING of this overlay, not a child: nested inside, a click on
    // its backdrop would bubble to this one's onClick and close both at once.
    <>
    <div className="modal-overlay" onClick={requestClose}>
      <div className="modal" style={{ width: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Client support</h2>
          {/* Standing marker, so the discard prompt is never the first time somebody
              learns their policy edits were not saved. */}
          {isDirty && <span className="unsaved-dot" title="Unsaved changes">Unsaved changes</span>}
        </div>

        <div className="tabs">
          <button className={`tab${tab === "setup" ? " active" : ""}`} onClick={() => goToTab("setup")}>
            Setup
          </button>
          <button className={`tab${tab === "voice" ? " active" : ""}`} onClick={() => goToTab("voice")}>
            Voice &amp; wording
          </button>
          <button className={`tab${tab === "knowledge" ? " active" : ""}`} onClick={() => goToTab("knowledge")}>
            Your content
          </button>
          <button className={`tab${tab === "activity" ? " active" : ""}`} onClick={() => goToTab("activity")}>
            Activity
          </button>
        </div>

        <div className="modal-body">
          {!config && !error && tab !== "activity" && tab !== "knowledge" && <div className="empty-state">Loading&hellip;</div>}
          {error && <div className="error-banner">Error: {error}</div>}

          {config && tab === "setup" && (
            <>
              <div className="support-master">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={config.enabled}
                    disabled={blockers.length > 0}
                    onChange={(e) => set("enabled", e.target.checked)}
                  />
                  <span className="toggle-track" />
                </label>
                <div>
                  <div className="support-master-title">
                    {config.enabled ? "Support is on" : "Support is off"}
                  </div>
                  <div className="support-master-hint">
                    {config.enabled
                      ? `A help bubble shows in the ${counts.enabled} of ${counts.total} sub-accounts you switched on, in their own branding.`
                      : "Nothing is shown to your clients yet. Turn this on, then pick the sub-accounts."}
                  </div>
                </div>
              </div>

              {blockers.length > 0 && (
                <div className="support-blockers">
                  <strong>Before you can turn this on</strong>
                  <ul>
                    {blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/*
                Sits with the switch, not on a tab of its own: the question "what will my
                client actually see?" is asked at the moment of turning it on, and an
                answer one click away is one they'll take. It runs whether support is on
                or off — the whole point is to try it BEFORE a client can.
              */}
              <div className="support-tryit">
                <div>
                  <strong>See it answer as one of your clients</strong>
                  <div className="field-hint">
                    Six awkward questions — including the ones meant to make an assistant name the
                    software it runs on — with the answers shown in full.
                  </div>
                </div>
                <button
                  className="btn"
                  disabled={locations.length === 0}
                  title={locations.length === 0 ? "You have no sub-accounts to test against yet." : undefined}
                  onClick={() => setDryRun(true)}
                >
                  Try it
                </button>
              </div>

              <div className="field">
                <label>Escalation email</label>
                <ChipInput
                  value={config.escalationEmails}
                  onChange={(v) => set("escalationEmails", v)}
                  placeholder="you@agency.com — press Enter"
                  max={5}
                  invalid={(v) => (EMAIL_RE.test(v) ? null : "Doesn't look like an email address")}
                />
                <p className="field-hint">
                  Anything about <em>your</em> business — billing, contracts, custom work — is handed to you rather
                  than answered on your behalf.
                </p>
              </div>

              <div className="field">
                <label>What may we answer?</label>
                <select
                  className="look-select"
                  value={config.supportBoundary}
                  onChange={(e) => set("supportBoundary", e.target.value as SupportBoundary)}
                >
                  {BOUNDARY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className="field-hint">{BOUNDARY_OPTIONS.find((o) => o.value === config.supportBoundary)?.hint}</p>
                {config.supportBoundary === "custom" && (
                  <textarea
                    className="custom-css"
                    style={{ marginTop: 8, minHeight: 90 }}
                    value={config.boundaryNotes ?? ""}
                    placeholder="e.g. Answer anything about using the platform. Never discuss pricing, refunds or contract length — pass those to us."
                    onChange={(e) => set("boundaryNotes", e.target.value)}
                  />
                )}
              </div>

              <div className="field">
                <label>Business hours</label>
                {!hours ? (
                  <button className="btn btn-sm" onClick={() => setHours(defaultHours())}>
                    Set business hours
                  </button>
                ) : (
                  <>
                    <div className="hours-tz">
                      <span>Timezone</span>
                      <input
                        type="text"
                        value={hours.tz}
                        onChange={(e) => setHours({ ...hours, tz: e.target.value })}
                        placeholder="America/Chicago"
                      />
                      <button className="btn btn-ghost btn-sm" onClick={() => setHours(null)}>
                        Clear
                      </button>
                    </div>
                    {DAYS.map((d) => {
                      const slot = hours.days[d.key] ?? null;
                      return (
                        <div className="hours-row" key={d.key}>
                          <label className="hours-day">
                            <input
                              type="checkbox"
                              checked={!!slot}
                              onChange={(e) =>
                                setHours({
                                  ...hours,
                                  days: { ...hours.days, [d.key]: e.target.checked ? [9, 17] : null },
                                })
                              }
                            />
                            {d.label}
                          </label>
                          {slot ? (
                            <span className="hours-range">
                              <select
                                value={slot[0]}
                                onChange={(e) =>
                                  setHours({
                                    ...hours,
                                    days: { ...hours.days, [d.key]: [Number(e.target.value), slot[1]] },
                                  })
                                }
                              >
                                {Array.from({ length: 24 }, (_, h) => (
                                  <option key={h} value={h} disabled={h >= slot[1]}>
                                    {hourLabel(h)}
                                  </option>
                                ))}
                              </select>
                              <span>to</span>
                              <select
                                value={slot[1]}
                                onChange={(e) =>
                                  setHours({
                                    ...hours,
                                    days: { ...hours.days, [d.key]: [slot[0], Number(e.target.value)] },
                                  })
                                }
                              >
                                {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                                  <option key={h} value={h} disabled={h <= slot[0]}>
                                    {hourLabel(h)}
                                  </option>
                                ))}
                              </select>
                            </span>
                          ) : (
                            <span className="hours-closed">Closed</span>
                          )}
                        </div>
                      );
                    })}
                    <p className="field-hint">
                      Used for honest wait times — “someone will reply by 9am Tuesday” beats a live badge nobody
                      answers. Leave it unset and we just say we'll get back to them.
                    </p>
                  </>
                )}
              </div>

              {/*
                Response targets. These are read by the automations that chase a ticket
                nobody has answered — without a field here the column is one nothing can
                write, which this product has shipped twice before (faviconUrl, the
                agency-level brandName) and which reads as finished from every angle
                except a live test.
              */}
              <div className="field">
                <label>Response targets</label>
                <div className="sla-grid">
                  {SLA_LEVELS.map((level) => (
                    <Fragment key={level.key}>
                      <label className="sla-row">
                        <span className="sla-name">{level.label}</span>
                        <input
                          type="number"
                          min={SLA_FLOOR_MINS}
                          step={5}
                          value={slaValue(level.key, level.fallback)}
                          onChange={(e) => setSlaText((t) => ({ ...t, [level.key]: e.target.value }))}
                          onBlur={(e) => commitSla(level.key, e.target.value, level.fallback)}
                        />
                        <span className="sla-unit">minutes</span>
                      </label>
                      {/* Beside the row, never in the modal's top banner: with four rows and
                          a scrolling body, a refusal up there is a refusal nobody reads. */}
                      {slaError[level.key] && <p className="field-error">{slaError[level.key]}</p>}
                    </Fragment>
                  ))}
                </div>
                <p className="field-hint">
                  How long a client may wait for their first reply from a person, before we chase it
                  ourselves. <strong>Counted in the business hours above</strong>, not on the wall clock — so a
                  ticket raised at 9pm doesn't escalate three times overnight with nobody there to answer it.
                  Set the levels well apart, or the priority stops meaning anything.
                </p>
              </div>
            </>
          )}

          {tab === "knowledge" && <SupportKnowledge agencyId={agencyId} onDirtyChange={setKnowledgeDirty} />}

          {tab === "activity" && <SupportActivity agencyId={agencyId} />}

          {config && tab === "voice" && (
            <>
              <div className="field">
                <label>Greeting</label>
                <input
                  type="text"
                  value={config.greeting ?? ""}
                  placeholder="Hi! Ask me anything about your dashboard."
                  onChange={(e) => set("greeting", e.target.value)}
                />
                <p className="field-hint">
                  The first line every client sees. Leave it blank and we greet them using their own brand name.
                </p>
              </div>

              <div className="field">
                <label>Quick questions</label>
                <ChipInput
                  value={config.quickActions}
                  onChange={(v) => set("quickActions", v)}
                  placeholder="How do I add a contact? — press Enter"
                  max={5}
                />
                <p className="field-hint">Up to five buttons shown before they type anything.</p>
              </div>

              <div className="field">
                <label>What you call their customers</label>
                <input
                  type="text"
                  value={config.userNoun ?? ""}
                  placeholder="clients, members, students…"
                  onChange={(e) => set("userNoun", e.target.value)}
                />
              </div>

              <div className="field">
                <label>Tone</label>
                <input
                  type="text"
                  value={config.voiceTone ?? ""}
                  placeholder="warm and casual · straight to the point · formal"
                  onChange={(e) => set("voiceTone", e.target.value)}
                />
              </div>

              <div className="field">
                <label>Words we should never use</label>
                <ChipInput
                  value={config.forbiddenTerms}
                  onChange={(v) => set("forbiddenTerms", v)}
                  placeholder="a competitor, an old platform name…"
                  max={25}
                  invalid={(v) => (v.length >= 2 ? null : "Too short — this would match everywhere")}
                />
                <p className="field-hint">
                  On top of what we already block. An answer containing one of these is never sent — so don't add a
                  word you actually use, like your own brand name.
                </p>
              </div>

              <div className="field">
                <label>Links we're allowed to send</label>
                <ChipInput
                  value={config.allowedLinkDomains}
                  onChange={(v) => set("allowedLinkDomains", v)}
                  placeholder="acme.com — press Enter"
                  max={10}
                  invalid={(v) => (DOMAIN_RE.test(v) ? null : "Use a bare domain like acme.com")}
                />
                <p className="field-hint">
                  <strong>Empty means no links at all</strong>, which is the default and the safe choice. Only your own
                  domains belong here.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={requestClose}>
            {tab === "activity" || tab === "knowledge" ? "Close" : "Cancel"}
          </button>
          {tab !== "activity" && tab !== "knowledge" && (
            <button className="btn btn-primary" disabled={!config || saving} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>
    </div>

    {dryRun && (
      <SupportDryRun agencyId={agencyId} locations={locations} onClose={() => setDryRun(false)} />
    )}

    {pendingTab && (
      <ConfirmDialog
        title="Discard this article?"
        message="Leaving this tab closes the editor, and nothing you've written here has been saved yet."
        confirmLabel="Discard"
        danger
        onConfirm={() => {
          setKnowledgeDirty(false);
          setTab(pendingTab);
          setPendingTab(null);
        }}
        onCancel={() => setPendingTab(null)}
      />
    )}

    {confirmDiscard && (
      <ConfirmDialog
        title="Discard your changes?"
        // Names what is actually at risk. One fixed sentence about the policy would be
        // plainly wrong when the unsaved work is an article, and a warning that describes
        // the wrong thing is one people learn to click through.
        message={
          configDirty && knowledgeDirty
            ? "Neither your support policy nor the article you're writing has been saved, and both will be lost."
            : knowledgeDirty
              ? "The article you're writing hasn't been saved, so nothing you've written will be kept."
              : "Your support policy hasn't been saved — the escalation addresses, boundaries, wording and blocked terms you changed will go back to what they were."
        }
        confirmLabel="Discard"
        danger
        onConfirm={onClose}
        onCancel={() => setConfirmDiscard(false)}
      />
    )}
    </>
  );
}
