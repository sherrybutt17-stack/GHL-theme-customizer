import { useEffect, useState } from "react";
import { fetchEmbedInfo, type EmbedInfo } from "./api";

interface Props {
  agencyInstallId: string;
  onClose: () => void;
}

export function CssExportModal({ agencyInstallId, onClose }: Props) {
  const [embed, setEmbed] = useState<EmbedInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"import" | "full" | "js" | null>(null);
  const [showJs, setShowJs] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  async function copy(text: string, which: "import" | "full" | "js") {
    if (await writeClipboard(text)) {
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } else {
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 4000);
    }
  }

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
              <pre style={preStyle}>{embed?.importSnippet ?? "Loading…"}</pre>
              <button
                className="btn btn-primary"
                disabled={!embed}
                onClick={() => embed && copy(embed.importSnippet, "import")}
              >
                {copied === "import" ? "Copied!" : "Copy one-line embed"}
              </button>
            </>
          )}
          {copyFailed && (
            <p style={{ fontSize: 12, color: "#b45309", margin: "8px 0 0" }}>
              Couldn't copy automatically — select the line above and press ⌘/Ctrl+C.
            </p>
          )}

          <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => setShowJs((v) => !v)}>
              {showJs ? "Hide" : "Show"} optional JavaScript (tab title + client support)
            </button>
            {showJs && (
              <>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "8px 0" }}>
                  Optional, and needed for two things CSS can't do: the browser-tab title and
                  favicon, and the client support bubble. Paste this <strong>once</strong> into
                  GHL's <strong>Settings &rarr; Company &rarr; Custom JavaScript</strong>.
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
                <pre style={preStyle}>{embed?.jsSnippet ?? "Loading…"}</pre>
                <button
                  className="btn"
                  disabled={!embed}
                  onClick={() => embed && copy(embed.jsSnippet, "js")}
                >
                  {copied === "js" ? "Copied!" : "Copy JavaScript"}
                </button>
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
                <pre style={preStyle}>{embed?.fullCss ?? "Loading…"}</pre>
                <button
                  className="btn"
                  disabled={!embed}
                  onClick={() => embed && copy(embed.fullCss, "full")}
                >
                  {copied === "full" ? "Copied!" : "Copy full CSS"}
                </button>
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
