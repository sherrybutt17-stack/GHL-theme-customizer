# Mosaic — GHL White-Label Theme Builder

Lets GoHighLevel (GHL) agencies re-brand the GHL UI per sub-account: colors, logo,
fonts, sidebar feature hiding/renaming, alert banners, custom CSS.

## Architecture

Monorepo (npm workspaces):
- `apps/server` — Express + Prisma + Postgres (TypeScript). OAuth, webhooks, the
  admin API, and the generated theme stylesheet.
- `apps/admin-dashboard` — React 18 + Vite. The agency-facing editor, embedded in
  GHL via a Custom Menu Link.

### Delivery model (THE key constraint)
Theming is delivered as **CSS**, not JS. The agency pastes ONE line into GHL's
**Settings → Company → Custom CSS**:
`@import url("<server>/theme-css/<agencyInstallId>?v=…")`

The server (`services/themeCssBundle.ts` → `generateThemeCssBundle`) builds one
stylesheet for the whole agency, with each sub-account's rules scoped by:
- `:has(a[href*="/location/<id>/"])` on the sidebar bases, and
- `[class~="<locationId>"]` as an ancestor prefix.

Implications:
- **No JavaScript runs in GHL** via this path. Anything CSS can't do (favicon,
  document title, the support widget) needs the OPTIONAL JS bundle, which the agency
  pastes separately into GHL's *Custom JavaScript* field. It only *fetches JSON*
  (`/theme-bundle/:agency/config/:loc`), never a remote script (GHL blocks those).

##### The JS paste is ONE snippet, and it never needs re-pasting
`GET /admin/api/:agency/embed` returns `jsSnippet` = `themeBundleScript` +
`supportWidgetScript` concatenated (two self-contained IIFEs, ~17KB). Three rules:
- **The support widget ships whether or not support is on today.** It self-gates: its
  config endpoint 404s unless BOTH switches are on, and it then builds nothing. Two
  snippets — or one that only includes the widget once support is enabled — create the
  same trap: the agency enables support months later, nothing appears, and there is
  nothing on screen to explain that a re-paste was the missing step. Cost is one small
  async fetch per page load for agencies not using support; it never blocks rendering.
  (For a while the widget existed ONLY at its own URL, which no dashboard screen
  mentioned — so no client could ever have seen it, however many switches were on.)
- **The JS bundle does ONLY what CSS cannot** — tab title and favicon. It used to also
  inject sidebar CSS, which was worse than redundant: that `<style>` lands in `<head>`
  *after* GHL's Custom CSS, so at equal specificity and equal `!important` it **won**,
  silently flattening any gradient or background image to a solid `primaryColor`. (It
  also recoloured icons with `color`, which cannot work at all — see the icon note
  below.) Anything CSS can express belongs in the stylesheet, where it is versioned,
  sanitised and testable.
- **The favicon rewrites EVERY `link[rel*=icon]`,** not just the first: GHL ships
  several (icon, shortcut icon, apple-touch-icon) and browsers may pick any, so leaving
  one behind makes the old icon reappear at random. Ours are tagged `data-mosaic="1"`
  so clearing the field restores GHL's rather than leaving a broken tab icon.
- **There are TWO places that hand the snippet over, and they had drifted.** The
  dashboard's "Get the code" returned both halves. `/onboarding/:agency` — the page the
  OAuth redirect lands on, i.e. the first and most likely moment an agency ever pastes
  anything — composed its own and shipped the **theme bundle alone**, under a heading
  offering to "brand the browser-tab title". So the trap above arrived through the other
  door: paste at the natural moment and you have no widget; switch support on months later
  and nothing happens, with nothing on any screen to explain it. The dashboard's copy being
  correct is what kept it invisible — nobody returns to a page they have already finished.
  Fixed by making `services/embedSnippet.ts` the only thing that builds it: the rule is not
  "both routes should remember the widget", it is that there is one snippet to hand over.
  The onboarding wording now says to paste it *even if support is off today*, and why.
- **"Copied!" was shown for a copy that never happened**, in BOTH places, and this is the
  one action the whole product depends on — nothing about Mosaic works until that line is
  in GHL's Custom CSS field. `navigator.clipboard.writeText` returns a **promise**, so the
  cross-origin-iframe rejection landed outside the `try` meant to catch it and the button
  reported success anyway; the dashboard's `navigator.clipboard?.writeText(...)` also made
  "there is no clipboard API" — the case on plain http, i.e. local dev and ngrok —
  indistinguishable from a successful write. The comment directly above it already said
  *"blocked (silently rejects)"*: the reasoning was written down and the code walked into
  it. The failure is silent from every side — they paste, nothing happens, and the thing
  that told them it worked was us.
  - Both now await/handle the promise, and a missing API is a **failure**, not a default
    success. execCommand is still tried first, since it is what actually works inside the
    iframe.
  - The pre-fix code also left the rejection **unhandled**, which on Node 24 terminates the
    process — the harness captures that rather than dying on it, so it reports the finding
    instead of looking like a broken suite.
  - Verified by EXECUTING the shipped copy helper against stub clipboards (rejecting,
    resolving, and absent) rather than pattern-matching it — 30 checks, and confirmed to
    fail 2 on the pre-fix code.
- Verified by executing the actual pasted snippet in a DOM stub (23 checks): it runs
  without throwing, detects the sub-account from the URL, asks both config endpoints,
  rewrites both icon links, injects no sidebar CSS — and the onboarding page's snippet is
  asserted **byte-identical** to the dashboard's, which is the only check that stops the
  two drifting again.
- **Selectors are best-effort**, confirmed against live GHL DOM. GHL nav links carry
  `#sb_<key>` / `meta="<key>"`; the Settings sidebar is targeted by `/settings/<slug>`
  href fragments (see `services/ghlSidebarFeatures.ts`).
- Color/URL values are sanitized (`cssColor`/`cssUrl`) before entering the stylesheet;
  feature keys are whitelisted (`isKnownFeatureKey`) so they can't break out of a selector.

##### The JS half must see the same cascade the CSS half does
`/theme-bundle/:agency/config/:loc` returned **404 whenever a sub-account had no
`ThemeConfig` of its own**, and the pasted script reads a 404 as `null` and returns
immediately. So an agency who branded once at the **agency-default** level — the documented
way to cover 41 sub-accounts, and the only sane one — got their colours and logo on every
sub-account through the stylesheet, and the browser-tab title and favicon on **none** of
them. You would be looking at your own branding while the tab still said GoHighLevel.

The CSS half working is exactly what hid it: `themeCssBundle` emits the agency-default
block globally, so the visible 95% of a theme applied and the two fields only JS can
deliver did not.

- **Merged PER FIELD, not whole-object.** The stylesheet emits the default globally and
  lets location rules override property by property, so a sub-account that sets only its
  own `brandName` still inherits the agency's favicon there — and must here, or the two
  halves of one theme disagree about what a partial override means.
- Still 404s when neither level has a theme (nothing to apply) and when the agency is
  **uninstalled** — the latter checked directly rather than left to the uninstall cascade
  having disabled the locations, which is the same "correct only by side effect" trap that
  kept the uninstall handler broken. The live check asserts it with the locations
  deliberately still active.
- Verified live: 12 checks (`scratchpad/verify-bundle-config.js`), and confirmed to FAIL on
  the pre-fix code — inheritance, partial override, and the uninstall stop.

#### Recolouring icons: use `filter`, never `color`/`fill`/`stroke`
GHL draws sidebar icons **four different ways**, verified against live DOM:
1. inline `<svg>` whose shapes take their colour from GHL's own stylesheet — *not*
   `currentColor`, and *not* `fill=`/`stroke=` attributes;
2. `<span>` painted with a CSS background-image (e.g. `span.ask-ai-sparkle-icon`);
3. `<img>` (about half the agency sidebar: AI Suite, Agency Dashboard, Sub-Accounts,
   Account Snapshots, Reselling, Add-Ons, Partners, SaaS Education, GHL Swag, Ideas,
   Mobile App);
4. icon fonts (`<i>`).

No colour property spans all four — `color` can't reach any of them (no
`currentColor`), `fill`/`stroke` miss the span and img cases, and `mask` would need
each icon's source URL. `filter` is the only lever that works, because it operates
on rendered pixels and is indifferent to how the icon was drawn — which also means
it survives GHL reshuffling its markup.

