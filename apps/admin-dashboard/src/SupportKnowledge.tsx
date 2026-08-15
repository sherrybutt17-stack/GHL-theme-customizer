import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "./Dialog";
import {
  addKbFeed,
  approveKbArticle,
  deleteKbArticle,
  deleteKbFeed,
  fetchKbArticles,
  fetchKbFeeds,
  saveKbArticle,
  updateKbFeed,
  type KbArticle,
  type KbFeed,
} from "./api";

/**
 * The agency's own knowledge base.
 *
 * This is the content that makes the assistant genuinely useful: their SOPs, their
 * onboarding steps, their plan definitions — the "how do I use YOUR process" questions
 * no vendor documentation will ever answer. It is also ranked above shared content at
 * retrieval time.
 *
 * Two things the UI has to be honest about, because both are invisible otherwise:
 *
 *  - **What they write is stored brand-neutral.** Their brand names are swapped for
 *    {{PLATFORM}} on save, so one article works across every sub-account even when
 *    those carry different brand names. They see the placeholder when editing, which
 *    looks odd for a second and then teaches the mechanism.
 *  - **A quarantined article is invisible to the assistant.** If they paste something
 *    naming the vendor, it is stored but never retrieved. Saying "saved" and nothing
 *    else would be a lie of omission, so the offending terms are named.
 *
 * FEEDS are the same content by a different route. Pointing us at their blog or help site
 * means it keeps itself current instead of decaying, which is the failure mode of every
 * knowledge base ever written. Two things the panel has to make plain:
 *
 *  - **Items wait for review at first.** The brand gates prove an item names no vendor;
 *    they cannot prove it is accurate, current, or even a how-to. A changelog entry
 *    ingested as an article makes the assistant answer "how do I add a contact" with a
 *    release note, so a new feed publishes to a queue until somebody has read a few.
 *  - **A broken feed has to be visible.** A feed that has 404'd for a month reads exactly
 *    like a publisher who stopped writing, so the error and its age are shown rather than
 *    the row simply sitting there looking fine.
 */

const EXAMPLE = `Example — the kind of thing worth adding:

"Onboarding a new client

Once your account is live, we set up your pipeline stages in the first week. Book your
kickoff call from the calendar link in your welcome email, and we'll walk through
importing your existing contacts together."`;

