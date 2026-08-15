import { useEffect, useState } from "react";
import { fetchSupportStats, type SupportStats } from "./api";

/**
 * What the agency's clients actually asked, and how much of it never reached a human.
 *
 * Deliberately NOT an inbox — agencies get no desk access and never see a transcript.
 * What they get is the shape of the load, which is the one reason to open Mosaic that
 * has nothing to do with theming.
 *
 * Every number here is stated in plain language rather than as a metric name, because
 * the reader is an agency owner, not an analyst. "31 of 44 answered without you" beats
 * "deflection rate 70.5%".
 */

const RANGES = [7, 30, 90];

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

function duration(mins: number | null): string {
  if (mins === null) return "—";
  if (mins < 60) return `${Math.round(mins)} min`;
  const hours = mins / 60;
  return hours < 24 ? `${hours.toFixed(1)} hrs` : `${(hours / 24).toFixed(1)} days`;
}

/** A bare sparkline — no chart library for one line of daily volume. */
function Sparkline({ daily }: { daily: SupportStats["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.conversations));
  return (
    <div className="spark" role="img" aria-label={`Daily conversations, peak ${max}`}>
      {daily.map((d) => (
        <span
          key={d.date}
          className="spark-bar"
          style={{ height: `${Math.max(2, (d.conversations / max) * 100)}%` }}
          title={`${d.date}: ${d.conversations} conversation${d.conversations === 1 ? "" : "s"}`}
        >
          {/* The deflected portion, so the split is visible per day rather than only in total. */}
          <span
            className="spark-deflected"
            style={{ height: d.conversations ? `${(d.deflected / d.conversations) * 100}%` : "0%" }}
          />
        </span>
      ))}
    </div>
  );
}

export function SupportActivity({ agencyId }: { agencyId: string }) {
  const [stats, setStats] = useState<SupportStats | null>(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    fetchSupportStats(agencyId, days)
      .then((s) => !cancelled && setStats(s))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [agencyId, days]);

  if (error) return <div className="error-banner">Error: {error}</div>;
  if (!stats) return <div className="empty-state">Loading&hellip;</div>;

  const t = stats.totals;

  if (t.conversations === 0) {
    return (
      <>
        <div className="range-row">
          {RANGES.map((d) => (
            <button key={d} className={`chip${days === d ? " active" : ""}`} onClick={() => setDays(d)}>
              {d} days
            </button>
          ))}
        </div>
        <div className="empty-state">
          No conversations in the last {days} days.
          <br />
          <span className="acc-muted">Numbers appear here once clients start using the help bubble.</span>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="range-row">
        {RANGES.map((d) => (
          <button key={d} className={`chip${days === d ? " active" : ""}`} onClick={() => setDays(d)}>
            {d} days
          </button>
        ))}
      </div>

      <div className="stat-hero">
        <div className="stat-hero-num">{pct(stats.deflectionRate)}</div>
        <div>
          <div className="stat-hero-label">answered without you</div>
          <div className="stat-hero-sub">
            {t.deflected} of {t.deflected + t.escalated} finished conversations resolved by the assistant.
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <span className="stat-num">{t.conversations}</span>
          <span className="stat-label">conversations</span>
        </div>
        <div className="stat">
          <span className="stat-num">{t.clientMessages}</span>
          <span className="stat-label">questions asked</span>
        </div>
        <div className="stat">
          <span className="stat-num">{t.escalated}</span>
          <span className="stat-label">needed a person</span>
        </div>
        {/* Stated only once there is enough of it to mean anything. A "typical wait"
            computed from two hand-offs is one person's afternoon presented as a fact,
            and the reader here is an agency owner deciding whether this is working. */}
        {stats.firstReply.sampleCount >= 3 && (
          <div className="stat" title={`From ${stats.firstReply.sampleCount} hand-offs. Slowest 10%: ${duration(stats.firstReply.p90Minutes)}. Timed from when the assistant passed it to a person, not from the start of the chat.`}>
            <span className="stat-num">{duration(stats.firstReply.medianMinutes)}</span>
            <span className="stat-label">typical wait for a person</span>
          </div>
        )}
        {t.handedToAgency > 0 && (
          <div className="stat">
            <span className="stat-num">{t.handedToAgency}</span>
            <span className="stat-label">passed to you</span>
          </div>
        )}
        {stats.csat.rate !== null && (
          <div className="stat">
            <span className="stat-num">{pct(stats.csat.rate)}</span>
            <span className="stat-label">said it helped</span>
          </div>
        )}
      </div>

      <div className="field">
        <label>Daily volume</label>
        <Sparkline daily={stats.daily} />
        <p className="field-hint">
          The lighter portion of each bar is what the assistant handled on its own.
        </p>
      </div>

      {stats.topTopics.length > 0 && (
        <div className="field">
          <label>What they asked about</label>
          <div className="topic-list">
            {stats.topTopics.map((topic) => (
              <div className="topic-row" key={topic.key}>
                <span className="topic-label">{topic.label}</span>
                <span
                  className="topic-bar"
                  style={{ width: `${(topic.count / stats.topTopics[0].count) * 100}%` }}
                />
                <span className="topic-count">{topic.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats.byLocation.length > 1 && (
        <div className="field">
          <label>By sub-account</label>
          <div className="loc-stats">
            {stats.byLocation.slice(0, 10).map((loc) => (
              <div className="loc-stat-row" key={loc.locationInstallId}>
                <span className="loc-stat-name">{loc.locationName ?? "Untitled"}</span>
                <span className="acc-muted">{loc.conversations} conversations</span>
                <span className={loc.escalated > 0 ? "loc-stat-esc" : "acc-muted"}>
                  {loc.escalated} needed a person
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