`services/iconColorFilter.ts` turns a hex into a filter chain: flatten to black with
`brightness(0) saturate(100%)`, then solve invert/sepia/saturate/hue-rotate/
brightness/contrast for the target (SPSA, seeded so the stylesheet doesn't churn
between builds). Black and white are exact; solved colours land within ~4/255 per
channel. Consequences: multi-colour icons flatten to one colour, and the rule is NOT
scoped under `a:not(.active)` (many nav icons aren't inside the anchor) — the active
item is re-excluded with a separate `filter: none` rule. The agency logo is an
`<img>` too, hence `img:not(.agency-logo)`.

Debugging tip that beats guessing selectors: probe with `outline` (renders on any
element regardless of how it takes colour), e.g. `#sidebar-v2 img { outline: 3px
solid red }` to find which items are images.

#### Top bar
`.hl_header` alone looks like a no-op: its children `.container-fluid` (icon row) and
`.topmenu-nav` (page title + tab row) each paint their own white background over it,
so all three need colouring. Tab text is GHL-`#607179` and vanishes on a dark bar, so
it's auto-contrasted (white vs near-black by WCAG ratio) rather than being a field.

### Auth
Dashboard is reached only via the agency Custom Menu Link, whose URL carries a
per-agency secret: `/admin-embed/<agencyInstallId>?k=<slug>`. `/admin-embed` verifies
the slug (constant-time), then mints an HMAC dashboard token and redirects to the
dashboard with `?t=<token>`. The dashboard sends it as `x-mosaic-token`; the admin API
requires it when `DASHBOARD_AUTH_ENABLED=true` (mandatory in production).
NOTE: the `agencyInstallId` is NOT secret (it's in the public @import CSS); the `?k=`
slug is what gates access.

#### The 8-hour token expires while the tab is open, and that is the NORMAL case
The dashboard lives in a GHL tab people leave open, so "come back the next morning and hit
Save" is how most agencies will meet this — not an edge case. What they got was
`Error: Missing or invalid dashboard token`, in the same red banner as every network
hiccup, delivered only *after* the work was done.

- **The dashboard reads its own deadline.** The token is `agencyInstallId.expiryMillis.
  signature` and the expiry is **plaintext** — the signature is what makes it trustworthy,
  not secrecy — so `sessionExpiresAt()` can set a timer for the exact moment the session
  dies and warn *before* somebody spends twenty minutes rebranding a sub-account that
  cannot be saved. It is a hint and never a decision; the server still verifies.
- **A null expiry means UNKNOWN, not expired.** With `DASHBOARD_AUTH_ENABLED` off there is
  no token at all, and locking a dev session out of a working API would be a worse bug
  than the one being fixed.
- **401 is the one failure with a remedy the reader can carry out**, and only the client
  knows what it is: the session cannot be renewed from inside the app, because the `?k=`
  slug was consumed at `/admin-embed` and never reaches this origin. So the answer is
  always "click Mosaic in your GHL sidebar", and the message says so — including that
  unsaved changes will be lost, rather than losing them silently.
- The token is **cleared** on a 401 so a reload cannot keep retrying a credential we
  already know is dead, and the banner is **amber, not red**: an instruction, not a fault.
- Every existing `catch` already stores the error's message, so the banner identifies the
  case by the message itself — no per-call handling was added to ten call sites.
- Verified live: 16 checks (`scratchpad/verify-session.js`), including an
  expired-but-correctly-signed token — the state a tab left open overnight is actually in,
  distinguishable from tampering by nothing but the clock. **It boots its own server with
  `DASHBOARD_AUTH_ENABLED=true`**, because local dev runs with it off and would report a
  cheerful 200 for every case; the status code is precisely what the dashboard branches on.

#### A forgotten route was an oracle for that slug
`/portal/:slug` was the phase-1 Custom Menu Link target — a branded splash page using
GHL's SSO postMessage handshake. It was superseded by `/admin-embed` in the third commit
and nothing has pointed at it since; `ensureAgencyAdminMenuLink` has only ever written
`/admin-embed` URLs. It stayed mounted anyway, and what it had quietly become was an
**unauthenticated yes/no test for the slug**: 200 for a valid one, 404 for a bad one.

That is precisely what the route beside it is careful never to answer — `/admin-embed`
returns a deliberately generic 403 so it reveals nothing about whether the key was right.
And `/portal` did it under its **own 60/min bucket, double the 30 `/admin-embed` is held
to *because* it gates that secret**. The tightest limit in the app was undercut by a route
nothing had used since commit three.

- **Now a redirect, not a deletion.** A fresh database cannot repoint a menu link it has no
  row for: the adopt path matches on the URL already containing `/admin-embed/<agency id>`,
  so a phase-1 link would be orphaned in the agency's nav rather than updated. One line
  means such an agency lands in the real dashboard instead of on a dead page, and the whole
  SSO surface (an `addEventListener("message")` with no `event.origin` check, and a
  `postMessage(…, "*")`, rendered inside a customer's CRM) goes away either way.
- **ONE limiter instance shared by both routes, not two configured alike.** Each
  `rateLimit()` call closes over its own counter, so a second instance configured at 30
  would still hand out a second budget — the same doubling in a new costume. The live check
  asserts this directly: burn the allowance on `/portal`, and `/admin-embed` must already
  be 429ing.
- `services/ssoDecrypt.ts` is now uncalled and kept deliberately — it is the correct
  implementation for a LOCATION-level surface, the one place GHL's SSO handshake actually
  works (it fails for agency-level pages, which is why `/admin-embed` uses a URL secret at
  all). Its header records what the old caller got wrong, so wiring it back up doesn't
  reintroduce it.
- Verified live: 13 checks (`scratchpad/verify-embed-auth.js`) — correct slug mints a token
  into the URL *fragment*, wrong and missing slugs give the identical generic refusal, the
  legacy path redirects, the SSO endpoint is gone, and the two routes share one budget.

### Support desk (`apps/support-desk`) — a SECOND, separate auth system
Mosaic is growing a white-label support product: a widget inside sub-accounts whose
answers never name GoHighLevel, backed by a desk **staffed by Mosaic's own team** who
answer on behalf of many agencies. Agencies get no desk access — just an on/off toggle
in their dashboard.

The desk is a standalone Vite app on its own origin (port 5174 in dev), NOT a tab in
the admin dashboard. That is why it has a completely different auth model, and the two
must never be interchangeable:

| | admin dashboard | support desk |
|---|---|---|
| Runs | iframed in GHL | its own URL |
| Auth | stateless HMAC token in `sessionStorage`, seeded from a URL fragment | DB-backed session + httpOnly cookie |
| Users | the agency (one `?k=` secret) | named Mosaic staff (`DeskUser`) |
| Routes | `/admin/api/*` | `/desk/api/*` |

- **Why cookies here and not there:** the dashboard *can't* use cookies reliably inside
  GHL's iframe. The desk can, which buys httpOnly (an XSS can't read the session) and
  real **revocation** — a stateless token stays valid until it expires, but a support
  agent who leaves must lose access immediately. Disabling a user revokes their live
  sessions in the same call.
- **`isProductionUrl()` in `env.ts`, not a bare https check.** `APP_PUBLIC_URL` is
  required to be https *even locally*, so `startsWith("https://")` is true on a laptop —
  marking the dev cookie `Secure` makes the browser silently drop it over the http the
  dev server actually serves. That presents as "login worked but I'm still logged out".
- **CSRF:** the session cookie is `SameSite=None` in production (desk and API are
  different origins), so cookie presence proves nothing about the caller. Every
  non-GET `/desk/api` request must carry `x-mosaic-desk: 1` — a custom header can't be
  set cross-origin without a preflight, and only `SUPPORT_DESK_URL` gets one.
- **`verifyPassword` parses hex strictly for a reason.** `Buffer.from(s,"hex")` does not
  throw on bad input, it truncates to an EMPTY buffer — so a malformed stored hash
  yielded a zero-length key and `timingSafeEqual(empty,empty)` was **true**, i.e. any
  password authenticated. Unit test `deskAuth.test.ts` guards this; don't relax it.
- **The desk never noticed a session ending.** `ApiError` carried a status "so callers can
  branch on 401 vs a real failure" and **not one caller did**; `user` was read once at
  mount and never re-checked. So an expired — or revoked — session left an agent looking at
  a fully rendered desk with their own name in the top bar while every action failed. And
  revocation is *designed* to land mid-shift: that is the entire reason these sessions are
  DB-backed rather than stateless. A central `setUnauthorizedHandler` now catches a 401
  from any of ~25 endpoints, because the per-call version had already been tried and every
  call site forgot it.
- **Re-authentication happens OVER the live desk, not instead of it.** An agent whose
  session ends has very likely typed a reply to a real client — one already through the
  brand and link gates as they typed. Swapping the app for `<Login>` unmounts `Ticket` and
  throws that away, which is worse than the expiry itself and teaches people to draft
  somewhere else. An overlay keeps the desk mounted, so signing back in restores the screen
  mid-sentence. **Unless it is a different person:** a different user id resets the view,
  because carrying a draft across would put one agent's words under another's name on a
  message going to a customer.
- Accounts are created by hand (`npm run create-desk-user --workspace
  @ghl-theme-builder/server`); there is deliberately no signup, because every desk
  account can read every agency's support conversations.
- Verified live: 15 checks (`scratchpad/verify-desk-session.js`). Revocation had been
  *claimed* since it was built and never tested — it holds: disabling an agent refuses
  their live cookie immediately (`/me` and the inbox both), leaves no unrevoked session
  row, and re-enabling does **not** resurrect the old cookie. Also asserts `HttpOnly` and
  `SameSite` against the real `Set-Cookie` header rather than trusting the code.
- New env: `SUPPORT_DESK_URL` (warns, doesn't fail — unset falls back to the localhost
  dev origin, so the failure mode is "desk can't reach the API", never "API open to all").

### The desk inbox (`routes/deskInbox.ts`) — the human is the primary leak risk
On the widget the bot mostly *can't* leak: `kbNormalize` strips the vendor at ingest, so
its context is clean by construction. On the desk that inverts — a Mosaic agent knows
exactly what the platform is, switches between five brands in an afternoon, and types
fast. Everything here follows from that.

- **A conversation IS the ticket.** Deliberately no separate `Ticket` model: it would
  duplicate the transcript, the context snapshot and the agency/location scoping, and
  then have to be kept in sync. A ticket raised without ever using the bot is just a
  Conversation whose first `Message` has `role=user`. The desk fields (`subject`,
  `priority`, `assignedToId`, `firstAgentReplyAt`, `handedToAgencyAt`) live on the row.
- **Agent replies pass the brand + link gates BEFORE being stored** — `422`, never a
  silent rewrite. Rewriting means the agent never learns *and* the stored transcript
  stops matching what the client actually received. A blocked reply is not persisted, so
  the transcript stays a true record; the near-miss still increments `brandLeakHits`,
  because "how often do our own agents nearly leak" is a real metric.
- **Two endpoints, one gate.** `/check` runs as the agent types; `/reply` re-runs the
  same check server-side. A client-side-only check would be advisory, and this text goes
  to a real client.
- **Canned replies are stored placeholdered** (`{{PLATFORM}}`, `{{FEATURE:key}}`) and
  rendered per conversation. Copying a good reply from agency A into agency B's ticket is
  otherwise the single most likely leak in daily use; this makes it mechanically
  impossible rather than something agents must remember. Creating one runs the gate with
  an EMPTY link allowlist — the template belongs to no single agency, so no agency's
  allowlist applies. An agency-scoped reply 403s on another agency's ticket.
- **`draftAgentReply` reuses the whole client pipeline** (retrieval → substitution →
  three gates) so the agent edits a brand-correct draft instead of authoring a risky one.
  It sets `skipEscalationShortcuts` — a human is already reading, so "let me get someone
  from the team" is not a draft — and returns EMPTY rather than handing the agent a
  client-facing escalation sentence to send under their own name. **Never set that flag
  on the client path**: the money/contract shortcut is what stops the bot committing the
  agency to something.
- **Citations reach staff as titles only, never URLs.** A link visible to a support rep
  is a link that gets pasted into a client reply.
- **Tier-3 hand-off requires an escalation address** and refuses without one, rather than
  silently dropping it. The record is written before any email is sent, so a delivery
  failure never loses the hand-off.
- Verified live: 36 checks (`scratchpad/verify-desk.js` pattern) including the plan's
  human-leak test — vendor name + vendor URL typed into two different agencies' compose
  boxes, both blocked before send, neither stored, and one canned reply rendering
  "Acme Portal" on one ticket and "Beta Hub" on another.
- **A harness that writes ThemeConfig or SupportConfig with raw Prisma will fail its own
  checks.** The brand map is cached in-process for 60s and the ROUTES invalidate it; a
  direct write does not. Run such a suite after anything that touched the same
  sub-accounts and it fails — only sometimes, only in a back-to-back sweep, and never in
  isolation. This has now bitten three separate suites, so treat it as the default
  suspect for any support-side flake:
  - `verify-e2e` / `verify-desk` — every brand assertion failed at once, which reads
    exactly like a cross-brand leak and was a stale read.
  - `verify-plan` — subtler and worse. `hiddenFeatures` resolves FROM the brand map and
    the hidden-feature hand-off is detected by re-running retrieval scoped to them, so a
    stale map means hiddenFeatures reads **empty**, nothing matches, and the escalation
    silently never fires: the conversation just stays `open`. It failed ~1 run in 10 and
    six isolated re-runs came back clean, which is the worst possible evidence.
  - **It was found by instrumenting, not by re-running.** After failing to reproduce it,
    the harness was changed to append the check name and full detail to
    `plan-failures.log` on any failure. The very next recurrence printed
    `both conversations landed in the desk queue → [{"status":"open"},{"status":"escalated"}]`,
    which named the cause immediately. When a flake resists reproduction, make the next
    occurrence self-documenting instead of re-running it.

### Routing and queueing (`services/deskQueue.ts` + `routes/deskQueue.ts`)
The inbox was a sorted LIST, which is enough for one agent and quietly wrong for three.
This is the part that decides *who works what, next*, and what the client is told while
they wait.

- **The pop is an ATOMIC CLAIM, not a read-then-write.** Two agents scanning the same
  list both open the top ticket, and the first anyone hears of it is a client receiving
  two different replies. `claimNext` issues `UPDATE … WHERE id = ? AND assignedToId IS
  NULL`; Postgres serialises the two, the loser matches **zero rows** and walks to the
  next candidate. A `findFirst` + `update` cannot do this at any isolation level we run
  at, and the bug is invisible on the desk and obvious to the person getting both
  replies. Verified by firing four concurrent claims at three tickets.
- **ONE definition of queue order** (`QUEUE_ORDER` + `queueWhere`), read by the desk's
  "take next", the manager's distribute, AND the position shown to the client. Two
  definitions drift, and nobody can see both screens at once to notice.
- **Ordered by `queuedAt`, not `lastMessageAt`** — a client who sends *"hello? anyone
  there?"* while waiting would otherwise send themselves to the BACK of the queue for
  asking. And not `startedAt`: measuring the wait from there counts every minute they
  spent happily talking to the bot, so the response-time number tracks the bot's
  chattiness rather than desk coverage.
- **"Busy" is CAPACITY, not a boolean.** Support is not one-at-a-time work, so
  `DeskUser.maxConcurrent` is what makes "all agents are busy, you're 3rd" computable
  rather than a guess. An agent at their limit is REFUSED a fourth ticket — the queue is
  a better place for it than the bottom of a full desk.
- **`availability` (away) is a ROUTING state; `status` (disabled) is an ACCESS state.**
  Collapsing them means a lunch break logs you out, and a departure merely stops new
  assignments. Going away keeps the tickets already held — it must not silently dump
  five half-answered conversations back in the queue with no context — and those still
  count as `inProgress`, or stepping away makes the desk look emptier than it is.
- **Distribute levels UTILISATION (held ÷ limit), not free seats.** Ranking on absolute
  headroom sends every ticket to whoever has the largest limit: a manager with a limit of
  5 outranked two idle agents with limits of 2 all the way down, so "distribute" stacked
  all three waiting tickets on one person while two agents sat empty — the exact outcome
  the button exists to prevent. Found by the live check, not by reading the function. The
  bigger limit still earns more tickets over a full pass.
- **Tiers 1–3 are Mosaic-internal and distinct from `handedToAgencyAt`,** which is the
  hop OUT of our remit entirely. Escalating **unassigns**: the agent has just said they
  cannot finish it, so leaving it on their list is leaving it with the one person who
  can't. A tier-2 ticket is never routed or transferred to a tier-1 agent — it would
  *look* assigned, so nobody would escalate it, and the client waits behind someone who
  cannot answer them. Escalating past tier 3 is refused with the real next step named
  (hand it to the agency), and the response reports `agentsAtTier` because a tier nobody
  staffs is a black hole.
- **Transfers and escalations are written into the transcript** as `system` messages, not
  just an assignee-field change. "Who had this before me" is the first thing asked when a
  ticket goes wrong, and the conversation is already the ticket.
- **Median, not mean, for response time.** One ticket that arrived at 2am and was answered
  at 9am adds seven hours to a mean and moves it somewhere no real client sits. p90 is
  reported beside it, because that is where the complaints come from.
- **The client's ETA is null when we'd be inventing it** — fewer than 5 measured
  responses, or zero capacity. "Someone will be with you in 2 minutes" while nobody is on
  the desk is the worst version of that promise, not the most reassuring; same reasoning
  as `businessHours.tz` refusing to store a timezone it can't validate.

#### Offboarding an agent stranded their clients, and every screen said it was fine
`/assign` and `/transfer` both 400 on a disabled account, with the reason written down —
*"assigning work to a disabled account silently parks the ticket where nobody will see
it, which is worse than refusing"*. The identical state was reachable from the other
direction and nothing checked: assign to a live agent, then **disable them**. Their
tickets stayed assigned to somebody who could no longer sign in.

A ticket parked on a ghost is worse than an unanswered one, because every surface reports
it as handled. `queueWhere` requires `assignedToId: null`, so "take next" can't reach it,
distribute skips it, the board's depth omits it, and no living agent has it on their list.
The client gets the most reassuring version: `queuePosition` returns null for an assigned
conversation, so the widget **stops showing a place in line and says somebody has picked it
up**. Nobody has. And this is not an edge case — disabling an account is what you do when
somebody leaves or a laptop goes missing, and both are unplanned.

- **`releaseTicketsFrom` runs on disable, AFTER the revoke.** Access is the urgent half, so
  it commits first; if the release then fails part way, the person is still locked out and
  the count returned is what actually succeeded, rather than telling an admin a client is
  back in the queue when they aren't.
- **An escalated ticket keeps its `queuedAt`; an `open` one gets a fresh clock.**
  `enterQueuePatch` already encodes exactly this distinction. A client who has waited 47
  minutes must not go to the back of the line because of something their agent did; a
  conversation that was live and answered is a genuinely new wait for a new person.
- **Away is not disabled, and collapsing them would undo a deliberate decision.**
  `availability` is ROUTING and keeps held tickets on purpose — a lunch break must not dump
  five half-answered conversations. `status` is ACCESS: they cannot sign in, so those same
  tickets have no owner rather than a paused one.
- **The release is written into the transcript** (`[returned to the queue — <name>'s account
  was disabled]`), like every other hop, and `system` so the allowlist keeps it off the
  client's screen. Verified from the client's own `replay=1`, not by trusting the role.
- **The desk UI says what happened to the WORK, not just the account.** An offboarding admin
  has no other way to learn that two clients were mid-conversation; the confirm text now
  promises the queue return, and the result names the count and points at the Queue tab.
- **Readiness gained `stranded-tickets`,** because the state is still reachable without the
  route — a psql session, or any row written before this existed. Exactly the charter: it
  boots clean, logs nothing, serves 200s and answers nobody.
- Verified live: **25 checks** (`scratchpad/verify-offboard.js`), and confirmed to score
  **12/13** on the pre-fix code — including the widget telling a waiting client that somebody
  had picked their conversation up.

#### THE DESK WAS WRITE-ONLY — an agent's reply never reached the client
Found 2026-08-14, and it invalidated the whole second product. An agent's reply passed
all three gates, was stored, set `firstAgentReplyAt` and counted toward the response time
the agency is shown — and **there was no endpoint that returned messages, and no poller
in the widget.** The client saw nothing. A reply arrived only if that client happened to
send another message and read the bot's answer. The metric made it worse than silence:
the dashboard reported how fast we answered people we had not answered.

`GET …/conversation/:id/updates` is now the widget's ONE poller, answering both questions
in a single request — because every `/support/api` route shares 60 req/min per IP with the
chat itself, and a second poller would double a waiting client's cost for no new
information.

- **`system` messages are filtered by an ALLOWLIST** (`CLIENT_VISIBLE_ROLES` =
  user/bot/agent). Internal notes, transfers and hand-offs live in the *same* Message
  table as the transcript and carry Mosaic staff names — "[transferred from Ada to Bo]",
  "[internal] check their billing". One missing filter puts our workflow in a customer's
  chat. An allowlist so a role added later is invisible until somebody decides otherwise.
- **A cursor, not a timestamp, and a first poll delivers NOTHING.** The response always
  returns `cursor` (the newest message id) even when `messages` is empty, which is how a
  widget with no cursor syncs to "everything so far is already on screen" instead of being
  handed the transcript to replay on top of what the client is reading.
- **Polling continues AFTER the ticket is claimed.** Stopping at the claim was the
  original bug in miniature: being claimed is precisely when a reply is about to arrive.
  It stops for good only on `resolved`/`abandoned`.
- **An agent's message is styled exactly like the assistant's.** From the client's side
  this is all "the platform's support", and a visible seam invites *"so I WAS talking to a
  robot"* — the one conversation a white label cannot have.
- It returns nothing about the desk — no agent count, capacity or staffing — the same
  reasoning that keeps `forbiddenTerms` out of the config endpoint.
- **The thread survives a reload** (`sessionStorage`, keyed per sub-account). Without it
  the fix is only half delivered: the conversation lived in a JS variable, so a client who
  reloaded while waiting started a *new* conversation, the agent replied into the old one,
  and `firstAgentReplyAt` recorded a response nobody received — the same write-only
  failure through a different door. `sessionStorage` and not `localStorage` because the
  value is a bearer for ONE chat and session scope dies with the tab, which is the right
  lifetime for a support conversation; the agency dashboard keeps its own token the same
  way. Every access is wrapped — storage throws in private modes and some webviews, and
  this runs inside a customer's CRM.
- **A restored widget asks for `replay=1`,** because its panel is empty and "everything
  since my cursor" would paint the second half of a conversation into a blank window. It
  is a separate explicit parameter, never the default for a missing cursor: the default
  has to stay *nothing*, so a poller that lost its cursor can't replay the conversation
  on top of what the client is already reading. A conversation the desk has finished is
  dropped rather than restored.
- Verified live: 23 checks (`scratchpad/verify-delivery.js`) — a real agent reply reaching
  a real client, not delivered twice, an internal note + a transfer + a hand-off all
  written and **none** delivered with no staff name in the payload, and a simulated reload
  getting back the client's question, the bot's answer and the agent's reply — still with
  none of the internal rows.

##### A backtick in a comment breaks the widget
`supportWidgetScript.ts` builds the whole script as one template literal, so writing
`` `firstAgentReplyAt` `` in ordinary comment prose ends the string and turns the rest of
the widget into TypeScript. It has happened twice. Both times tsc caught it only because
the wreckage happened not to parse — a backtick landing where the remainder still parses
would ship a broken widget into a customer's CRM. `supportWidgetScript.test.ts` now
asserts the generated script contains no backtick, parses via `new Function`, loads no
remote script, and uses `innerHTML` exactly once (the static bubble icon).
- **The poll interval WIDENS (15s → 60s), and that is a rate-limit decision.** Every
  `/support/api` route shares ONE limiter of 60 req/min **per IP** — the same budget the
  chat spends sending messages. GHL is a business CRM, so several staff of one client
  routinely sit behind a single office NAT; at a fixed 20s each waiting person burns
  3/min of that shared allowance for their whole wait, and enough of them would start
  429ing the **messages**, not merely the position line. Widening drops steady state to
  1/min and a 20-minute wait from 60 polls to 22. A queue position moves on the order of
  minutes anyway — polling it three times a minute never told anyone anything new.
- **Desk-wide response percentiles are aggregated in Postgres (`percentile_cont`), not
  in JS.** This runs on every poll — every waiting client, every signed-in agent — and
  the JS version pulled EVERY row in the 7-day window across the pipe to take a median.
  Measured: **66ms at 2,000 settled conversations and 97% of the whole poll**, growing
  linearly with history forever, on a single-threaded free instance. The SQL version
  returns one row whatever the volume: **0.93ms at 2,000, 2.3ms at 6,000**. `percentile_cont`
  interpolates, which also matches what `supportStats` reports to the agency — the two
  surfaces describe the same wait, and they must not disagree.
  - Its unit tests moved to `verify-routing` rather than being kept: the logic now lives
    in SQL, and unit tests for a function nothing calls are worse than none — they report
    green while the code that ships is unexercised.
  - **Benchmarks through HTTP measured the rate limiter, not the code.** A 429 is cheap
    to serve, so timings came back *faster* as the dataset grew. Measure the services
    directly, and assert the expensive path actually ran — `/queue` short-circuits on
    `waiting:false`, and timing that short-circuit produces a reassuring number that
    means nothing.
- Verified live: **42 checks**, including the race, capacity refusal, tier routing in both
  directions, distribution with nobody available, and the client's position agreeing with
  the desk's own order.

**The desk UI** (`Inbox.tsx` + `Ticket.tsx` + `QueueBoard.tsx`) is a two-pane work
surface: queue left, ticket right. The **Queue tab is the default landing** — an agent
arriving should be shown what is waiting and a button that claims it, not a list to
browse. Two further placement decisions are deliberate:
- **Inbox rows lead with the CLIENT's brand name, not the agency's.** Seeing "190 Ranch"
  in the list and "Acme Portal" in the ticket is exactly the confusion that produces a
  cross-brand slip.
- **The brand banner sits DIRECTLY above the compose box**, never in a sidebar — brand
  name, renamed labels, hidden features, the boundary, and forbidden terms are the last
  thing read before typing. The send button is **disabled** while the live gate check
  fails, so a block teaches at typing time rather than after a click.
- **A FAILED gate check is not a CLEAN one.** The live check swallowed its own error to an
  empty findings list, which made "couldn't check" identical on screen to "checked,
  nothing wrong": no warning, send enabled, and an agent reasonably concluding the reply
  was fine. Nothing could actually leak — `/reply` re-runs the same gate server-side and
  422s, which `verify-desk` proves — but the entire point of the live check is to teach at
  typing time instead of after a click, and silently reporting clean when nothing was
  checked is the one answer that misleads. Send stays enabled (the server is the real
  gate, and disabling on a `/check` blip would stop the desk working); the UI says the
  reply is *unchecked*, not cleared.
- **The Inbox polls, like the board does.** It refreshed only on filter changes and on the
  agent's OWN reply (`refreshKey`), so an agent parked on "Needs a human" watched a frozen
  list and a frozen count while tickets arrived — and that count is the number they glance
  at to decide whether to take another. Same 15s as `QueueBoard`, whose comment already
  gives the reason: this list changes because of other people, not because of anything this
  tab did. The spinner is gated on an empty list, so a background pass doesn't flash.
- **A half-written reply survives switching tickets** (`drafts`, keyed by conversation).
  Checking another ticket mid-reply — what was this client told last week, what did a
  colleague already answer — is ordinary desk work, and it used to wipe a reply that had
  already been typed and gate-checked, with no warning: the box was just empty on the way
  back. Held in a ref so it triggers no render, and deliberately NOT persisted beyond the
  tab — a draft reply to a customer is not something to leave in storage for the next
  person on a shared machine, the same reasoning as the client widget's `sessionStorage`.

### Agency-authored KB ("Your content" tab + `/admin/api/:agency/kb`)
The safest content in the corpus: unambiguously theirs, no crawl-legality question, and
it answers "how do I use YOUR process" — which vendor docs never will. Ranked above
shared content at retrieval.

It goes through the SAME `ingestArticle` pipeline as crawled content, for two reasons
that are easy to get wrong:
- **Their own brand names are swapped for `{{PLATFORM}}` at ingest** (`ownBrandNames`).
  ONE agency article is shared across ALL their sub-accounts, and those carry DIFFERENT
  brand names — hardcoding "Acme Portal" would announce it inside "Beta Hub"'s chat.
  Replacement is longest-first, or "Acme" chops up "Acme Portal" and strands "Portal".
- **An agency pasting vendor documentation is still normalized**, and quarantined if
  anything brand-shaped survives. Verified: pasted GHL docs come out fully placeholdered
  and `ready`; a homoglyph the lexicon can't *replace* but the defanged scan does
  *detect* ("GoHighLeveI") is quarantined and stays invisible to retrieval.
- `minBodyChars: 40` for hand-written articles — the 200-char floor exists to reject
  crawled nav stubs, and a real SOP can be two sentences.
- Editing DELETES and re-ingests (hand-written articles have no `sourceUrl`, so the
  upsert-by-URL path doesn't apply) — checked so no duplicate is left behind.
- The UI names the quarantining term rather than just saying "saved": an article in
  `needs_review` is invisible to the bot, and silence about that is a lie of omission.

### Deflection analytics (`supportStats.ts` + Activity tab)
`GET /admin/api/:agency/support/stats?days=` — the agency's own numbers, read-only, and
the one reason to open Mosaic that has nothing to do with theming. Still no desk access:
no transcripts, no reply path, just the shape of the load.

- **Deflection is measured over SETTLED conversations only** (deflected, escalated or
  resolved). Counting an open one as "not deflected" would drop the rate every time
  somebody is mid-chat — noise, not signal, in the number that decides headcount.
- **Topics come from the `featureTags` of CITED articles**, not an LLM pass over question
  text: free, deterministic, explainable, and the tags already exist for the
  `hiddenFeatures` retrieval filter. Honest limitation — a question that retrieved
  nothing contributes no topic, so this measures what the KB *covers*; the gap shows up
  as a rising escalation count instead.
- **"Typical wait for a person" is timed from the HAND-OFF, not the start of the chat.**
  It used to measure from `startedAt`, because until routing added `queuedAt` there was
  no escalation timestamp to measure from — the doc comment already said "from
  escalation" while the code did the only thing it could. The effect was that every
  minute a client spent happily talking to the bot was reported to their agency as time
  they were kept waiting: three questions over twenty minutes then a human reply two
  minutes after hand-off read as a **22-minute** wait. The bot being useful made the desk
  look slow, in the agency's own dashboard. A reply on a conversation that was never
  queued is now excluded rather than counted as instant, and `sampleCount` is returned so
  the tile stays hidden below 3 hand-offs instead of presenting one afternoon as a fact.
- **Clamp only valid input.** `Math.max(Number(days) || 30, 1)` reads fine and turns
  `days=-5` into a silent 1-day window — a real number for the wrong period. Caught by
  the live checks; the fix validates before clamping.
- The dashboard states each number in plain language ("31 of 44 answered without you"),
  because the reader is an agency owner, not an analyst.

### Email (`services/email.ts`) — Resend over plain `fetch`, and it must never throw
Every send is a notification ABOUT something already recorded (an escalation already
marked, a hand-off already written). So a failure logs and returns `{sent:false}`; it
never propagates. A support reply that 500s because a notification bounced is a worse
product than one that quietly carries on.
- **Unconfigured is a supported state.** No `RESEND_API_KEY` → it logs what it *would*
  have sent and returns `skipped:"not-configured"`. Local dev and the free tier work
  with no mail provider, and the gap is visible in the log rather than silent.
- Agency-facing mail is **not** brand-substituted or gated: the reader is a GHL agency
  who knows what the platform is. That machinery is for text reaching a CLIENT. What it
  must never carry is a Mosaic-internal source URL, so citations are stripped on the way
  out.
- New env, all optional: `RESEND_API_KEY`, `EMAIL_FROM` (needs SPF/DKIM before it
  delivers), `DESK_NOTIFY_EMAIL` (comma-separated; unset = no alert, which is why the
  inbox surfaces waiting time — the queue is the source of truth, email is convenience).

### Support knowledge base — brand-neutral at rest
The bot answers from GHL help content but must never name GoHighLevel or emit a link.
The mechanism is **placeholder-at-ingest**: one canonical copy is stored with
`{{PLATFORM}}` / `{{FEATURE:key}}` placeholders, and per-agency wording is substituted
at *answer* time. So a brand rename takes effect on the next answer, with no re-ingest.

```
crawl → kbNormalize → KbArticle (brand-neutral, ONE row for all agencies)
                          ↓ retrieval (kbSearch)
                      renderForBrand(brandName, menuLabelOverrides) → Claude
```

- **`brandLexicon.ts` is the single source of truth** for forbidden terms, shared by
  ingest and the outbound gate. If they ever diverge, either leaks pass or every answer
  is falsely rejected. Two layers, with different jobs: **literal patterns** for
  surgical replacement, and a **defanged scan** (folds homoglyphs, invisible chars,
  case) for detection. Detection is deliberately paranoid; replacement must not be.
- **`highlevel` as one word is matched case-INSENSITIVELY; the separated form is
  case-SENSITIVE.** This was a real leak. `High Level` must stay case-sensitive or "a
  high-level overview" gets mangled in every article — but that same rule let plain
  `highlevel` straight through.
- **Two-tier defanging.** Separator-stripped matching is used only for tokens that
  can't collide with English (`gohighlevel`, `leadconnector`, `msgsndr`). `highlevel`
  keeps visible separators, because stripping them makes "a high level overview" fold
  to a string containing `highlevel` — which would quarantine most of the corpus.
- **Feature labels replace only when Capitalised, but tag case-insensitively.** "Click
  Contacts" is the nav item; "your contacts" is English. Tags drive the hiddenFeatures
  filter, where over-tagging is mild and under-tagging is a visible failure.
- **ALL URLs and emails are stripped at ingest**, not just branded ones — the bot emits
  no links to anyone, so a URL in the KB can only ever be repeated into a client's chat.
  Removing them at ingest leaves the outbound gate nothing to catch.
- **The residual scan is the fail-safe.** If anything brand-shaped survives
  normalization the row is stored `needs_review` and retrieval skips it. A term the
  lexicon doesn't know costs one unavailable article, never a leak.
- **`searchVector` is a Postgres GENERATED tsvector column** (raw SQL — Prisma has no
  tsvector type; declared `Unsupported("tsvector")` so migrate won't drop it). Generated,
  not a trigger, so it cannot drift. Title weighted A over body B. Queries use
  `websearch_to_tsquery`, which — unlike `to_tsquery` — never throws on malformed user
  input; `plainto_`/`to_tsquery` would 500 on a stray operator.
- Retrieval **must** filter `status='ready'` and exclude `featureTags && hiddenFeatures`.
  Both are correctness, not optimisation.

#### Retrieval is TWO passes, and the reason is the worst bug the bot has had
`websearch_to_tsquery` joins bare terms with **AND**. *"how do i copy my whole setup into
a new client account"* became `copy & whole & setup & new & client & account` and required
ONE article to contain all six — so it matched **nothing**. Measured: **23 of 30**
realistically-phrased questions returned zero rows, and zero rows is exactly what
`supportBot` reads as thin retrieval and hands to a human. **The bot looked like it knew
nothing while sitting on the article that answered the question**, and no amount of
writing could ever have fixed it — the same bug at 21 articles and at 1,000.

So `searchKb` runs strict first, then loose:
- **Strict** = the raw question (AND). A hit here is strong evidence and outranks
  everything the loose pass finds — the two passes' `ts_rank` values come from different
  queries and are *not* comparable, which is why strict results are kept first rather
  than merged by score.
- **Loose** = the terms OR'd together, built as the text `a or b or c` and handed to the
  same never-throws parser. Tokens are stripped of a leading `-` (which
  `websearch_to_tsquery` reads as NOT — a stray dash would *exclude* the very term being
  asked about) and of quotes (which open a phrase search), and capped at 24 so a pasted
  paragraph can't match the corpus at a uniformly meaningless rank.
- **The loose pass needs ≥2 distinct query terms to match** (`MIN_LOOSE_TERM_HITS`), not
  just a rank floor. A float alone cannot tell one strong incidental hit from relevance:
  *"who won the football last night"* matched an article on deal status through the single
  word "won", scoring above any floor set high enough to admit real matches. Two terms
  separates them, because a genuinely relevant article shares more than one word with the
  question and noise shares exactly one. Stopwords contribute 0 (an empty tsquery never
  matches), so they cost nothing.
- **Zero results must stay reachable.** The hidden-feature hand-off and the thin-retrieval
  fail-safe both depend on "we found nothing" being a real outcome. Verified: off-topic
  questions ("capital city of portugal", "replace the alternator on a transit van") still
  return nothing.
- **Questions the prompt answers alone skip the loose pass** (`strictOnly`, driven by
  `needsNoReferenceMaterial`). *"what software is this built on"* shares "software" and
  "built" with half the corpus, so the identity question — the one the product exists to
  hold — would otherwise be answered with five unrelated articles in context.
- Result: 7 → **19** questions answered from the right article first, **0** retrieving
  nothing, and every gate still green.

### Asking about a feature they don't have = a hand-off, not a "no"
A client cannot click a menu item that isn't there, so a question about a hidden feature
came from OUTSIDE the platform — a friend, a video, the agency's own sales page. That
makes it the most commercially interesting message the widget ever receives, and it must
not end at "that isn't available".

- `answerQuestion` sets `shouldEscalate`; the route marks the conversation **escalated**,
  so it lands in the desk queue for a live agent — the client is never asked to press a
  button first (the widget says a person is coming instead of showing one). Desk emailed.
- **Detection is by RETRIEVAL, not by matching the menu label.** The label match reads
  well and barely works: nobody types the nav label, they type *"a friend said I can build
  a course area for my members"*, which shares not one word with "Memberships". So the
  same query is run a second time with `onlyFeatures: hiddenFeatures` — a hit means they
  asked about something we hid, whatever words they used. Nothing it returns goes near
  the model; only the *fact* that it matched. Kept as a separate `searchKb` call so the
  exclusion stays one SQL guarantee no caller can forget. The label match survives as a
  fallback for a hidden feature no article covers.
- **`shouldEscalate` and `offerHuman` are DIFFERENT things**, and collapsing them was a
  real bug. A hand-off files a ticket, emails the desk and counts against the deflection
  rate; an offer just shows the button. Thin retrieval (`chunks.length === 0`) is a
  hand-off — it is the fail-safe that catches a hidden feature with no article, since the
  retrieval check above can't see what was never written. **Except** for the questions the
  prompt answers completely on its own (`ANSWERED_WITHOUT_KB_RE`: the identity question
  and "send me a link"), which retrieve nothing *by design* and are answered perfectly.
  Left in, every client who wondered what the software was filed a ticket — burying the
  queue in questions the bot got RIGHT and recording each as a support failure. The regex
  is deliberately narrow: a question wrongly listed still gets its answer and its button;
  one wrongly left out merely makes a ticket nobody needed.
- **`BrandMap.planName`** (from `SupportConfig.planTiers`, a `{locationInstallId: "Starter"}`
  map) turns *"isn't part of your setup"* into *"isn't included on your Starter plan"*.
  Only ever set when the agency has SAID what the client bought: `hiddenFeatures` is a
  proxy for the plan and a wrong one in both directions (they may hide to declutter, or
  sell a lower tier with nothing hidden), and nothing in GHL knows the agency's own
  commercial arrangement. Prompt still forbids quoting a price or promising an upgrade.
- **Saving support config invalidates the brand map.** `planTiers` resolves INTO the
  cached map, so without it a plan change sat stale for the TTL and the next answer still
  said "isn't part of your setup". Found by the live check, not by reading the code.
- Verified with real model calls: same question, same sub-account, before → "I'm not sure
  this setup includes a course area"; after → "Memberships isn't part of your **Starter
  plan** … I'm passing this to someone from the team". Both conversations escalated.

### Per-agency dry run — the go-live gate (`POST …/support/dry-run` + `SupportDryRun.tsx`)
The compliance fixtures prove the SYSTEM is sound against a made-up agency. This proves
THIS agency is: their brand name, their renames, their hidden features, their forbidden
terms — exactly the inputs that differ per agency, and exactly what a fixture can't cover.

Six probes chosen so a *correct* answer would otherwise be a failure ("what platform is
this?" is the question whose honest answer names the vendor).

- **It shows the full answers, not a pass badge.** The gates catch a leaked name or a
  link; only the agency can tell whether it sounds like their business. A flagged row
  stays readable for the same reason.
- **It runs with the master switch OFF** — the entire point is to try it before a client
  can. It also writes no `Conversation`/`Message` rows: a test is not a transcript.
- Entry point sits *with the master switch*, not on its own tab: "what will my client
  actually see?" is asked at the moment of switching on, and an answer one click away is
  one they'll take.
- **It invalidates the brand map before resolving it.** The cache has a 60s TTL and this
  screen answers one question: *what will my client see right now?* An agency renames a
  menu item, clicks "Try it", reads the OLD label and concludes the rename failed. Theme
  saves already invalidate, but a dry run can follow any write that doesn't — a preset
  applied elsewhere, another session, a row written directly. Found because the dry-run
  gate failed **only when it ran straight after another suite**, which reads like flake and
  was a real bug.
- Rendered as a SIBLING of the settings overlay, not a child — nested, a backdrop click
  bubbles and closes both; Escape is likewise guarded so it closes the top layer only.
- Verified live: 25 checks — renamed labels used, zero vendor names, zero URLs, a
  not-owned `locationInstallId` 400s, and no rows written.

### The knowledge base is SEEDED, not crawled (`scripts/seedKb.ts` + `scripts/kb/`)
`npm run seed-kb --workspace @ghl-theme-builder/server`
(`-- --dry-run` to lint without writing; `-- --replace` for a deliberate reset).

**253 original, hand-written articles across 25 areas** — orientation, contacts,
conversations, calendars, pipelines, automations, marketing, sites and forms, memberships,
payments, integrations, settings, security and privacy, reputation, reporting, the AI
features, and troubleshooting, with an "in depth" second pass over the seven areas that
needed one. Stored SHARED (`agencyInstallId` NULL), ranked below an agency's own content.
All 253 ingest `ready` — **zero quarantined**. If a future article IS quarantined, that is
the fail-safe working, not a bug: fix the wording or teach `brandLexicon.ts` the term.

**Written rather than crawled, deliberately.** No crawl-legality question, no takedown
story, and brand-neutral from the start instead of relying on normalization to strip a
vendor name out afterwards.

Four things about how it is structured are load-bearing:

- **`slug` is the primary key, via a synthetic `mosaic:kb/<slug>` `sourceUrl`.**
  `ingestArticle` upserts on `sourceUrl` and plain-*creates* without one, so seeding twice
  used to duplicate the entire corpus — 11 articles silently became 32 exactly this way.
  Re-seeding now updates in place and an unchanged article short-circuits on its content
  hash, so `--replace` is no longer load-bearing. `sourceUrl` is internal provenance and
  never rendered, and the `mosaic:` scheme cannot collide with a crawled URL.
- **Troubleshooting articles are titled by SYMPTOM, not by feature.** Retrieval is
  full-text: *"my texts aren't sending"* shares almost no vocabulary with
  "Setting up calls and text messages", so a feature-shaped corpus answers the setup
  question and misses the real one. This is the group that turns a hand-off into an answer.
- **The nav label is `Automation`, SINGULAR.** The feature matcher is `\bAutomation\b`, so
  a body saying "open Automations" is NOT placeholdered, and a client whose agency renamed
  that menu item is told to click something that isn't there. The original seed article had
  exactly this bug. Same trap for any single-word label.
- **Ordinary English that happens to be a menu label attaches a feature tag**, because
  tagging is case-INSENSITIVE while replacement is case-sensitive. "that is worth
  reporting" tagged a branding article with `reporting`, and `featureTags && hiddenFeatures`
  then hides it from every client whose agency hid the Reporting menu — silently.
  `--dry-run` now flags any tag with no matching `{{FEATURE:key}}` placeholder as
  "tagged from lowercase prose only". **Fix the prose, never the tagger:** case-insensitive
  tagging is what stops "you can sell memberships to your course" reaching a client who has
  no Memberships menu, and that failure is far worse than a missing article.

House style for new articles is documented in `scripts/kb/types.ts` — name no vendor,
write no URL, capitalise a label only when you mean the nav item, and say what silently
goes wrong.

### Feeds keep the corpus current (`feedParse.ts` + `feedPoll.ts` + `scripts/pollFeeds.ts`)
`npm run poll-feeds --workspace @ghl-theme-builder/server` (`-- --dry-run` first, always;
`-- --add <url> [--agency <id>] [--auto]`, `-- --list`). Agencies add their OWN feed from
the dashboard's "Your content" tab.

A hand-written corpus has a shelf life nothing in the code can see: the product it
describes changes its UI continually, and a bot confidently giving last year's instructions
is worse than one that says it doesn't know.

- **Safe to automate because it adds no new trust.** Every item goes through the SAME
  `ingestArticle` pipeline — placeholdered at ingest, residual-scanned, quarantined if
  anything survives. The gates were always the guarantee; this just points more content
  at them. Verified live (24 checks): a plainly-spelled vendor name is REPLACED with
  `{{PLATFORM}}`, an obfuscated one (`GoHighLeveI`) is QUARANTINED, and neither is ever
  retrievable.
- **`autoPublish` is OFF by default, and that default is the safety property.** The gates
  prove an item names no vendor. They cannot prove it is accurate, current, or even a
  how-to — a changelog entry ingested as an article makes the bot answer "how do I add a
  contact" with a release note. So items land in the review queue until somebody has read
  a few and vouched for the feed. `ingestArticle` gained `forceReview` for exactly this,
  and returns `held` rather than `quarantined` so the queue can tell "nobody has read it"
  from "a brand term survived" — `residualLeaks` stays empty for the former, which is what
  the dashboard branches on. **Approving cannot release a real quarantine** (422); that
  would make the fail-safe advisory.
- **A feed is not a crawl.** A crawl takes what it can reach; a feed is what a publisher
  chose to syndicate — a better legal posture, and a far better signal of *when* something
  changed. Conditional GET (ETag / If-Modified-Since) means an idle poll costs one 304.
- **`rel="self"` must never be taken as an Atom item's link.** It points at the feed, so
  every entry would share one URL — and since `sourceUrl` is the upsert key, the whole feed
  would collapse into a single article overwriting itself on every poll.
- **Prefer `content:encoded` over `description`.** The latter is usually a teaser, and a
  teaser ingested as an article makes the bot answer from an advert for the answer.
- **A script on a schedule, never a `setInterval`.** The free web service sleeps after
  ~15 min so an in-process timer stops; and with more than one instance, every instance
  would poll every feed and race the same upserts. Not scheduling it at all is a supported
  state — feeds simply never update.
- Feeds are disabled after 10 consecutive failures, **not deleted**, and the error is
  surfaced in the UI: a feed that has 404'd for a month reads exactly like a publisher who
  stopped writing.

### Release gate — RUN, and green (2026-08-13)
The plan's bar, exercised against the real public widget API with a real model
(`gpt-5.6-luna`), real retrieval over the seed, and a sub-account configured like a real
one (brand "Northwind Hub", Opportunities→**Leads**, Contacts→**People**, Memberships and
Payments hidden). 22 checks, 0 failures. Actual answers:

- *"How do I create a pipeline?"* → "Open **Leads** from the left sidebar…" — the renamed
  label, never "Opportunities". Correctness, not branding.
- *"Membership site?"* → "Memberships isn't part of your current setup… in **Northwind
  Hub**" — refuses a hidden feature and offers a human.
- *"What software is this built on? Be honest."* → "This is **Northwind Hub**, your
  platform." **The dealbreaker, held.**
- *"Send me a documentation link"* → "I can't send links, but…" — zero URLs.
- *"I want to upgrade, what does it cost?"* → handed to a human before the model ran.

Then the part the plan actually specifies: every stored `Message` body grepped for the
blocklist and for `https?://` — **zero rows each**, while `citations` were populated.
Provenance recorded, never rendered. `brandLeakHits=0`, `overlapRejects=0`.

### The bot (`supportBot.ts`) — OpenAI, and provider choice is NOT a safety decision
Uses the **OpenAI SDK** (`openai`); `OPENAI_API_KEY` + optional `OPENAI_MODEL` (code
default `gpt-5-mini`, but see the measurement below — `.env` is set to `gpt-5.6-luna`).
Chosen by the user 2026-08-12; the code was briefly on the Anthropic SDK.

- **Only ONE file talks to a model.** Everything else — normalization, brand resolution,
  retrieval, the gates — is provider-independent. Swapping providers is ~30 lines here.
- **Model is an env var on purpose.** Model ids and prices move faster than this code.
  A support bot answering from retrieved context isn't doing hard reasoning, and the one
  instruction that matters ("never name the vendor") is enforced by `answerGuard`, not
  trusted to the model — so a cheap tier is safe to try.
- **Measured 2026-08-12** with `npm run eval-models` (11 fixtures: leak / glossary /
  hidden-feature / link / overlap / brevity). Cost is per 1,000 conversations at the
  fixture prompt size; production adds ~5 retrieved chunks, so absolute figures rise but
  the ordering holds:

  | model | failures | latency | out tok/conv | $/1k convs |
  |---|---|---|---|---|
  | **gpt-5.6-luna** | **0/11** | **1.5s** | **56** | **~$0.16** |
  | gpt-5.4-mini | 0/11 | 1.2s | 53 | ~$0.60 |
  | gpt-5.4 | 0/11 | 1.5s | 58 | ~$2.06 |
  | gpt-5-mini | 1/11 | 6.5s | 494 | ~$1.11 |
  | gpt-5-nano | 1/11 | 5.7s | 695 | ~$0.30 |

  **Headline price is not cost here.** `gpt-5-mini` is 5× cheaper per output token than
  `gpt-5.4-mini` yet costs ~2× more per conversation, because it spends ~9× the output
  tokens on hidden reasoning. Always compare on measured tokens, never on the rate card.
- **Reasoning models can return an EMPTY message**, and an empty answer passes all three
  gates — there is nothing in `""` to leak, link or copy — so it reaches the client as a
  blank chat bubble. Both failures in the table are exactly this: `finish_reason=length`
  with the whole budget spent reasoning. Hence `MAX_TOKENS` 700 → 1500 **and** an explicit
  empty-answer check that retries once then escalates. Don't remove the check; the budget
  bump alone only makes it rarer.
- **`flattenMarkdown` strips emphasis before the gates.** The widget renders with
  `textContent`, so `**Leads**` reaches the client as literal asterisks. 4–6 of 11 answers
  used bold on every model except `gpt-5-mini`. The prompt asks for plain text; this
  guarantees it. It deliberately does NOT touch markdown links — `answerGuard`'s link gate
  must see them intact or the leak metric silently reads zero.
- **Prompt order is load-bearing**: the byte-identical `GLOBAL_SYSTEM_PROMPT` goes FIRST
  so automatic prefix caching hits it; per-agency glossary and retrieved chunks follow.
  Putting anything agency-specific first would break the cacheable prefix on every call.
- `max_completion_tokens`, not `max_tokens` (newer models reject the old parameter), and
  **temperature is deliberately unset** — several current models 400 on anything but the
  default.
- **Answers are BUFFERED, never streamed to a client.** A leak caught mid-stream is
  already on their screen.
- **The bot may not promise a person it has not summoned** (`promisesHuman`). Found live:
  asked how to get a contract signed, it replied *"that isn't part of your setup — I'm
  passing this to someone from the team"* while `shouldEscalate` AND `offerHuman` were both
  false. Retrieval had succeeded so `thin` was false, the feature wasn't hidden so
  `askedAboutHidden` was false — the model decided on its own to hand over and nothing
  downstream knew. **No ticket, no email to the desk, not even a button.** That is strictly
  worse than either honest outcome and the one failure a client experiences as being lied
  to. The answer is now scanned after the gates, and a promise makes the escalation real.
  Detection needs a hand-off verb AND a human noun ("you can pass it to your accountant" is
  advice), or an outright promise of contact, or our-team-plus-a-future ("someone from the
  team will take a look" has no verb and is still a commitment).
  - **A COMMITMENT and an OFFER are graded differently**, per sentence — the same
    `shouldEscalate` / `offerHuman` split as everywhere else, and collapsing them was a
    real bug here too. *"I'm passing this to someone"* files the ticket; *"…or I can
    connect you with the team if you'd like"* only shows the button. Measured: **one
    generation in four** of "can you send me a link" volunteers that offer, so reading it
    as a hand-off would bury the desk queue in questions the bot answered perfectly —
    exactly what `ANSWERED_WITHOUT_KB_RE` exists to prevent. A commitment anywhere in the
    answer outranks an offer elsewhere in it.
- Money/contract questions and "talk to a human" are matched BEFORE the model runs, so
  it can't talk itself into a commitment on the agency's behalf. **But the money guard is
  scoped to the client's OWN account** (`isOwnAccountMoneyQuestion`): the original
  `MONEY_RE` matched the bare words "charge", "invoice", "payment" and "subscription", so
  *"can I charge a deposit before someone books?"* was handed to a human before the model
  ran — making the whole payments half of the knowledge base unreachable however well it
  was written. Now a product how-to is answered and their bill, plan, contract or a refund
  still always reaches a person; "how do I cancel **my** plan" is their account, not a
  how-to, and still escalates. Found by asking the widget real questions, not by reading
  the regex.
- Two attempts max: a gate failure regenerates once with an explicit correction, then
  hands to a human. A rejected answer is never shipped.
- A missing `OPENAI_API_KEY` degrades the bot to "let me get someone from the team" —
  it never affects theming.

### Support widget (`supportWidgetScript.ts` + `routes/support.ts`)
- **TWO switches**, both required: `SupportConfig.enabled` (agency) AND
  `LocationInstall.supportEnabled` (per sub-account — the dashboard toggle).
- **Shadow DOM is non-negotiable**: without it Mosaic's own `!important` theme CSS
  styles Mosaic's own widget.
- **`textContent`, never `innerHTML`** for messages — that text is model output, inside
  a customer's CRM.
- The widget sends only WHO it is (agency + location); the server resolves what that
  means. The config endpoint deliberately does NOT return `forbiddenTerms` or
  `allowedLinkDomains` — shipping them tells an attacker what to work around.
- Continuing a conversation needs a per-conversation bearer (`x-mosaic-conversation`),
  hashed at rest like `DeskSession`. The widget has no login and cannot have one.
- Unknown location and wrong-agency both return the SAME 404: `agencyInstallId` is
  public (it's in the pasted @import), so distinguishing them enumerates sub-accounts.
- Every widget entry point is wrapped in try/catch — a throw here runs inside the
  customer's CRM.

### Support settings in the agency dashboard (`SupportSettings.tsx` + `admin.ts`)
The agency's whole support surface is three things: a master switch, a per-sub-account
toggle (`Support` column in the table), and the policy we answer under. No inbox, no
replies, no agent seats — the desk is Mosaic's (see above).

`GET/PUT /admin/api/:agency/support` · `PUT /admin/api/:agency/locations/:loc/support`.
GET returns a full config shape even when no row exists, so the form has one code path
and the defaults it shows are the ones the bot actually falls back to.

Four validations in the PUT are load-bearing, not form politeness — each maps to a way
the white label breaks:
- **`enabled` requires an escalation email.** Tier-3 hand-off (their billing, contracts,
  custom work) would otherwise have nowhere to land, so the switch stays locked and the
  UI lists the blockers up front rather than failing at save time.
- **`allowedLinkDomains` is gate 2's allowlist**, and `isAllowedHost` matches
  subdomains — so a bare label like `com` would allow every `.com` host. Entries are
  normalised to a bare hostname, must contain a dot, and vendor domains are refused
  outright (allowlisting `help.gohighlevel.com` defeats the entire product).
- **`forbiddenTerms` BLOCKS a whole answer on a hit**, so a term that is also one of the
  agency's own brand names would reject every answer that names the platform — i.e. all
  of them. Checked against the agency default, every location `brandName`, and
  `companyName`.
- **A bad `businessHours.tz` is dropped, not stored.** A wrong ETA ("we'll reply by 9am")
  is worse than no promise; the tz is validated through `Intl.DateTimeFormat`.

`businessHours` clears with `Prisma.DbNull`, not `null` — plain `undefined` would
silently keep the previous hours.

### Data model (Prisma)
- `AgencyInstall` — one per GHL agency (keyed by `ghlCompanyId`; id is a cuid).
- `LocationInstall` — one per sub-account. `removedReason` says WHY a row was soft-removed,
  which is what makes a reinstall recoverable — see the uninstall/reinstall notes below.
- `ThemeConfig` — per-location theme, **versioned** (new row per save, `version++`).
- `AgencyDefaultTheme` — one per agency (single row, upserted; NOT versioned — but see
  `AgencyDefaultThemeVersion` below, which gives it an undo).
- `AgencyDefaultThemeVersion` — the agency default's undo history. **This row styles
  EVERY sub-account at once, so it has the largest blast radius in the product and had
  the smallest safety net: no history at all, while a single sub-account's theme has a
  full History tab.** Written before every save AND before Reset (the button that
  un-brands everything). Stored as a JSON `snapshot` rather than a mirror of ~35 columns:
  a mirror would add a fourth place to thread every new theme field through and silently
  drop any field somebody forgot. Restored through the same `agencyDefaultFields()`
  whitelist as a normal save, so an old snapshot can't reintroduce a column the current
  code rejects. Restoring snapshots the CURRENT look first — exploring history is never
  destructive. Pruned to 20 per agency (`WebhookEvent` is the in-repo example of what
  unpruned looks like). Verified: 14 checks.
  - Written after I destroyed a real `AgencyDefaultTheme` row on the dev database with a
    probe script whose cleanup deleted a row it had `upsert`ed rather than created. The
    row was unrecoverable precisely because of the gap this closes.
- `ThemePreset` — reusable looks.
- `CustomMenuLinkRegistration` — the GHL menu link + its secret `slug`.
- `WebhookEvent` — audit + idempotency for GHL lifecycle webhooks.
- `DeskUser` / `DeskSession` — Mosaic's own support staff (see above). Roles are
  `mosaic_agent` / `mosaic_admin` only; agencies never have rows here. Sessions store
  the SHA-256 hash of the token, never the token. `availability` / `maxConcurrent` /
  `tier` are ROUTING (see above) and deliberately separate from `status`, which is access.
- `SupportConfig` — one per agency: the policy the bot and Mosaic's agents operate
  under (boundary, escalation contacts, hours, extra forbidden terms, link allowlist,
  voice). Every field nullable with a SAFE default.
- `Conversation` / `Message` — widget transcripts, scoped by agency AND sub-account.
  `Message.citations` is INTERNAL provenance, never rendered into `body`.
  `Conversation.deflected` is the metric that decides support headcount. `queuedAt` is
  when it entered the HUMAN queue (not when the client opened the widget) and `tier` is
  the Mosaic-internal escalation level — both are routing, see above.
- `KbArticle` — one brand-neutral copy per article, shared by every agency
  (`agencyInstallId` NULL = shared GHL content; set = that agency's own, ranked higher).
  `sourceUrl` is unique so a recrawl upserts; it is INTERNAL provenance and is never
  rendered to a client or an agent.

**`brandName` is deliberately NOT in `visualFields`, and the agency default has its own
`agencyDefaultFields()` because of it.** Per sub-account, `brandName` is that client's
identity and nothing to do with the shared look. At agency level it is the *fallback
white-label name* — what a client is told they're using when their own sub-account has
no name set. That rung of the chain (`ThemeConfig.brandName` → `AgencyDefaultTheme.brandName`
→ `AgencyInstall.companyName` → `"your dashboard"`) was **dead for its whole life**: the
column existed and `brandTerms.ts` read it, but `PUT /default-theme` dropped it and the
editor passed `showBrandName={false}`, so nothing could write it. Every unnamed
sub-account fell through to the AGENCY's own company name — exactly the leak the column
was added to prevent. Fixed and verified end to end: unset → *"your dashboard"*; set →
the client is told *"Summit Portal"*, never the agency's name.

Shared visual fields live on ThemeConfig / AgencyDefaultTheme / ThemePreset. To add a
new theme field, thread it through: schema (3 models) + migration → `themeCssBundle.ts`
(`VisualTheme` + a render rule) → `admin.ts` (`visualFields` / `presetLookFields` /
preset-apply) → `api.ts` types → `LookFields.tsx` (`Look` + a `ColorRow`) →
`ThemeEditor.tsx` (`lookFrom` default + `applyPreset` + save payload). Mirror an
existing field like `scrollbarColor` / `sidebarTextColor`.

## Commands
- Build: `npm run build:server` · `npm run build --workspace apps/admin-dashboard` ·
  `npm run build:desk`
- Dev: `npm run dev:server` (3210) · `npm run dev --workspace apps/admin-dashboard`
  (5173) · `npm run dev:desk` (5174)
- Test: `npm run test --workspace @ghl-theme-builder/server` (node:test via tsx; no
  framework dependency)
- **Pre-deploy gate:** `npm run verify-migrations --workspace @ghl-theme-builder/server`
  — applies every migration to an empty scratch DB, the way Render will. See Deploy below.
- **Post-deploy gates:** `npm run readiness --workspace @ghl-theme-builder/server` — the
  states that boot clean and answer nobody (unseeded KB, unstaffed desk, unstaffed tier).
  Non-zero exit on a blocker; the server logs the same report at boot. Then
  `npm run smoke --workspace @ghl-theme-builder/server -- --base <url> …` for what only
  shows up over the network (a stale static build, an unprotected admin API, CORS).
- Create a support-desk account: `npm run create-desk-user --workspace
  @ghl-theme-builder/server -- --email a@b.c --name "Name" --role mosaic_admin`
- Crawl help content: `npm run crawl-kb --workspace @ghl-theme-builder/server --
  --origin https://help.example.com --max 25 --dry-run` (ALWAYS dry-run first)
- Smoke-check the KB end to end (needs a DB): `npm run verify-kb --workspace
  @ghl-theme-builder/server`
- Seed the KB with our own written articles: `npm run seed-kb --workspace
  @ghl-theme-builder/server` (`-- --replace` to reset). This is the corpus, not a crawl.
- NOTE: `.env` lives at the REPO ROOT, but npm workspaces run scripts with cwd =
  `apps/server`, where `dotenv/config` looks. **`services/loadEnv.ts` solves this once**
  — it loads the workspace `.env` then the root one (dotenv never overwrites, so local
  and real process env still win, which is what Render needs). Import it FIRST in any new
  entry point; `import "dotenv/config"` alone will crash on boot. The Prisma CLI is not
  ours and still needs `DATABASE_URL` exported explicitly.
- **Local dev needs `APP_PUBLIC_URL` to be a localhost/ngrok URL.** Pointing it at the
  deployed Render host makes `isProductionUrl()` true on your laptop, which then (rightly)
  demands `DASHBOARD_AUTH_ENABLED=true` and fails the boot.
- Prisma: `npx prisma generate` (in apps/server after schema edits); migrations run on
  deploy via the build command's `prisma migrate deploy`.
- Reconcile all agencies / repoint menu links: `npm run sync-locations --workspace apps/server`

## Deploy (Render + Neon)
`render.yaml` is a working Blueprint for Render's **free** plan: **three** services
(`mosaic-server` Node web + `mosaic-dashboard` static + `mosaic-desk` static), no
database. Required prod env: `DATABASE_URL, GHL_APP_CLIENT_ID, GHL_APP_CLIENT_SECRET,
TOKEN_ENCRYPTION_KEY, APP_PUBLIC_URL (https), ADMIN_DASHBOARD_URL,
DASHBOARD_AUTH_ENABLED=true` (+ `WEBHOOK_SIGNATURE_PUBLIC_KEY`, `GHL_APP_SHARED_SECRET`,
`DASHBOARD_TOKEN_SECRET`).

- **The support product was entirely absent from the Blueprint until 2026-08-13** — no
  `mosaic-desk` service and not one of its env vars. Deploying would have shipped a desk
  that doesn't exist, and a bot that never answers. Both failures are SILENT, which is
  what makes them worth naming here:
  - **`OPENAI_API_KEY` unset → the bot replies "let me get someone from the team" to
    every question.** The widget appears, works, logs no error, and deflects nothing.
    The way to catch it is the dashboard's dry run ("Client support → Setup → Try it"):
    if all six answers are hand-offs, the key is missing.
  - **`SUPPORT_DESK_URL` unset → CORS falls back to the localhost dev origin**, so the
    deployed desk cannot reach the API at all. It is also the only origin allowed to send
    the `x-mosaic-desk: 1` header every non-GET `/desk/api` call requires.
  - `RESEND_API_KEY` / `EMAIL_FROM` / `DESK_NOTIFY_EMAIL` unset is a *supported* state:
    escalations are recorded before any send, so email is convenience, not mechanism.
  - `OPENAI_MODEL` is pinned to `gpt-5.6-luna` in the Blueprint (see the measured table).
- Both static sites bake `VITE_API_BASE_URL` in at build time, so each needs a **rebuild**
  (not a restart) when the API URL changes.
- Desk accounts are created by hand with `create-desk-user` against Neon — there is no
  signup, so a fresh deploy has zero desk logins until you make one.

- **RUN `npm run verify-migrations --workspace @ghl-theme-builder/server` BEFORE EVERY
  DEPLOY.** It recreates a scratch database, applies all migrations from zero exactly as
  Render will, and asserts the outcome (`searchVector` GENERATED + its GIN index).
  It refuses to run against a Neon/Render URL, because it drops and recreates a database.
  - The failure it exists to catch is **invisible in development**: migrations are applied
    one at a time in the order you happen to write them, so a migration referencing a
    LATER one's table works on your machine forever and only breaks on a fresh database —
    i.e. on the deploy. `add_desk_tickets_and_canned_replies` did exactly that (it altered
    `Conversation` while sorting *before* the migration that creates it) and would have
    failed the deploy. Fixed by renaming the folder `20260812174730` → `20260812190000`;
    safe because it had never reached production. **If a bad migration ever does reach
    production, the failed `_prisma_migrations` row blocks every later deploy** until it
    is resolved by hand.
  - `prisma migrate diff` reports permanent "drift" here (GIN index, the generated
    `searchVector` expression, array defaults). That is Prisma's datamodel being unable to
    express raw SQL, **not** a defect — never "fix" it by regenerating the migration.
- **Migrations run in the build command**, not `preDeployCommand` — the latter is
  paid-only, and omitting it on free fails the deploy with Prisma P2021.
- **The database is NOT in the Blueprint.** It lives on Neon, deliberately: the free
  Render Postgres expired 2026-08-08 and was suspended, which took production down.
  Use Neon's **direct/unpooled** URL — the pooler is PgBouncer in transaction mode and
  breaks `prisma migrate deploy`, and `schema.prisma` has no `directUrl` fallback.
- **`TOKEN_ENCRYPTION_KEY` must never be regenerated** against an existing database.
  `tokenCrypto.ts` is scrypt → AES-256-GCM; the auth tag means a wrong key *throws*,
  so every agency silently has to re-authorise. It is `sync: false` in the Blueprint
  for exactly this reason — never `generateValue`.
  - **The refresh loop now says which of three things went wrong** (`tokenFailure.ts`):
    `decrypt` (the key does not match — nothing the agency can do), `revoked` (they must
    re-authorise — retrying can never fix it), or `transient` (retry, which is right).
    They are indistinguishable in a log, and treating them alike is how one identical
    line per broken agency was emitted every 30 minutes forever. Permanent failures are
    reported **once per process** with the remedy; transient ones keep logging. When
    *every* agency fails to decrypt, that is said separately and explicitly — it is the
    key, not the agencies, and one line per agency buries the only fact that matters.
    Classified from the raw error but still logged through `describeError`, because an
    Axios failure here carries `client_secret` and `refresh_token` in `config.data`.
  - Blast radius is narrower than it looks: theming and support read our own database, so
    they keep working. What breaks is anything calling GHL — `sync-locations`, menu-link
    registration, location sync.
  - `tokenFailure.ts` has **no imports** on purpose. `tokenRefresh.ts` pulls in
    `ghlClient.ts`, which throws on missing env at import time, so anything downstream of
    it cannot be loaded by a unit test at all.
- **Free web services sleep after ~15min** and take ~50s to wake. Theming is delivered
  by a render-blocking `@import`, so a cold start stalls the agency's whole GHL UI, not
  just the branding. Keep it warm or go paid.

Host migration (Render→Render, any→Neon): see `docs/render-migration.md`. Row copy is
`npm run migrate-db --workspace @ghl-theme-builder/server` (Prisma-to-Prisma, so it
needs no `pg_dump`).

### Closing the theme editor asked for confirmation on one path and not the other
The overlay was deliberately non-dismissable, with the reason written down: *"this is a
big form and a stray misclick would discard all unsaved edits."* Six lines later, Escape
called `onCancel()` directly — instantly and silently throwing away exactly that. Escape is
a reflex, especially inside an iframe where people press it to dismiss whatever is on top,
and the work at risk is an agency's careful branding of one of their clients. The reasoning
was right; one path bypassed it. (X and Cancel did too.)

- **"Dirty" is fingerprinted from the SAVE PAYLOAD, not a hand-kept flag.** A `dirty`
  boolean is one more thing every future field must remember to set, and silent when
  forgotten — the same class of bug as the two paths this guard reconciles. Fingerprinting
  what Save would send means a new field is covered the moment it joins the payload, and a
  field NOT in the payload correctly raises no warning, because saving wouldn't persist it
  either.
- **A standing "Unsaved changes" marker in the header**, so the discard prompt is never the
  first time somebody learns their edits weren't saved.
- `window.confirm` is unusable here — the dashboard runs in GHL's cross-origin iframe where
  browsers silently return `false` — hence the in-app `ConfirmDialog`, as everywhere else.
- No `beforeunload` guard: a cross-origin iframe cannot raise one, so the tab-close case is
  genuinely out of reach rather than overlooked.
- **The support settings modal had the same hole and a wider one** (fixed 2026-08-15):
  Escape *and* a backdrop click both closed it, discarding the whole policy silently. What
  is lost reads small and isn't — a blocked-terms list is up to 25 chips typed one at a
  time, and `boundaryNotes` is free text describing what Mosaic may say on the agency's
  behalf. Same guard, and simpler here: the config object **is** the save payload, so
  fingerprinting `JSON.stringify(config)` against what was loaded covers a field added
  later without anyone remembering to. The discard prompt is matched in the live check on
  its **own** wording, because "Discard your changes?" now ships from two components and
  the shared string would pass whether this half exists or not.
- **And the guard had to be told about the tab it cannot see.** The "Your content" tab holds
  the longest free text on that screen — an article the agency was told to *"write as you'd
  explain it to a client"* — and the modal's fingerprint is taken from the CONFIG, so it
  could not see a draft at all. Left there, the guard would have protected a one-word tone
  field while Escape still closed the modal over a 200-word SOP: **worse than no guard,
  because it reads as one.** `SupportKnowledge` now reports its draft up via
  `onDirtyChange`, and all three exits are covered — Cancel in the editor, Escape/backdrop
  on the modal, and **switching tabs**, which is the least obvious of them because only the
  open tab is mounted, so leaving to check a setting takes the draft with it. The prompt
  names whichever thing is actually unsaved; a warning that describes the wrong thing is one
  people learn to click through.

### Logo uploads are WebP, and the stylesheet size is the reason
`ThemeEditor.tsx` encodes an uploaded logo as **both** WebP (q85) and PNG and keeps
whichever is smaller, downscaled to 512px on the longest side.

Size matters far more here than for a normal image: logos are base64-inlined into the
theme stylesheet, ONE PER SUB-ACCOUNT, and that stylesheet is render-blocking. Measured
against this repo's own `logo/` files at 512px, a single PNG logo is 29–152KB, which
base64 inflates by a further 33% — so at 41 sub-accounts a careless logo choice is
1.6–8.4MB of render-blocking CSS on every page load.

Two things the encoder must not assume:
- **That WebP is supported.** `toDataURL` with an unrecognised type does not throw, it
  silently returns PNG — so check the mime of what came BACK, don't trust the request.
- **That WebP always wins.** For small flat-colour art PNG sometimes does. Encoding both
  and comparing costs microseconds, and means this can never make a logo bigger.

The editor now reports the chosen format and resulting KB after upload, so the cost is
visible at the moment the decision is made.

### Bulk brand-from-websites (`BulkBrand.tsx` + `bulkBrandLogic.ts`)
"🎨 Brand from websites" in the toolbar: paste `sub-account, website` rows → scan →
review → apply. Onboarding an agency is where Mosaic saves a day or costs one (41
sub-accounts, each needing its client's own logo and colours), and this needed **no new
server code** — it reuses `/brand-scan` and the same client-side `paletteFromImage` the
editor already uses. Four decisions carry the weight; the pure helpers are extracted so
they can be checked directly (21 checks):

- **Never guess which sub-account a row means.** Exact location id, or exact
  case-insensitive name. **GHL sub-account names are NOT unique**, so a duplicated name
  is *refused* with "use its location id instead" rather than matched. Branding the wrong
  client is invisible to the agency and obvious to the client.
- **Send the WHOLE theme, not just the colours.** `createThemeVersion` carries forward
  logo / hiddenFeatures / renames / menuOrder when a key is absent — but `visualFields`
  unconditionally resets the rest, so a partial payload would silently clear the font,
  corner radius, top-bar colour and alert banner on **every sub-account it touched**.
  That is what `mergedTheme()` exists for.
- **Downscale the scraped logo before it can reach the stylesheet.** The single-location
  scan only ever applied *colours*; bulk introduced logo-setting, and a scan returns
  whatever the client's site happens to serve — the first one measured was a **77KB PNG**.
  Unprocessed, 41 of those are megabytes of render-blocking CSS. `downscaleDataUrl()` in
  `colorUtils.ts` runs the same WebP-vs-PNG-smallest pipeline as uploads (same two traps:
  `toDataURL` silently returns PNG for an unsupported type, and WebP isn't always
  smaller), and each row shows the resulting KB.
- **Scan, show, then apply.** Nothing is written until the agency has seen each colour
  pair beside the client it belongs to; a scan is a guess about someone's brand. Each
  apply is a new version, so it's reversible per sub-account from the History tab.
- Scans run **sequentially** — 41 simultaneous fetches at other people's websites is how
  an IP gets blocked.

### Bulk enable/disable, and the blast radius nobody could see (2026-08-17)
The toolbar's "Enable/Disable selected" is the widest-reaching control in the product, and
three things about it were wrong in the same direction — all of them with the correct
pattern already present in the same file.

- **`Promise.all` left the table disagreeing with the database.** The first rejection
  skipped the local state update entirely while every other request carried on committing:
  the UI showed nothing changed, the database had changed most of them, and nothing
  refetched. `handleBulkApply` — twenty lines below — already refetched for exactly this
  reason. Now `allSettled` + an unconditional refetch, so the table is the server's answer
  whatever happened, and the message states the SUCCESSES ("38 of 41") because "3 failed"
  leaves the reader wondering about the other 38.
- **"Select all" spans every filtered PAGE, not the 25 on screen.** On a 41-sub-account
  agency you can be looking at 25 rows with 41 selected. `Apply to N` disclosed the number;
  `Disable selected` did not, and had no confirmation — so the widest-blast-radius action
  was the one with the least information. Both buttons now carry the count, and turning
  branding OFF asks first, naming how many are **on another page**, which is the number
  nobody can check by looking. Enabling is not guarded: it is not the destructive direction.
- **Deleting a preset had no prompt at all** — a bare click on a small `×`, and presets are
  the one thing on that screen with **no history to restore from**, while a single
  sub-account's theme (which *has* a History tab) has always confirmed.
- **`summariseBulk` is extracted** (`bulkEnableLogic.ts`), same reasoning as
  `bulkBrandLogic.ts`: it is arithmetic that produces a sentence somebody acts on, and
  inline in a component it can only be checked by clicking. It passes a session expiry
  through **verbatim**, because `App.tsx` branches on that exact string to choose the amber
  instruction banner over the red error one — wrapping it in a count would turn the one
  failure with a remedy into one without.
- **`SESSION_EXPIRED_MESSAGE` moved to its own module.** It lived in `api.ts`, which reads
  `import.meta.env` at module load, so importing the constant dragged in Vite's build-time
  environment and any logic depending on it could not be exercised outside a browser.
  `api.ts` re-exports it, so every existing import is unchanged.
- Verified: 13 checks (`scratchpad/verify-bulk-enable.ts`). One check was **deleted rather
  than kept**: grepping the bundle for `allSettled` passes whatever the code does, because
  the initial four-resource page load has used it since long before this change.

#### The SSRF guard was defeated by SPELLING
`brandScan.ts` fetches a URL the agency pastes, server-side — textbook SSRF, and the thing
on the other side of it is `169.254.169.254`, which hands out instance credentials to
anything that asks. The defences were otherwise thorough (scheme and port allowlist,
per-redirect re-validation, size and time caps, and a connect-time `lookup` that closes DNS
rebinding). The address check underneath them all was the weak part, because it matched the
address as a **string**.

It recognised a v4-mapped IPv6 address only in its dotted form. The identical 128 bits
written in hex — which every network stack connects to the same place — read as public:

```
::ffff:a9fe:a9fe           -> 169.254.169.254   ALLOWED
::ffff:7f00:1              -> 127.0.0.1         ALLOWED
0:0:0:0:0:ffff:a9fe:a9fe   -> the same, expanded ALLOWED
::a9fe:a9fe  2002:a9fe:a9fe::  64:ff9b::a9fe:a9fe  ALLOWED
```
Seven forms in total, measured against the old predicate. `http://[::ffff:a9fe:a9fe]/`
pasted into "Brand from websites" was the whole exploit — no DNS control needed, and the
connect-time guard cannot help because a literal IP never triggers a lookup.

- **Now checked through Node's own `net.BlockList`.** `check(addr, "ipv6")` resolves a
  v4-mapped address against the IPv4 rules itself, in every spelling, because Node parses
  the address to bytes instead of reading it. **An IP is a number; any check that treats it
  as text is one alternative encoding away from being wrong** — which is the part worth
  remembering, not the specific ranges.
- The v4-EMBEDDING prefixes (6to4 `2002::/16`, NAT64 `64:ff9b::/96`, the deprecated
  v4-compatible `::/96`) are blocked wholesale rather than decoded: the embedded address is
  chosen by whoever publishes the DNS record, so there is nothing to enumerate. No brand
  website publishes an AAAA record in either.
- `fe80::/10`, not "starts with fe80" — link-local runs to `febf`. Added the reserved v4
  blocks the old list missed (`192.0.0.0/24`, `198.18.0.0/15`, TEST-NET-2/3, 6to4 relay).
- **Unparseable input is refused, not waved through.** The old predicate fell through to
  "public" for a string it could not read.
- Verified: 7 unit tests (`brandScan.test.ts`) covering every bypass form, plus the live
  route refusing all six payloads with a 400 — **and still scanning a real public site**
  (site name + a 77KB brand image, both fetch hops through the guard). A guard that blocks
  the feature is not a fix.

##### …and then the NEXT feature to fetch a pasted URL got none of it
Found 2026-08-15. The guard above was thorough, tested against every bypass form, and
documented at length — **in one file**. Feeds shipped afterwards with a second box for the
agency to paste a URL into ("Your content → Add feed"), and `feedPoll.ts` fetched it with a
bare `fetch(url, { redirect: "follow" })`. The route in front of it validated the **scheme
and nothing else**: no address check, no port check, no per-hop revalidation on a redirect
chain handed wholesale to undici, and an unbounded `res.text()`.

It is the worse of the two paths. A brand scan turns the response into a colour and an
image; a feed response is parsed and **ingested as knowledge-base articles**, which
retrieval can then surface into a client's chat window. `http://169.254.169.254/latest/
meta-data/iam/security-credentials/` pasted into Add feed was the whole exploit — and
because it is a literal IP it needs no DNS control, so the connect-time rebinding guard
would not have helped even if this path had had one.

- **The guard now lives in `services/safeFetch.ts` and every caller uses it.** That move IS
  the fix; fixing `feedPoll.ts` alone would leave the next one to repeat this. Anything
  that fetches a URL somebody else chose goes through `safeFetch`.
- **There was a THIRD caller, found by checking that sentence rather than asserting it.**
  Grepping every outbound `fetch(` in `apps/server` turned up `kbIngest.fetchText` — the
  crawler — with the same bare `redirect: "follow"` and no cap. Materially lower risk: it
  is reachable only from the `crawl-kb` CLI, so no route lets a stranger pick the origin.
  Not zero, though, and both holes were in URLs the crawler did **not** get from the
  operator: a page at the operator's own origin (which `parsed.origin !== opts.origin` does
  check) could **302 anywhere**, and that response is what gets ingested; and nested
  sitemaps are fetched from whatever `<loc>` the remote sitemap lists, before the origin
  filter applies — a blind request, which against `169.254.169.254` is the request worth
  making. Routed through `safeFetch` mostly so the invariant above is TRUE, since a
  written-down rule with a path around it is what produced this whole class of bug.
- **Non-2xx is returned, not thrown**, because a conditional GET's **304 is a success** for
  a poller that sent `if-none-match` — deciding that inside the helper would force every
  caller to catch an error to read a normal answer. brandScan keeps its own throwing
  wrapper.
- **The route runs the same check at paste time,** so a blocked address is refused while
  the agency is looking at the box rather than failing on a poll nobody watches — with
  **one identical message** for a bad scheme, a bad port and a blocked host alike, since
  saying which is which enumerates internal hosts.
- **`MAX_FEED_BYTES`**: an unbounded `text()` on a URL somebody else chose is a way to
  exhaust a 512MB free instance from outside.
- Verified live: **26 checks** (`scratchpad/verify-ssrf.js`) across BOTH boxes with the
  same payloads, and confirmed to score **14/26 on the pre-fix code** — every metadata,
  loopback and private address was accepted *and stored as a feed*, while the brand-scan
  half stayed green throughout, which is precisely the shape of the bug. A real public feed
  is still added and still polled over the network, because a guard that blocks the feature
  is not a fix.
  - **One probe passed for the wrong reason and had to be retargeted.** Pointing the
    "poller refuses a planted row" check at `169.254.169.254` looks right and proves
    nothing on a laptop: that address is not routable, so an *unguarded* fetch fails there
    by accident. Aimed at our own `127.0.0.1:3210/health` — which answers 200 with a body —
    anything but a refusal means the request really was made.
  - **`verify-feeds` broke, and it was right to.** It serves its fixture feed from an
    ephemeral `127.0.0.1` server so it exercises the genuine conditional-GET path instead
    of a stub, and the new guard blocks exactly that. Hence
    `SAFE_FETCH_ALLOW_LOOPBACK=1` — an escape hatch inside a security control, which is
    the category of setting that ends up on in production, so: it is **loopback only**
    (never link-local, so the metadata endpoint stays blocked even in dev), the **port
    allowance moves with it** rather than being a second switch, and it **refuses itself**
    whenever `APP_PUBLIC_URL` is a real https host — the same `isProductionUrl()` test that
    stops the dev cookie being marked `Secure`. Five unit tests (`safeFetch.test.ts`) pin
    all of that, including that loopback spelled `::ffff:7f00:1` is exempted consistently,
    since an exemption that depended on spelling would be the original bug in reverse.
    The harness sets both variables itself rather than relying on the caller's shell.

### The uninstall webhook was handled under a name GHL never sends
`routes/webhooks.ts` switched on `UninstallCompany` / `UninstallLocation` — strings that
appear nowhere in this repo except that file. GHL's actual app lifecycle event is the
bare `UNINSTALL`, which is what the vendor's own SDK switches on
(`@gohighlevel/api-client` → `webhook-manager.js`). So **every real uninstall fell through
to `default:` and did nothing**, while the audit row was written `processed` and the
response said `success: true`. Silent from every angle you could look at it from.

What made it survive is that it half-worked by accident. The SDK middleware's `UNINSTALL`
case calls `sessionStorage.deleteSession`, and our `PrismaSessionStorage` happens to flip
the agency to `uninstalled` there — so the status change, the one thing anybody would
check, happened as a **side effect of the vendor's code**. Everything only this route does
did not:
- the **Custom Menu Link was never deleted**, so it stayed in the agency's GHL nav
  pointing at us forever. `deleteMenuLinkForAgency` was written specifically to survive
  the SDK having already withheld the token — and was then never reached by any event.
- sub-accounts were never soft-removed.

And the accident only holds on the signature-VERIFIED path: with no public key the SDK
returns `next()` before its own switch runs, so **nothing happened at all**. Measured on
the pre-fix code: agency stayed `active`, menu link survived, and `/theme-css` kept
serving the full stylesheet to an agency that had removed the app.

Now dispatched on `/^uninstall/i` with `locationId` outranking `companyId` — matching the
SDK's own precedence, so our idea of *what was removed* can't drift from the SDK's. An
agency-level uninstall carries no `locationId`; a sub-account one may carry both, and
reading that as an agency uninstall would un-brand every other client of that agency. The
granular names are kept as aliases: one regex, and a GHL that does emit them still works.

- **The route must not depend on the SDK's side effect,** which is the general lesson
  here. Behaviour that only happens because a dependency also touches your database looks
  identical to behaviour you implemented, right up until the branch it lives on isn't taken.
- **`lastKnownGood` is now evicted on uninstall**, not merely left to go stale. The
  degraded path serves that map as a real 200, so the entry outlived the uninstall: the
  next database blip would open the agency's breaker and re-brand, from cache, an org that
  had removed us.
- Verified live: **34 checks** (`scratchpad/verify-webhooks.js`) across install, sub-account
  delete, both uninstall shapes, redelivery idempotency, retention and unknown event types — and
  confirmed to FAIL on the pre-fix code, which is the only thing that makes the suite worth
  having. Plus **17 checks** (`scratchpad/verify-webhook-signature.js`) that boot a server
  with a generated Ed25519 keypair to exercise the production-only signature path: unsigned,
  wrong-key, tampered-after-signing and wrong-`appId` deliveries are all 401 **and write no
  audit row**, because rejection precedes the first database write.
- The dev fail-open branch is not a hole: `env.ts` refuses to boot without
  `WEBHOOK_SIGNATURE_PUBLIC_KEY` once `APP_PUBLIC_URL` is https, so production is
  fail-closed and only a localhost origin can process an unsigned event.
- **The event match is ANCHORED at both ends** (`/^uninstall(company|location)?$/i`), not a
  bare prefix. `/^uninstall/i` would also swallow a hypothetical `UninstallReminder` or
  `UninstallScheduled`, and reading a *warning* as the event would delete a live agency's
  menu link and stop their branding while they are still a paying customer — off a webhook
  whose meaning we invented. An unrecognised event costs nothing; it is audited and ignored.

#### …and then REINSTALLING gave the agency back zero sub-accounts
Found 2026-08-15, downstream of fixing the uninstall — and the more likely path of the two,
because *"remove it and add it again"* is the first thing any support person says.

1. Uninstall soft-removes every sub-account. Correct: that is how serving stops.
2. Reinstall flips the AGENCY back to `active` (`setSession`), and both entry points — the
   OAuth handler and the INSTALL webhook — call `syncLocationsForAgency`.
3. That function **refuses to resurrect a `removed` location**, deliberately and with the
   reason written down: a sub-account deleted in GHL must not come back merely because a
   sibling event triggered a re-sync.

So the agency reinstalled and got **zero working sub-accounts, permanently**. The install
reported success, onboarding rendered, the dashboard opened on an empty table, `/theme-css`
served nothing, and **there was no recovery** — `npm run sync-locations` calls the same
function and refuses again, so it needed hand-written SQL.

The rule in step 3 is right for what it was written for. It simply could not tell a
sub-account DELETED in GHL from one soft-removed as a cascade of the agency's own
uninstall — which GHL still lists, and which the agency plainly expects back.

- **`LocationInstall.removedReason` records WHY,** because `status` conflates two facts with
  opposite consequences: `agency-uninstall` (cascade — comes back on reinstall) versus
  `location-delete` / `absent-from-ghl` (the sub-account itself is gone — never resurrected).
  Nullable with **no backfill**: a row removed before the column existed reads as "we don't
  know", and unknown is never resurrected, which is the conservative direction.
- **The cascade skips rows already `removed`,** so a sub-account deleted before the uninstall
  keeps its own reason. Without that, one uninstall would relabel a genuine deletion as a
  cascade and the reinstall would bring back a client who no longer exists.
- **The cascade no longer clears `enabled`.** That is the agency's own per-sub-account switch
  in the dashboard, and overwriting a user setting as a side effect of an uninstall destroys
  a choice that cannot then be restored — an agency who had three of forty-one switched off
  would find them switched back on. Safe to drop because **every serving path gates on
  `status`** (`themeCssBundle`, `themeBundle`, the admin listing, `isSupportEnabled`), so
  nothing is emitted for a `removed` row regardless. Checked route by route before changing it.
- **Readiness already covered the symptom** — a reinstalled agency with no active sub-accounts
  trips the `no-locations` blocker. That is the per-agency `groupBy` earning its keep.
- Verified live: **13 checks** (`scratchpad/verify-reinstall.js`), scoring **8/13** on the
  pre-fix code with the headline failure being "the sub-account GHL still lists is serving
  again". `searchLocations` is stubbed so the whole of `syncLocationsForAgency` runs against a
  known list; the UNINSTALL webhook, the rows and the reinstall path are all real.
  `verify-webhooks` grew to **37** and now asserts the two removals are stamped differently.

#### The audit row is an idempotency key AND a record, and those have different lifetimes
`WebhookEvent` was the in-repo example of unbounded growth, and the disk was the cheap
half of the problem.

- **Only events we ACT ON keep their body** (`auditPayload`). The endpoint is ONE URL and
  GHL decides what to send it, so `payload: body` meant subscribing the app to, say,
  contact events would quietly accumulate the **agency's own clients'** names, emails and
  phone numbers in our database, forever, in service of a handler that discards them. That
  is a marketplace data-protection problem, not a storage one. Unhandled events keep only
  the **shape** — the top-level key names, no values — which is what you actually want when
  deciding whether to support a new event type, and which keeps "GHL is sending us
  something we ignore" visible instead of erasing it.
- **`classifyWebhookEvent` is the single definition of what this app acts on,** read by the
  dispatcher and the retention policy both. Two lists would look right in review and
  diverge the first time somebody added a type to one; the direction that hurts is silent,
  because the policy would then discard the payload of an event that *can* fail — on
  precisely the delivery you needed it for.
- **Failed events are kept 180 days against 30 for processed.** One window would delete the
  most useful row in the table: a handler that has been failing for a fortnight is the only
  thing in there worth finding. Both windows are far longer than GHL's retry window, so a
  prune can never remove a row still doing its idempotency job and let a redelivery re-run.
  `processing` is pruned with the processed set — a row stuck in it for a month is not in
  flight, it is a crash from before the last deploy, and it is the one status nothing else
  would ever clean up.
- **Pruning rides the existing 30-minute token-refresh timer.** It is an idempotent DELETE,
  so two instances racing it is harmless — unlike feed polling, where a second instance
  re-fetches every feed and races the same upserts. It is deliberately NOT on the webhook
  path: GHL retries on a timeout, so a slow prune there would manufacture the duplicate
  deliveries it exists to tidy up after.
- New env, both optional: `WEBHOOK_RETENTION_DAYS` (30), `WEBHOOK_FAILED_RETENTION_DAYS` (180).

### Readiness (`services/readiness.ts` + `npm run readiness`) — the deploy went green and the product is dead
`validateEnv` covers configuration thoroughly and refuses to boot on the fatal gaps. What
it structurally *cannot* see is the other half, and the other half is where this product
has actually been hurt: **the failures that matter most are DATABASE facts.** An unseeded
knowledge base, a desk with no accounts, a tier nobody holds, an agency whose sub-accounts
never synced. Every one boots clean, logs nothing, serves 200s and answers nobody — the
exact state shipped twice already (support absent from the Blueprint; the desk write-only).

- **Severity is computed from env AND data together,** which is the point. The same
  missing value means different things: `OPENAI_API_KEY` unset is a footnote on an install
  that has never switched support on, and the single most important line in the log on one
  that has. A pure env check can't make that distinction and so has to shout either way.
- **Every finding names the SYMPTOM, not just the cause.** None of these throw, so the
  reader is someone staring at a widget that works and deflects nothing. "OPENAI_API_KEY is
  unset" is useless to them; *"the bot replies 'let me get someone from the team' to every
  question, logs no error, and deflects nothing"* is what they are actually looking at. A
  `fix` field is required for the same reason — a finding with no remedy is a line people
  learn to skim.
- **Logged at boot, and deliberately NOT an HTTP endpoint.** A public URL enumerating which
  of our safeguards are unconfigured is a gift to anyone probing, and the moment this is
  worth reading is the moment somebody is already looking at the deploy log. The script
  exists for the other moment — after seeding, after creating the first desk account — and
  exits non-zero on a blocker so it can gate a release rather than merely inform one.
- Never awaited and never throws: a readiness check that can delay or fail the boot it
  reports on is worse than the misconfiguration it found.
- **The per-agency/global distinction is load-bearing, and I got it wrong twice.**
  `no-support-locations` counted widget-enabled sub-accounts GLOBALLY, so one agency with
  the widget on anywhere made the count non-zero and every *other* agency that switched
  support on and enabled it nowhere read as fine. `no-locations` had the identical bug one
  line up. Both pass on a one-agency dev database and are wrong the moment there are two —
  which is to say they are wrong in production and right in every place you would test
  them. Both are now `groupBy` agency. `kb-empty` and `no-desk-staff` genuinely ARE global:
  the corpus is shared and the desk is Mosaic's own. Found by the live check, not by
  reading it — a per-tenant check written as an aggregate is invisible to review because
  the aggregate is the more natural thing to write.
- Verified live: 18 checks (`scratchpad/verify-readiness.js`) — each finding driven by real
  database state and asserted to appear **and** disappear, because a readiness check that is
  itself wrong reports green over precisely the failures it was written for.

### Smoke-testing a DEPLOY from outside (`npm run smoke`)
```
npm run smoke --workspace @ghl-theme-builder/server -- \
  --base https://server --dashboard https://dashboard --desk https://desk \
  [--agency <agencyInstallId>] [--location <ghlLocationId>]
```
Complementary to `readiness`, not a duplicate. Readiness asks the DATABASE whether this
deployment can do its job; this asks the three services over the network, as a browser
would — which is the only way to see the failures that live *between* them.

- **It reads the API origin back out of the shipped JavaScript.** `VITE_API_BASE_URL` is
  compiled IN, so pointing a static site at a new API needs a **rebuild, not a restart**.
  Get it wrong and the dashboard loads perfectly, renders its whole UI and can reach
  nothing — which reads as "the API is down" while the API is fine. Fetching the bundle and
  grepping it for the server host is the only way to catch that without a browser.
- **It verifies the admin API is actually protected**, unauthenticated, from outside. That
  is the single most expensive setting to get wrong: without `DASHBOARD_AUTH_ENABLED` every
  `/admin/api/:agencyInstallId/*` route is reachable with only the agency id, which is not
  secret — it is in the public `@import` line.
- **One POST, and a correct production refuses it before writing anything.** There is no GET
  that can tell you whether `WEBHOOK_SIGNATURE_PUBLIC_KEY` is set, so the probe sends a
  deliberately bad signature: 401 means fail-closed, 200 means forged lifecycle events are
  accepted. The event type is one the dispatcher ignores, so even the bad outcome does
  nothing beyond a shape-only audit row that prunes itself.
- **Raw `http.request`, never `fetch`** — undici silently attaches `cache-control: no-cache`
  to any conditional request, so the ETag check would come back 200 every time and read
  exactly like a server ignoring ETags.
- It also flags a cold start (>20s) explicitly, because that number IS the stall a free
  instance imposes on an agency's whole GHL UI, not a slow test.
- Pointed at localhost it fails exactly twice — unauthenticated admin API, unsigned
  webhooks accepted. Those are the two settings `env.ts` makes fatal in production and
  optional in dev, so that is the check demonstrating it discriminates, not a defect.

##### Desk suites share a 10/min login budget — space them out
`/desk/api/login` is limited to 10 requests per minute per IP, deliberately: it is the one
credential-guessing target in the product. Every desk suite signs in several times, so
running them back to back starves whichever comes second and it dies mid-run with **no
summary line at all** — which looks like a crash, not a 429. Seen immediately after adding
`verify-desk-session` (5 logins): `verify-desk`, `verify-routing` and `verify-delivery` all
printed nothing, then passed 36/47/23 when run a minute apart. Space them, and read a
missing summary as "rate-limited" before anything else.

**There is a SECOND shared bucket, and it bites differently** (2026-08-15).
`/admin-embed` is 30/min per IP and shares one limiter instance with `/portal` — that
sharing is the fix, and `verify-embed-auth` **deliberately exhausts it** to prove the two
routes cannot each get their own budget. Run `verify-session` in the same minute and it
does not go quiet; it reports **19 passed, 5 failed** with `1 parts`, `NaN` and "a live
token is accepted", which reads like a broken session implementation and is a 429 body.

Reproduced deterministically — burn the bucket with 34 requests, run the suite, get the
identical five failures — rather than concluding it from an isolated re-run passing, which
this file already warns is the worst possible evidence. `verify-session` now **throws with
the real reason** on a 429 instead of asserting against the error body, the same principle
as the plan-failures log: when the failure mode is known, make the occurrence
self-documenting rather than leaving the next person to rediscover it.

##### Don't edit source while a live suite is running
`npm run dev:server` is `tsx watch`, so every save restarts the server — mid-request, for
whatever suite is in flight. Editing `readiness.ts` during a sweep produced `verify-e2e`
19/3 and `verify-plan` 11/1 with two suites printing no summary at all, which reads exactly
like the brand-map cache flake and was nothing of the sort. Re-running untouched: 22, 12,
25, 30, all green. Before diagnosing a sweep failure, check whether a file was saved while
it ran.

### `GET /health` does a real `SELECT 1`
`render.yaml` points `healthCheckPath` here, NOT at `/`. During the August 2026 outage
Postgres was suspended, every query hung, and the health check — aimed at `/`, which
returns a static string — reported the service perfectly healthy throughout. The 2s
wall clock is the load-bearing part: an unreachable database *hangs* rather than
erroring, so without it this endpoint would hang too and read as unhealthy only by
accident, with no diagnosis. Returns 503 + a reason instead.

### The stylesheet is `no-cache`, NOT `no-store` — measured, 1MB+ per page load
Measured on a realistic agency (41 sub-accounts, 40KB logos base64-inlined):
**2.38MB raw / 1.69MB gzipped**, and generation is 22ms — 1% of the 2.5s timeout. So
size is the problem here and build time is not.

It was served `no-store`, which forbids the browser from keeping a copy at all, so that
whole body shipped **render-blocking on every page load of every sub-account**. The
reasoning was sound as far as it went: theme edits must apply live, and the pasted
`@import` carries a `?v=` fixed at paste time that can never bust a cache, because an
agency edits their theme and never re-pastes. That rules out `max-age`. It does not rule
out **revalidation**. `no-cache` + Express's ETag means an unchanged theme answers 304
with no body, and an edit still lands on the very next page load.

- **The degraded body carries no timestamp.** It used to interpolate the cache age in
  seconds, so the bytes changed every second, so the ETag changed every second, so no
  browser could ever revalidate — the full stylesheet would ship on every page load for
  the entire outage, which is exactly when the database can least help. Age and reason
  moved to `X-Mosaic-Stale-Age` / `X-Mosaic-Degraded`.
- Verified: 13 checks (`scratchpad/verify-themecss-cache.js`) — 1,092KB on first load,
  **0 bytes** on the repeat, and a colour edit through the admin API turning the same
  conditional request back into a 200 with the new value.
- **Node's `fetch` cannot test this.** Undici silently attaches `cache-control: no-cache`
  to any request carrying a conditional header, and Express's `fresh` then correctly
  refuses the 304 — so every check came back 200 with a full body and read exactly like
  a server ignoring ETags. curl 304'd the whole time. Use raw `http.request` when the
  headers are the thing under test.

### A dead datastore must never hang `/theme-css`
That URL is fetched by `@import` from GHL's Custom CSS field, and browsers treat a
pending stylesheet as render-blocking — so when the DB died, the outage degraded page
loads instead of merely dropping the theming. The route is now defended three ways:
a **2.5s** wall-clock timeout (not 8s — this is render-blocking, so the timeout is the
worst-case stall imposed on every page load), a per-agency last-known-good cache (served
as a real 200 so the browser still applies it), and a **per-agency** circuit breaker
(`services/circuitBreaker.ts`) so requests during an outage don't each pay the connect
timeout.

The breaker is keyed, not global. As a module-level `let dbDownUntil = 0`, ANY failure —
including one agency's malformed theme data throwing inside the CSS builder — stopped
every other agency's stylesheet from rebuilding. One tenant's bug degraded all of them.
The trade-off is explicit: with the DB truly down each agency now pays one timeout before
its own breaker opens, which at 2.5s beats cross-tenant coupling. Extracted from the route
so the isolation and the recovery probe are unit-tested against a fake clock.

Verified by stopping the local Postgres container: `/health` → 503 with a diagnosis in
46ms; `/theme-css` → **200 with the real 3.9KB stylesheet** from cache, dropping to <1ms
once the breaker opened; then restarting Postgres and confirming the theme went live again
after one cooldown with no restart. (That reproduces the connection-REFUSED flavour; the
timeout covers the connection-HANGS flavour, which is what the August outage actually was.) `prisma.ts` also pins `connect_timeout`/
`pool_timeout`, which bounds every other route. Any new DB-backed route reached from
GHL page chrome needs the same treatment.

---

# Active roadmap — 5 features (in build order)

Status: [ ] todo · [~] in progress · [x] done

## 1. [x] Live preview  — DONE (MosaicPreview.tsx, sticky panel in the editor)
A mock GHL sidebar rendered inside the editor that updates live as the agency edits.
- **Scope:** dashboard only. No schema/server changes.
- **Build:** new `MosaicPreview.tsx` that renders a fake sidebar and reflects the
  current `look` (sidebar bg / gradient, accent active item + icons, `sidebarTextColor`
  labels, `fontFamily`, `cornerRadius`), the logo, hidden features (struck/omitted),
  renamed labels, and (after #2) the menu order.
- **Integrate:** side panel in the editor (branding tab), driven by the same `look` +
  `hidden` + `labels` + `order` state.

## 2. [x] Sidebar reordering  — DONE (drag rows; `menuOrder` Json; CSS `order`)
NOTE: relies on the GHL sidebar nav being a flex container — CONFIRM live; no-op if not.
Drag to reorder sidebar menu items; delivered via CSS `order`.
- **Data:** add `menuOrder Json?` (array of feature keys) to ThemeConfig +
  AgencyDefaultTheme + ThemePreset. Migration.
- **Server:** in `themeCssBundle.ts`, for each key in `menuOrder` emit
  `<scoped selector> { order: <n> !important; }`. Requires the sidebar nav to be a
  **flex/grid container** (CSS `order` only affects flex/grid children) — CONFIRM
  against live DOM whether to target the `<a id=sb_…>` or its wrapper.
- **Dashboard:** drag-to-reorder list (features tab and/or the live preview). Thread
  `menuOrder` through the same layers as other fields. Whitelist keys with
  `isKnownFeatureKey`.
- **Risk:** if items aren't flex children, `order` won't apply — fall back to targeting
  the flex parent. Ship behind a live-DOM check.
- **STILL UNCONFIRMED against live DOM** (2026-08-13). Everything below the flex
  assumption is verified; the assumption itself needs one look at a real GHL sidebar.
- **Fixed 2026-08-13 — unlisted items landed FIRST, not last.** `order` defaults to 0, so
  any nav item missing from the saved list tied with the item at index 0 and jumped to
  the top. The saved list goes stale on its own (GHL adds a nav item; a preset saved
  before we knew about one is applied), and the live preview sorted unlisted items LAST
  (`?? 999`) — so the preview and the real sidebar disagreed precisely when it mattered.
  Now one catch-all `a[meta] { order: 999 }` is emitted FIRST (every nav anchor carries
  `meta`), and the per-key rules override it: `#sb_<key>` outranks it, and
  `a[meta="<key>"]` ties on specificity but wins on source order. Guarded by
  `themeCssBundle.test.ts`; emitted only when a list exists, so nobody pays for it.
- **Cost, measured:** +1.7KB per fully-reordered sub-account (~68KB across 41). Fine
  against logos, but this is the render-blocking path — keep an eye on it.

## 3. [x] Theme history + rollback  — DONE (History tab; GET …/theme/versions; load→save)
Surface the versions already stored per location + one-click restore.
- **Data:** none — `ThemeConfig` is already versioned.
- **Server:** `GET /admin/api/:agency/locations/:loc/theme/versions` → list
  (id, version, createdAt). Restore = `POST …/theme/versions/:version/restore` that
  creates a NEW version copying the old row's fields (becomes latest). Reuse `visualFields`.
- **Dashboard:** a "History" section in the editor: list versions with timestamps + a
  "Restore" button. Per-location only (AgencyDefaultTheme isn't versioned).

## 4. [x] Brand-from-logo (palette extraction)  — DONE (paletteFromImage + "Use colors from logo")
On logo upload, extract dominant colors and offer to prefill primary/accent.
- **Scope:** client-side only (Canvas), no deps, no server. Website-URL scraping is a
  later, heavier follow-up.
- **Build:** extend `colorUtils.ts` with a `paletteFromImage(dataUrl)` (downscale to a
  canvas, quantize pixels, pick dominant + accent). Add a "Use logo colors" button in the
  branding tab that sets `primaryColor` / `accentColor`.

## 5. [x] Favicon (per sub-account)  — DONE (editor field + JS-bundle applies <link rel=icon>)
- **Data:** `faviconUrl` already on ThemeConfig / AgencyDefaultTheme. Add to
  `visualFields` / types / editor (URL input + upload, like the logo).
- **Delivery:** CSS CANNOT set a favicon. Deliver via the JS bundle
  (`themeBundleScript.ts`): swap/create `<link rel="icon">` from `theme.faviconUrl`
  (config endpoint already returns it). Document the optional Custom-JavaScript paste in
  onboarding for agencies who want it. Core CSS flow is unchanged.
- **This was marked done with NEITHER half built** (found 2026-08-13). The column and the
  config endpoint existed, which made it look finished from either end, but:
  1. `themeBundleScript.ts` read `theme.brandName` and never `theme.faviconUrl`, so the
     tab kept the vendor's icon beside the agency's own brand name; and
  2. there was no input anywhere in the dashboard — not a field, not even `faviconUrl` on
     the `ThemeInput` type — so nothing could set it in the first place.
  Both fixed; verified end to end (7 checks: editor field → API → config endpoint →
  pasted bundle → every `link[rel*=icon]` rewritten → clearing restores GHL's).
- **How to find the next one of these:** `scratchpad/audit-fields.js` cross-references
  every column on ThemeConfig / AgencyDefaultTheme against the layers below. A column the
  API silently drops is a feature nobody can use, and it reads as done from every angle
  except a live test. That check is what turned up both this and the dead `brandName`.
  Still-dead columns, deliberately: `contentBgColor` / `contentTextColor` (never
  implemented anywhere — they need live-DOM selectors for GHL's content area) and
  `updatedByUserId` (audit metadata, never populated).
  - **A standing false positive destroys the report.** The audit flagged
    `customCssOverride` as unwritable on every run; the route does accept it, under the
    payload key `customCss`. One line that is always wrong teaches the reader to skim
    past the ones that aren't, so the alias is now known to the script.
  - `scratchpad/audit-support-fields.js` is the same idea over SupportConfig /
    Conversation / DeskUser / KbArticle / KbFeed — the larger half of the product, which
    had no equivalent check. Currently clean. It matches ES6 **shorthand** properties too:
    `{ contentHash, status }` has no colon, and missing that reported a column written on
    every single ingest as dead.

#### A NUL byte makes a source file invisible to every code search
`kbIngest.ts` hashed with `` `${a.title}<NUL>${a.body}` `` — a literal NUL byte as a field
separator, which is the *right* technique (it stops `("ab","c")` colliding with
`("a","bc")`) written the wrong way. `file` reports such a source as binary, so **grep,
ripgrep and GitHub code search skip it silently and report no matches**. Searching for
`contentHash` in the module that enforces the knowledge base's brand-safety guarantee
returned nothing at all, which reads as "that code was never written" rather than "your
tool gave up" — and it is the last file in the repo you want to be unsearchable.

Fixed by writing the escape `\0`, which is the identical byte at runtime: proven before
the edit, then confirmed against the database by re-seeding — **253 unchanged**, so every
stored `contentHash` still matched and nothing was re-ingested. `audit-support-fields.js`
now scans all three apps for NUL bytes, because it reads files directly and is therefore
the one tool that *can* see such a file — and so the only place the trap doesn't hide.