export function SupportKnowledge({
  agencyId,
  onDirtyChange,
}: {
  agencyId: string;
  /**
   * Reported UP to the settings modal, which owns Escape and the backdrop click.
   *
   * Without it, the modal's own discard guard is fingerprinted from the support CONFIG
   * and cannot see a half-written article at all — so the guard would let Escape close
   * the modal over the longest piece of free text on the whole screen while correctly
   * protecting a one-word tone field. A dirty check that covers only what its own
   * component knows about is worse than none, because it reads as protection.
   */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [articles, setArticles] = useState<KbArticle[]>([]);
  const [shared, setShared] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id?: string; title: string; body: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState<KbArticle | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [feeds, setFeeds] = useState<KbFeed[]>([]);
  const [feedUrl, setFeedUrl] = useState("");
  const [feedBusy, setFeedBusy] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  /**
   * An article draft is the most typed-into thing on this screen — a title and a body the
   * agency was told to "write as you'd explain it to a client" — and Cancel threw it away
   * with no warning, as did Escape and a backdrop click on the modal around it.
   *
   * Compared against what the editor was OPENED with, so re-editing an existing article
   * and changing nothing is correctly not dirty.
   */
  const opened = useRef<string | null>(null);
  const [confirmDiscardEdit, setConfirmDiscardEdit] = useState(false);
  const editDirty = editing !== null && opened.current !== JSON.stringify({ t: editing.title, b: editing.body });

  useEffect(() => {
    onDirtyChange?.(editDirty);
    // On unmount the draft goes with the component, so the parent must stop being warned
    // about work that no longer exists.
    return () => onDirtyChange?.(false);
  }, [editDirty, onDirtyChange]);

  function openEditor(next: { id?: string; title: string; body: string }) {
    opened.current = JSON.stringify({ t: next.title, b: next.body });
    setEditing(next);
  }

  function closeEditor() {
    opened.current = null;
    setConfirmDiscardEdit(false);
    setEditing(null);
  }

  function requestCloseEditor() {
    if (editDirty) setConfirmDiscardEdit(true);
    else closeEditor();
  }

  function load() {
    fetchKbArticles(agencyId)
      .then((r) => {
        setArticles(r.articles);
        setShared(r.sharedArticles);
        setError(null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    // Feeds fail independently: a feed listing that errors should not blank the articles.
    fetchKbFeeds(agencyId)
      .then((r) => setFeeds(r.feeds))
      .catch(() => setFeeds([]));
  }

  useEffect(load, [agencyId]);

  async function addFeed() {
    const url = feedUrl.trim();
    if (!url) return;
    setFeedBusy(true);
    setFeedError(null);
    try {
      const { feed } = await addKbFeed(agencyId, url);
      setFeeds((f) => [...f, feed]);
      setFeedUrl("");
    } catch (e) {
      setFeedError((e as Error).message);
    } finally {
      setFeedBusy(false);
    }
  }

  async function patchFeed(id: string, patch: { enabled?: boolean; autoPublish?: boolean }) {
    // Optimistic: these are toggles, and a round trip before the switch moves feels broken.
    setFeeds((f) => f.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    try {
      await updateKbFeed(agencyId, id, patch);
    } catch (e) {
      setFeedError((e as Error).message);
      load();
    }
  }

  async function removeFeed(id: string) {
    setFeeds((f) => f.filter((x) => x.id !== id));
    try {
      await deleteKbFeed(agencyId, id);
    } catch (e) {
      setFeedError((e as Error).message);
      load();
    }
  }

  async function approve(id: string) {
    try {
      await approveKbArticle(agencyId, id);
      setArticles((a) => a.map((x) => (x.id === id ? { ...x, status: "ready" } : x)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save() {
    if (!editing?.title.trim() || !editing.body.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveKbArticle(agencyId, { title: editing.title, body: editing.body }, editing.id);
      closeEditor();
      setJustSaved(saved);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setConfirmDelete(null);
    try {
      await deleteKbArticle(agencyId, id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (loading) return <div className="empty-state">Loading&hellip;</div>;

  if (editing) {
    return (
      <>
        <div className="field">
          <label>Title</label>
          <input
            type="text"
            value={editing.title}
            placeholder="Onboarding a new client"
            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            autoFocus
          />
        </div>
        <div className="field">
          <label>What should the assistant know?</label>
          <textarea
            className="custom-css"
            style={{ minHeight: 220 }}
            value={editing.body}
            placeholder={EXAMPLE}
            onChange={(e) => setEditing({ ...editing, body: e.target.value })}
          />
          <p className="field-hint">
            Write it as you'd explain it to a client. Your brand name is swapped for a
            placeholder when saved, so the same article works for every sub-account — including
            ones branded differently.
          </p>
        </div>
        <div className="kb-edit-actions">
          {editDirty && <span className="unsaved-dot" title="Unsaved changes">Unsaved changes</span>}
          <button className="btn" onClick={requestCloseEditor}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={saving || !editing.title.trim() || !editing.body.trim()}
            onClick={save}
          >
            {saving ? "Saving…" : "Save article"}
          </button>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {confirmDiscardEdit && (
          <ConfirmDialog
            title="Discard this article?"
            message="It hasn't been saved, so nothing you've written here will be kept."
            confirmLabel="Discard"
            danger
            onConfirm={closeEditor}
            onCancel={() => setConfirmDiscardEdit(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
      {error && <div className="error-banner">Error: {error}</div>}

      {justSaved?.quarantined && (
        <div className="support-blockers">
          <strong>Saved, but the assistant can't use it yet</strong>
          <p style={{ margin: "0 0 6px", fontSize: 13 }}>
            It mentions {justSaved.residualLeaks.map((t) => `“${t}”`).join(", ")}. We never let another
            company's name reach your clients, so this article is held back until that's removed.
          </p>
        </div>
      )}

      <div className="kb-head">
        <div>
          <div className="kb-count">
            {articles.length === 0
              ? "No articles yet"
              : `${articles.length} article${articles.length === 1 ? "" : "s"} of your own`}
          </div>
          <div className="field-hint" style={{ margin: 0 }}>
            Backed by {shared} general article{shared === 1 ? "" : "s"} we maintain.
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => openEditor({ title: "", body: "" })}>
          + Add article
        </button>
      </div>

      {articles.length === 0 && (
        <div className="empty-state">
          Your own content is what makes the assistant genuinely useful.
          <br />
          <span className="acc-muted">
            Your process, your plans, your onboarding — the things no generic help article covers.
          </span>
        </div>
      )}

      <div className="kb-list">
        {articles.map((a) => (
          <div className={`kb-row${a.status !== "ready" ? " kb-held" : ""}`} key={a.id}>
            <div className="kb-row-main">
              <div className="kb-row-title">
                {a.title}
                {a.status !== "ready" && <span className="kb-badge">held back</span>}
              </div>
              <div className="kb-row-body">{a.body.slice(0, 160)}…</div>
              {a.status !== "ready" && a.residualLeaks.length > 0 && (
                <div className="kb-row-warn">
                  Mentions {a.residualLeaks.map((t) => `“${t}”`).join(", ")} — remove it to make this usable.
                </div>
              )}
              {/* Held with nothing to fix = it arrived from a feed and is waiting on a
                  human. A quarantined one has terms to remove and cannot be approved. */}
              {a.status !== "ready" && a.residualLeaks.length === 0 && (
                <div className="kb-row-warn">
                  Waiting for your review — it came in from a feed, so nobody here has read it yet.
                </div>
              )}
            </div>
            <div className="kb-row-actions">
              {a.status !== "ready" && a.residualLeaks.length === 0 && (
                <button className="btn btn-sm btn-primary" onClick={() => approve(a.id)}>
                  Publish
                </button>
              )}
              <button className="btn btn-sm" onClick={() => openEditor({ id: a.id, title: a.title, body: a.body })}>
                Edit
              </button>
              {confirmDelete === a.id ? (
                <button className="btn btn-sm" style={{ color: "var(--danger)" }} onClick={() => remove(a.id)}>
                  Sure?
                </button>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(a.id)}>
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="kb-feeds">
        <div className="kb-head" style={{ marginTop: 28 }}>
          <div>
            <div className="kb-count">Keep it up to date automatically</div>
            <div className="field-hint" style={{ margin: 0 }}>
              Point us at your blog or help site and we'll pull in new posts as you publish them.
            </div>
          </div>
        </div>

        <div className="dryrun-controls">
          <input
            className="text-input"
            style={{ flex: 1, minWidth: 260 }}
            placeholder="https://yoursite.com/blog/feed.xml"
            value={feedUrl}
            disabled={feedBusy}
            onChange={(e) => setFeedUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addFeed()}
          />
          <button className="btn btn-primary" disabled={feedBusy || !feedUrl.trim()} onClick={addFeed}>
            {feedBusy ? "Adding…" : "Add feed"}
          </button>
        </div>

        {feedError && <div className="error-banner">{feedError}</div>}

        {feeds.length === 0 ? (
          <p className="field-hint">
            Most blogs publish one at <code>/feed</code>, <code>/rss</code> or <code>/feed.xml</code>. New posts
            arrive here for you to check before the assistant uses them.
          </p>
        ) : (
          <div className="kb-list">
            {feeds.map((f) => (
              <div className={`kb-row${f.lastError ? " kb-held" : ""}`} key={f.id}>
                <div className="kb-row-main">
                  <div className="kb-row-title">
                    {f.title ?? f.url}
                    {!f.enabled && <span className="kb-badge">paused</span>}
                    {f.autoPublish && <span className="kb-badge">publishes automatically</span>}
                  </div>
                  <div className="kb-row-body">{f.url}</div>
                  {f.lastError ? (
                    // Named rather than hidden: a feed that has been broken for a month
                    // looks exactly like a publisher who stopped writing.
                    <div className="kb-row-warn">
                      Couldn't read this feed ({f.lastError}). Failed {f.consecutiveErrors ?? 1} time
                      {(f.consecutiveErrors ?? 1) === 1 ? "" : "s"} in a row.
                    </div>
                  ) : (
                    <div className="field-hint" style={{ margin: "4px 0 0" }}>
                      {f.lastPolledAt
                        ? `Last checked ${new Date(f.lastPolledAt).toLocaleString()}`
                        : "Not checked yet — we'll look shortly."}
                    </div>
                  )}
                </div>
                <div className="kb-row-actions">
                  <button
                    className="btn btn-sm"
                    onClick={() => patchFeed(f.id, { autoPublish: !f.autoPublish })}
                    title={
                      f.autoPublish
                        ? "New posts will wait for you to check them"
                        : "New posts will go straight to the assistant"
                    }
                  >
                    {f.autoPublish ? "Review first" : "Publish automatically"}
                  </button>
                  <button className="btn btn-sm" onClick={() => patchFeed(f.id, { enabled: !f.enabled })}>
                    {f.enabled ? "Pause" : "Resume"}
                  </button>
                  {confirmDelete === f.id ? (
                    <button className="btn btn-sm" style={{ color: "var(--danger)" }} onClick={() => removeFeed(f.id)}>
                      Sure?
                    </button>
                  ) : (
                    <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(f.id)}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
            <p className="field-hint">
              Removing a feed stops us fetching more. Anything it already brought in stays.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
