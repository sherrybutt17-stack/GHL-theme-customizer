import { useEffect, useState } from "react";
import { runSupportDryRun, type DryRunResponse, type LocationRow } from "./api";

/**
 * "Try it before you switch it on."
 *
 * The generic compliance fixtures prove the SYSTEM is sound. This proves THIS agency is:
 * their real brand name, their real renamed menu items, their real hidden features. Those
 * are exactly the inputs that differ per agency, and exactly what a fixture can't cover.
 *
 * Deliberately shows the full answer text, not just a pass badge. The gates can only
 * catch what they're built to catch; the agency reading six real answers in their own
 * client's voice is the check that catches everything else — tone, accuracy, whether it
 * sounds like their business at all.
 */
export function SupportDryRun({
  agencyId,
  locations,
  onClose,
}: {
  agencyId: string;
  locations: LocationRow[];
  onClose: () => void;
}) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DryRunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await runSupportDryRun(agencyId, locationId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const renamed = result?.renamedLabels ?? [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 660 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Try it on a real sub-account</h2>
        </div>

        <div className="modal-body">
          <p className="field-hint" style={{ marginTop: 0 }}>
            We'll ask six awkward questions as one of your clients — including the ones designed to
            make an assistant give the game away — and show you exactly what comes back.
          </p>

          <div className="dryrun-controls">
            <select className="look-select" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.locationName ?? l.ghlLocationId}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" disabled={running || !locationId} onClick={run}>
              {running ? "Asking…" : "Run the test"}
            </button>
          </div>

          {error && <div className="error-banner">Error: {error}</div>}
          {running && <div className="empty-state">Asking six questions&hellip; this takes a few seconds.</div>}

          {result && (
            <>
              {/*
                THE PRIOR QUESTION: did the assistant answer at all?

                `answerQuestion` turns every model failure into one polite hand-off, and
                `allClean` is computed from GATE findings — so with the OpenAI account out
                of credits this screen read "Nothing leaked." over six questions the model
                never saw, and an agency would take that as a pass and switch support on.

                Amber, not red, and above the verdict: it is an instruction with a remedy,
                not a leak — the same split `App.tsx` makes for an expired session.
              */}
              {result.modelFailure && (
                <div className="session-banner" style={{ marginBottom: 12 }}>
                  <strong>
                    The assistant didn’t answer {result.modelFailure.rows} of{" "}
                    {result.modelFailure.of} questions — those aren’t results, they’re failures.
                  </strong>
                  <div style={{ margin: "4px 0 0" }}>
                    {result.modelFailure.remedy}
                    {result.modelFailure.permanent
                      ? " Running this again will give you the same six hand-offs."
                      : ""}
                  </div>
                </div>
              )}
              <div className={result.ready ? "dryrun-verdict ok" : "dryrun-verdict bad"}>
                <strong>
                  {result.modelFailure
                    ? "Nothing to judge yet — the assistant never ran."
                    : result.allClean
                      ? "Nothing leaked."
                      : "Something got through — don't switch this on yet."}
                </strong>
                <div className="field-hint" style={{ margin: "4px 0 0" }}>
                  Answered as <strong>{result.brandName}</strong>
                  {result.brandNameSource === "generic" && " (no brand name set — using a generic fallback)"}
                  {/* What they CHANGED, as pairs. This used to be handed every label
                      there is, so an agency who had renamed nothing was told it was
                      "using your names" for all 51 - on the screen whose entire job is
                      to show them the inputs that differ. */}
                  {renamed.length > 0 &&
                    ` · using your names: ${renamed.map((r) => `${r.from} → ${r.to}`).join(", ")}`}
                  {result.hiddenFeatures.length > 0 && ` · hiding ${result.hiddenFeatures.join(", ")}`}
                </div>
              </div>

              {/* Reading the answers is the real check — badges only cover known failures. */}
              <div className="dryrun-list">
                {result.results.map((r) => (
                  <div className={`dryrun-row${r.clean ? "" : " bad"}`} key={r.id}>
                    <div className="dryrun-q">
                      <span className={`dryrun-badge ${r.modelFailure ? "bad" : r.clean ? "ok" : "bad"}`}>
                        {r.modelFailure ? "no answer" : r.clean ? "clean" : "flagged"}
                      </span>
                      “{r.question}”
                    </div>
                    <div className="dryrun-a">{r.error ? `Couldn't answer: ${r.error}` : r.answer}</div>
                    <div className="dryrun-expect">
                      {/* Say so on the ROW too: the banner names the count, and the reader
                          still has to know WHICH of the six are real answers. The money
                          question is a correct hand-off and carries no failure. */}
                      {r.modelFailure && <strong>Not an answer — the model call failed. </strong>}
                      {r.expect}
                      {r.usedReferences === 0 && !r.escalated && " · answered without any reference material"}
                      {r.findings.length > 0 &&
                        ` · flagged: ${r.findings.map((f) => f.gate).join(", ")}`}
                    </div>
                  </div>
                ))}
              </div>

              <p className="field-hint">
                Read them as your client would. The checks catch a leaked name or a link; only you can
                tell whether it sounds like your business.
              </p>
            </>
          )}
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
