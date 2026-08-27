import { useEffect, useRef, useState } from "react";
import { fetchEmbedInfo, type EmbedInfo } from "./api";

interface Props {
  agencyInstallId: string;
  onClose: () => void;
}

/** The three things this screen hands over, each with its own button. */
type Which = "import" | "full" | "js";

export function CssExportModal({ agencyInstallId, onClose }: Props) {
  const [embed, setEmbed] = useState<EmbedInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState<Which | null>(null);
  const [showJs, setShowJs] = useState(false);
  const [copyFailed, setCopyFailed] = useState<{ which: Which; selected: boolean } | null>(null);
  const [showFull, setShowFull] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  /**
   * One ref per snippet, so a failed copy can SELECT the text rather than tell somebody to
   * drag-select 31KB out of a 260px scroll box — see selectSnippet below.
   */
  const failRef = useRef<HTMLParagraphElement>(null);
  const preRefs: Record<Which, React.RefObject<HTMLPreElement>> = {
    import: useRef<HTMLPreElement>(null),
    js: useRef<HTMLPreElement>(null),
    full: useRef<HTMLPreElement>(null),
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (copyFailed) failRef.current?.scrollIntoView({ block: "nearest" });
  }, [copyFailed]);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setEmbed(null);
    fetchEmbedInfo(agencyInstallId)
      .then((e) => !cancelled && setEmbed(e))
      .catch((e) => !cancelled && setLoadError((e as Error).message || "Failed to load embed code"));
    return () => {
      cancelled = true;
    };
  }, [agencyInstallId, reloadKey]);

  /**
   * GHL embeds this dashboard in a cross-origin iframe, where navigator.clipboard is
   * blocked. Fall back to a hidden-textarea + execCommand, which works within a click
   * gesture; report failure so the user can copy manually.
   *
   * The comment above used to say "silently rejects" and the code then ignored exactly
   * that: `navigator.clipboard?.writeText(text)` returns a PROMISE, so a rejection is
   * never caught by the surrounding try, and the missing-API case yields `undefined`
   * without throwing either. Both fell through to `return true` and the button said
   * "Copied!" over a clipboard that still held whatever was in it before.
   *
   * That lands on the one action the entire product depends on — the agency pastes this
   * line into GHL and nothing else about Mosaic works until they do — and it fails in the
   * quietest possible way: they paste, nothing happens, and the thing that told them it
   * worked was us.
   */
  async function writeClipboard(text: string): Promise<boolean> {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) return true;
    } catch {
      /* fall through to the modern API */
    }
    // Checked rather than optional-chained: `?.` makes "there is no clipboard API" look
    // identical to "the write resolved", which is the same lie in a different costume.
    if (!navigator.clipboard?.writeText) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The manual fallback has to be performable. "Select the code above" is fine for a
   * 90-byte @import line and close to useless for the 31KB JavaScript snippet, which sits
   * in a 260px scroll box — so on a failure we put the caret round it ourselves and the
   * message drops to one keystroke.
   */
  function selectSnippet(which: Which): boolean {
    const el = preRefs[which].current;
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (!el || !sel) return false;
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    } catch {
      return false;
    }
  }

  async function copy(text: string, which: Which) {
    // Each timer clears only its OWN message. A bare setCopied(null) lets the first
    // click's timeout wipe the second click's answer, which is how a real failure
    // disappears two seconds after somebody triggers it.
    if (await writeClipboard(text)) {
      setCopyFailed((f) => (f?.which === which ? null : f));
      setCopied(which);
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 2000);
    } else {
      setCopied((c) => (c === which ? null : c));
      setCopyFailed({ which, selected: selectSnippet(which) });
      setTimeout(() => setCopyFailed((f) => (f?.which === which ? null : f)), 4000);
    }
  }

  /**
   * Rendered DIRECTLY BENEATH the button that failed, never once at the top of the body.
   *
   * It used to be a single block just under the one-line embed, so a failed "Copy full
   * CSS" reported itself 891px higher up and — measured at a 1440x780 viewport with both
   * disclosures open — SCROLLED CLEAN OUT of the modal body. The label does not change on
   * failure, so there was nothing on screen at all: a dead button. "Copy JavaScript" fared
   * only slightly better at 450px, where "select the line above" pointed at the @import
   * line rather than the snippet that had just failed, i.e. the wrong thing to copy.
   *
   * Same shape as the login-tab upload errors reported through the branding tab's slot:
   * the message was correct and nobody was looking at where it appeared. And it is the
   * mirror of the bug this component was already fixed for — that one LIED about a copy
   * that never happened; stopping the lie left the failure mute on two of three buttons.
   */
  function copyFailure(which: Which, noun: string) {
    if (copyFailed?.which !== which) return null;
    return (
      <p ref={failRef} style={{ fontSize: 12, color: "#b45309", margin: "8px 0 0" }}>
        {copyFailed.selected
          ? `Couldn't copy automatically — the ${noun} above is selected, press \u2318/Ctrl+C.`
          : `Couldn't copy automatically — select the ${noun} above and press \u2318/Ctrl+C.`}
      </p>
    );
  }

  const placeholder = loadError ? "Couldn't load — use \u201cTry again\u201d above." : "Loading…";

  const preStyle: React.CSSProperties = {
    background: "#111",
    color: "#e6e6e6",
    padding: 14,
    borderRadius: 8,
    fontSize: 11.5,
    maxHeight: 260,
    overflow: "auto",
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Embed CSS</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <div className="modal-body">
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
            Paste this <strong>one line</strong> into GHL's{" "}
            <strong>Settings &rarr; Company &rarr; Custom CSS</strong> field (not Custom JavaScript).
            You only paste it <strong>once</strong> &mdash; theme changes apply automatically
            afterward, no re-pasting.
          </p>
          {loadError ? (
            <div style={{ margin: "12px 0" }}>
              <p style={{ fontSize: 13, color: "#b91c1c", margin: "0 0 8px" }}>
                Couldn't load your embed code: {loadError}
              </p>
              <button className="btn" onClick={() => setReloadKey((k) => k + 1)}>
                Try again
              </button>
            </div>
          ) : (
            <>
              <pre ref={preRefs.import} style={preStyle}>
                {embed?.importSnippet ?? "Loading…"}
              </pre>
              <button
                className="btn btn-primary"
                disabled={!embed}
                onClick={() => embed && copy(embed.importSnippet, "import")}
              >
                {copied === "import" ? "Copied!" : "Copy one-line embed"}
              </button>
              {copyFailure("import", "line")}
            </>
          )}

          <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            {/*
              * The LABEL carries the consequence, and no longer leads with "optional".
              *
              * Everything correct about this section was one click away: expanded, it already
              * explains that the snippet is never re-pasted and that the bubble appears months
              * later when support is switched on. Collapsed — which is how everyone meets it —
              * it read "Show optional JavaScript", a word that argues against the click, with
              * nothing about what skipping it costs.
              *
              * That is the same trap as the onboarding page, on the screen an agency returns to
              * when they DO come back. "Optional" is also not quite true: it is optional for
              * theming and required for the tab title, the favicon and support, which is a
              * different sentence and the one worth saying.
              */}
            <button className="btn btn-ghost" onClick={() => setShowJs((v) => !v)}>
              {showJs ? "Hide" : "Show"} the JavaScript snippet (tab title, favicon, client support)
            </button>
            {!showJs && (
              <p style={{ fontSize: 12, color: "#92610a", margin: "6px 0 0" }}>
                Paste it even if support is off today — it stays inactive until you switch support
                on, and skipping it is the one thing that brings you back here later.
              </p>
            )}
            {showJs && (
              <>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "8px 0" }}>
                  Not needed for theming — needed for the three things CSS cannot do: the
                  browser-tab title, the favicon, and the client support bubble. Paste this{" "}
                  <strong>once</strong> into GHL's{" "}
                  <strong>Settings &rarr; Company &rarr; Custom JavaScript</strong>.
                </p>
                {/*
                  Stated explicitly because the alternative is an agency turning support on
                  later, seeing nothing appear, and having no way to know a re-paste was the
                  missing step.
                */}
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "8px 0" }}>
                  You never re-paste it. It reads each sub-account's theme live, and the support
                  bubble appears or disappears as you switch support on and off — including if you
                  turn support on for the first time months from now.
                </p>
                <pre ref={preRefs.js} style={preStyle}>
                  {embed?.jsSnippet ?? placeholder}
                </pre>
                <button
                  className="btn"
                  disabled={!embed}
                  onClick={() => embed && copy(embed.jsSnippet, "js")}
                >
                  {copied === "js" ? "Copied!" : "Copy JavaScript"}
                </button>
                {copyFailure("js", "code")}
              </>
            )}
          </div>

          <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => setShowFull((v) => !v)}>
              {showFull ? "Hide" : "Show"} full CSS (fallback)
            </button>
            {showFull && (
              <>
                <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  If the one-liner doesn't take effect, paste this full version instead. Note: you'll
                  need to re-copy it here whenever you change a theme.
                </p>
                <pre ref={preRefs.full} style={preStyle}>
                  {embed?.fullCss ?? placeholder}
                </pre>
                <button
                  className="btn"
                  disabled={!embed}
                  onClick={() => embed && copy(embed.fullCss, "full")}
                >
                  {copied === "full" ? "Copied!" : "Copy full CSS"}
                </button>
                {copyFailure("full", "code")}
              </>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
