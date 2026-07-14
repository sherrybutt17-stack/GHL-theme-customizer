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

  // GHL embeds this dashboard in a cross-origin iframe, where navigator.clipboard
  // is blocked (silently rejects). Fall back to a hidden-textarea + execCommand,
  // which works within a click gesture; report failure so the user can copy manually.
  function writeClipboard(text: string): boolean {
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
    try {
      navigator.clipboard?.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  function copy(text: string, which: "import" | "full" | "js") {
    if (writeClipboard(text)) {
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
              {showJs ? "Hide" : "Show"} optional JavaScript (browser-tab title)
            </button>
            {showJs && (
              <>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "8px 0" }}>
                  Optional. CSS can't set the browser-tab title. To brand it, paste this{" "}
                  <strong>once</strong> into GHL's{" "}
                  <strong>Settings &rarr; Company &rarr; Custom JavaScript</strong>. Paste-once — it
                  reads each sub-account's theme live. Skip it if you only need the CSS branding.
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
