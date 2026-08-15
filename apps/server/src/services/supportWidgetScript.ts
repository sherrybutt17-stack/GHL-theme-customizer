/**
 * The support widget, served as JS the agency pastes into GHL's Custom JavaScript field.
 *
 * Three constraints shape every line of this:
 *
 *  1. SHADOW DOM IS NON-NEGOTIABLE. Mosaic injects aggressive `!important` CSS across
 *     the whole page. Without shadow isolation OUR OWN stylesheet would theme our own
 *     widget, and GHL's CSS would fight it too.
 *
 *  2. BLAST RADIUS. A CSS mistake makes something ugly; a JS exception here can break
 *     the customer's entire CRM. Every entry point is wrapped, and any failure leaves
 *     the page exactly as it was.
 *
 *  3. NOTHING HEAVY ON PAGE LOAD. This runs on the critical path of the customer's
 *     CRM, so the boot does one small fetch and builds the UI only on first click.
 *
 * It fetches JSON only, never a remote script - the same property the theme bundle has,
 * and the one GHL's marketplace policy cares about.
 */

export function generateSupportWidgetScript(agencyInstallId: string, apiBase: string): string {
  const cfg = JSON.stringify({ agencyInstallId, apiBase });

  return `/* Mosaic support widget */
(function () {
  "use strict";
  var CFG = ${cfg};
  if (window.__mosaicSupportLoaded) return;
  window.__mosaicSupportLoaded = true;

  // Same location detection the theme bundle already uses (AppUtils with a URL-regex
  // fallback), because GHL is a SPA and the location changes without a page load.
  function currentLocationId() {
    try {
      var loc = window.AppUtils && window.AppUtils.Utilities && window.AppUtils.Utilities.getCurrentLocation();
      var id = loc && (loc.id || loc._id);
      if (id) return id;
    } catch (e) {}
    var m = window.location.pathname.match(/\\/location\\/([A-Za-z0-9]+)/);
    return (m && m[1]) || null;
  }

  // Did the Mosaic stylesheet actually load? This is the #1 support ticket Mosaic
  // itself generates, so the widget answers its own most common question before a
  // human ever sees it.
  function cssApplied() {
    try {
      var sheets = document.styleSheets;
      for (var i = 0; i < sheets.length; i++) {
        var href = sheets[i].href || "";
        if (href.indexOf("/theme-css/") !== -1) return true;
      }
    } catch (e) {}
    return false;
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = { "Content-Type": "application/json" };
    if (state.token) headers["x-mosaic-conversation"] = state.token;
    return fetch(CFG.apiBase + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  // lastMessageId is the read cursor: everything after it is new to this client.
  var state = { locationId: null, config: null, token: null, conversationId: null, lastMessageId: null, open: false, busy: false, root: null, els: {} };

  var CSS = [
    ":host{all:initial}",
    "*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}",
    ".bubble{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25);z-index:2147483000;display:flex;align-items:center;justify-content:center}",
    ".bubble svg{width:26px;height:26px}",
    ".panel{position:fixed;right:20px;bottom:88px;width:360px;max-width:calc(100vw - 40px);height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:14px;box-shadow:0 12px 48px rgba(0,0,0,.28);z-index:2147483000;display:flex;flex-direction:column;overflow:hidden}",
    ".hd{padding:14px 16px;color:#fff;font-weight:600;font-size:15px;display:flex;justify-content:space-between;align-items:center}",
    ".hd button{background:transparent;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1;padding:0 4px}",
    ".body{flex:1;overflow-y:auto;padding:14px;background:#f7f8fa}",
    ".msg{margin-bottom:10px;display:flex}",
    ".msg.u{justify-content:flex-end}",
    ".bub{max-width:82%;padding:9px 12px;border-radius:12px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}",
    ".msg.b .bub{background:#fff;border:1px solid #e4e7ec;color:#1f2430;border-bottom-left-radius:4px}",
    ".msg.u .bub{color:#fff;border-bottom-right-radius:4px}",
    ".qa{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}",
    ".qa button{font-size:12.5px;padding:6px 10px;border-radius:14px;border:1px solid #d5d9e0;background:#fff;cursor:pointer;color:#39414f}",
    ".qa button:hover{border-color:#9aa4b8}",
    ".esc{margin:4px 0 10px}",
    ".esc button{font-size:13px;padding:7px 12px;border-radius:8px;border:1px solid #d5d9e0;background:#fff;cursor:pointer;width:100%;color:#39414f}",
    ".fb{display:flex;gap:6px;margin:2px 0 10px}",
    ".fb button{font-size:12.5px;padding:5px 10px;border-radius:8px;border:1px solid #d5d9e0;background:#fff;cursor:pointer;color:#39414f}",
    ".ft{padding:10px;border-top:1px solid #e4e7ec;background:#fff;display:flex;gap:8px}",
    ".ft textarea{flex:1;resize:none;border:1px solid #d5d9e0;border-radius:9px;padding:9px 10px;font-size:14px;height:40px;max-height:96px;outline:none;color:#1f2430}",
    ".ft textarea:focus{border-color:#9aa4b8}",
    ".ft button{border:none;color:#fff;border-radius:9px;padding:0 14px;cursor:pointer;font-size:14px;font-weight:600}",
    ".ft button:disabled{opacity:.5;cursor:not-allowed}",
    ".dots{display:inline-block}",
    ".dots i{display:inline-block;width:5px;height:5px;margin-right:3px;border-radius:50%;background:#9aa4b8;animation:d 1.2s infinite}",
    ".dots i:nth-child(2){animation-delay:.2s}.dots i:nth-child(3){animation-delay:.4s}",
    "@keyframes d{0%,60%,100%{opacity:.25}30%{opacity:1}}"
  ].join("");

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function scrollDown() {
    var b = state.els.body;
    if (b) b.scrollTop = b.scrollHeight;
  }

  // textContent everywhere, never innerHTML: answers are model output, and the one
  // thing we must never do is let generated text become markup inside a customer's CRM.
  function addMessage(who, text) {
    // An agent's message is styled like the assistant's on purpose: from the client's
    // side this is all "the platform's support", and a visible seam invites "so I WAS
    // talking to a robot" — which is the one conversation the white label cannot have.
    var row = el("div", "msg " + (who === "user" ? "u" : "b"));
    var bub = el("div", "bub", text);
    if (who === "user") bub.style.background = state.accent;
    row.appendChild(bub);
    state.els.body.appendChild(row);
    scrollDown();
    return row;
  }

  function addTyping() {
    var row = el("div", "msg b");
    var bub = el("div", "bub");
    var d = el("span", "dots");
    d.appendChild(el("i")); d.appendChild(el("i")); d.appendChild(el("i"));
    bub.appendChild(d);
    row.appendChild(bub);
    state.els.body.appendChild(row);
    scrollDown();
    return row;
  }

  function addEscalateButton() {
    var wrap = el("div", "esc");
    var b = el("button", null, "Talk to the team");
    b.addEventListener("click", function () {
      wrap.remove();
      escalate();
    });
    wrap.appendChild(b);
    state.els.body.appendChild(wrap);
    scrollDown();
  }

  /**
   * A person is already picking this up, so say so instead of offering a button.
   *
   * Asking someone to press "Talk to the team" after they have ALREADY been handed to
   * one reads as though nothing happened, and pressing it re-escalates a conversation
   * that is already in the queue.
   */
  function addQueueWatcher(initialText) {
    var wrap = el("div", "esc");
    var line = el("span", null, initialText || "");
    wrap.appendChild(line);
    state.els.body.appendChild(wrap);
    scrollDown();
    watchUpdates(line, wrap);
  }

  function addHandedOffNote() {
    addQueueWatcher("Someone from the team is picking this up \\u2014 no need to do anything.");
  }

  /**
   * The only poller: where am I in the queue, AND has a person replied.
   *
   * The second half is the one that matters. Before it the desk was write-only - an
   * agent's reply passed every gate, was stored, counted toward the response time the
   * agency is shown, and never reached the client's screen. Nothing fetched messages
   * at all, so the reply arrived only if the client happened to send another message.
   *
   * Both answers ride one request because every /support/api route shares ONE limiter
   * of 60 requests per minute PER IP - the same budget the chat spends SENDING, which
   * is the part that must never be starved. A second poller would double the cost of
   * waiting for no new information. GHL is a business CRM, so several staff of one
   * client routinely sit behind a single office NAT.
   *
   * Four things are deliberate:
   *   - it keeps polling AFTER the ticket leaves the queue. Being claimed is precisely
   *     when a reply is about to arrive; stopping there was the whole bug.
   *   - it stops for good on a resolved or abandoned conversation.
   *   - the interval WIDENS (15s -> 60s) so steady state is 1/min, not 3/min.
   *   - a missing estimate prints no estimate. The server returns null when it has too
   *     few samples or nobody is on the desk, and inventing "about 5 minutes" there is
   *     exactly the promise that gets remembered.
   */
  function watchUpdates(line, wrap) {
    var polls = 0;
    var MAX_POLLS = 60;
    var delay = 15000;
    var MAX_DELAY = 60000;

    function tick() {
      if (!state.conversationId || polls++ > MAX_POLLS) return;
      var url = base() + "/conversation/" + state.conversationId + "/updates";
      if (state.lastMessageId) url += "?after=" + encodeURIComponent(state.lastMessageId);

      api(url)
        .then(function (u) {
          if (!u) return;

          if (u.messages && u.messages.length) {
            for (var i = 0; i < u.messages.length; i++) {
              var m = u.messages[i];
              // The client sent it themselves and it is already on screen.
              if (m.role === "user") { state.lastMessageId = m.id; continue; }
              addMessage(m.role === "agent" ? "agent" : "bot", m.body);
              state.lastMessageId = m.id;
            }
            // A person is here, so the queue line has done its job.
            if (wrap && wrap.parentNode) wrap.remove();
          }
          // Always advance the cursor, even with nothing new: on the FIRST poll this is
          // how the widget syncs to "everything so far is already on screen" instead of
          // being handed the transcript to replay.
          if (u.cursor) { state.lastMessageId = u.cursor; saveThread(); }

          if (u.status === "resolved" || u.status === "abandoned") return;

          if (u.waiting && line && line.parentNode) {
            var text = "You're number " + u.position + " in line.";
            if (u.estimatedWaitSeconds) {
              var mins = Math.round(u.estimatedWaitSeconds / 60);
              text += mins < 1 ? " Usually under a minute." : " Usually about " + mins + " min.";
            }
            line.textContent = text;
          } else if (line && line.parentNode && !line.textContent) {
            // Nothing to say and nothing said yet - do not leave a blank row.
            if (wrap && wrap.parentNode) wrap.remove();
          }

          delay = Math.min(Math.round(delay * 1.5), MAX_DELAY);
          setTimeout(tick, delay);
        })
        .catch(function () { /* leave whatever is on screen; try again next tick */
          delay = Math.min(Math.round(delay * 1.5), MAX_DELAY);
          setTimeout(tick, delay);
        });
    }
    setTimeout(tick, 2000);
  }

  function addFeedback() {
    var wrap = el("div", "fb");
    var yes = el("button", null, "That helped");
    var no = el("button", null, "Still stuck");
    yes.addEventListener("click", function () {
      wrap.remove();
      send_feedback(true);
      addMessage("bot", "Glad that sorted it. Anything else?");
    });
    no.addEventListener("click", function () {
      wrap.remove();
      send_feedback(false);
      escalate();
    });
    wrap.appendChild(yes); wrap.appendChild(no);
    state.els.body.appendChild(wrap);
    scrollDown();
  }

  function base() {
    return "/support/api/" + CFG.agencyInstallId + "/" + state.locationId;
  }

  /**
   * Remember the thread across a page load — in sessionStorage, per sub-account.
   *
   * Without this the delivery fix is only half delivered. The conversation lived in a
   * JS variable, so a client who reloaded while waiting for a person started a brand
   * new conversation: the agent then replied into the old one, the client never saw it,
   * and firstAgentReplyAt recorded a response nobody received. That is exactly the
   * write-only failure the /updates endpoint exists to end, arriving through a
   * different door.
   *
   * sessionStorage, not localStorage, and that is the whole security argument. The
   * stored value is a per-conversation bearer that unlocks ONE chat and nothing else;
   * session scope means it dies with the tab, which is the right lifetime for a support
   * conversation and bounds any exposure to the session that created it. (An attacker
   * with script on the GHL page can already read the CRM itself, so this is not the
   * weak link — but a token that outlives the tab would be a needless one.) The agency
   * dashboard already keeps its own token this way for the same reason.
   *
   * Every access is wrapped: storage throws in private modes and inside some embedded
   * webviews, and this code runs inside a customer's CRM.
   */
  function threadKey() {
    return "mosaic_support_thread_" + CFG.agencyInstallId + "_" + state.locationId;
  }

  function saveThread() {
    try {
      if (!state.conversationId || !state.token) return;
      window.sessionStorage.setItem(threadKey(), JSON.stringify({
        conversationId: state.conversationId,
        token: state.token,
        lastMessageId: state.lastMessageId
      }));
    } catch (e) { /* storage unavailable - the widget still works, it just forgets */ }
  }

  function clearThread() {
    try { window.sessionStorage.removeItem(threadKey()); } catch (e) {}
  }

  function loadThread() {
    try {
      var raw = window.sessionStorage.getItem(threadKey());
      if (!raw) return null;
      var t = JSON.parse(raw);
      return t && t.conversationId && t.token ? t : null;
    } catch (e) { return null; }
  }

  /**
   * Redraw a restored conversation and pick the poller back up.
   *
   * Asks for the full transcript (replay=1) because the panel is empty after a reload;
   * "everything since my cursor" would paint the second half of a conversation into a
   * blank window. A conversation the desk has already finished is dropped rather than
   * restored — reopening a resolved chat to show its history reads as a live thread and
   * invites a reply into something nobody is watching.
   */
  function restoreThread() {
    var t = loadThread();
    if (!t) return;
    state.conversationId = t.conversationId;
    state.token = t.token;
    state.lastMessageId = t.lastMessageId || null;

    api(base() + "/conversation/" + state.conversationId + "/updates?replay=1")
      .then(function (u) {
        if (!u) return;
        if (u.status === "resolved" || u.status === "abandoned") {
          state.conversationId = null; state.token = null; state.lastMessageId = null;
          clearThread();
          return;
        }
        for (var i = 0; i < (u.messages || []).length; i++) {
          var m = u.messages[i];
          addMessage(m.role === "user" ? "user" : (m.role === "agent" ? "agent" : "bot"), m.body);
        }
        if (u.cursor) { state.lastMessageId = u.cursor; saveThread(); }
        // Still with a person: keep watching, or the reply that arrives next is lost
        // for the same reason as before.
        if (u.waiting || u.status === "escalated") addQueueWatcher("");
      })
      .catch(function () {
        // Could not restore - fall back to a fresh conversation rather than a dead one.
        state.conversationId = null; state.token = null; state.lastMessageId = null;
        clearThread();
      });
  }

  function ensureConversation() {
    if (state.conversationId) return Promise.resolve();
    return api(base() + "/conversation", {
      method: "POST",
      body: { pageUrl: String(window.location.href).slice(0, 500), cssApplied: cssApplied() }
    }).then(function (r) {
      state.conversationId = r.conversationId;
      state.token = r.token;
      saveThread();
    });
  }

  function send_feedback(helpful) {
    if (!state.conversationId) return;
    api(base() + "/conversation/" + state.conversationId + "/feedback", {
      method: "POST",
      body: { helpful: helpful }
    }).catch(function () {});
  }

  function escalate() {
    if (!state.conversationId) return;
    api(base() + "/conversation/" + state.conversationId + "/escalate", { method: "POST", body: {} })
      .then(function (r) { addMessage("bot", r.message); addQueueWatcher(""); })
      .catch(function () { addMessage("bot", "I couldn't reach the team just now — please try again in a moment."); });
  }

  function ask(text) {
    if (state.busy || !text.trim()) return;
    state.busy = true;
    state.els.send.disabled = true;
    addMessage("user", text);
    var typing = addTyping();

    ensureConversation()
      .then(function () {
        return api(base() + "/conversation/" + state.conversationId + "/message", {
          method: "POST",
          body: { text: text }
        });
      })
      .then(function (r) {
        typing.remove();
        addMessage("bot", r.reply);
        if (r.handedToHuman) addHandedOffNote();
        else if (r.canEscalate) addEscalateButton();
        else addFeedback();
      })
      .catch(function () {
        typing.remove();
        addMessage("bot", "Sorry — something went wrong on my end. Want me to pass this to the team?");
        addEscalateButton();
      })
      .then(function () {
        state.busy = false;
        state.els.send.disabled = false;
        state.els.input.focus();
      });
  }

  function buildPanel() {
    var panel = el("div", "panel");
    var hd = el("div", "hd");
    hd.style.background = state.accent;
    hd.appendChild(el("span", null, state.config.brandName + " Support"));
    var close = el("button", null, "\\u00d7");
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", toggle);
    hd.appendChild(close);

    var body = el("div", "body");
    var ft = el("div", "ft");
    var input = document.createElement("textarea");
    input.rows = 1;
    input.placeholder = "Ask a question\\u2026";
    var send = el("button", null, "Send");
    send.style.background = state.accent;

    ft.appendChild(input); ft.appendChild(send);
    panel.appendChild(hd); panel.appendChild(body); panel.appendChild(ft);

    state.els.body = body; state.els.input = input; state.els.send = send;

    send.addEventListener("click", function () { var v = input.value; input.value = ""; ask(v); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        var v = input.value; input.value = ""; ask(v);
      }
    });

    addMessage("bot", state.config.greeting);
    if (state.config.quickActions && state.config.quickActions.length) {
      var qa = el("div", "qa");
      state.config.quickActions.forEach(function (q) {
        var b = el("button", null, q);
        b.addEventListener("click", function () { qa.remove(); ask(q); });
        qa.appendChild(b);
      });
      body.appendChild(qa);
    }
    return panel;
  }

  function toggle() {
    state.open = !state.open;
    if (state.open) {
      if (!state.els.panel) {
        state.els.panel = buildPanel();
        state.root.appendChild(state.els.panel);
      }
      state.els.panel.style.display = "flex";
      state.els.input.focus();
    } else if (state.els.panel) {
      state.els.panel.style.display = "none";
    }
  }

  function mount() {
    var host = document.createElement("div");
    host.id = "mosaic-support-root";
    // Shadow DOM: without this our own !important theme CSS would style this widget.
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    var style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);

    var bubble = el("button", "bubble");
    bubble.setAttribute("aria-label", "Support");
    bubble.style.background = state.accent;
    bubble.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
    bubble.addEventListener("click", toggle);
    root.appendChild(bubble);

    document.body.appendChild(host);
    state.root = root;
    state.els.host = host;
  }

  function boot() {
    var locationId = currentLocationId();
    if (!locationId || locationId === state.locationId) return;
    state.locationId = locationId;

    // One small fetch on load. If support is off for this sub-account the server 404s
    // and nothing is built at all.
    api(base() + "/config")
      .then(function (cfg) {
        if (!cfg || !cfg.enabled) return;
        state.config = cfg;
        state.accent = "#2b6ef6";
        if (state.els.host) { state.els.host.remove(); state.els = {}; state.open = false; }
        state.conversationId = null;
        state.token = null;
        state.lastMessageId = null;
        mount();
        // A reload lands here with an empty panel; if this tab was mid-conversation,
        // put it back before the client wonders where their chat went.
        restoreThread();
      })
      .catch(function () {
        // Support unavailable, or the server is asleep. Say nothing and change nothing -
        // this must never degrade the page it is running on.
      });
  }

  // Everything below is wrapped: a throw here would run inside the customer's CRM.
  function safeBoot() { try { boot(); } catch (e) {} }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", safeBoot);
  } else {
    safeBoot();
  }
  try {
    if (window.AppUtils && window.AppUtils.RouteHelper && window.AppUtils.RouteHelper.onRouteChange) {
      window.AppUtils.RouteHelper.onRouteChange(safeBoot);
    }
  } catch (e) {}
  setInterval(safeBoot, 2000);
})();`;
}
