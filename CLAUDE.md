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
- **The reason to paste it was inside the thing nobody opens** (found 2026-08-19, by
  rendering the page). The onboarding fix above is real — `embedSnippet.ts` is the only
  builder, and the wording says to paste *even if support is off today* — but all of it sits
  behind a **collapsed `<details>`**, below a green *"That's it."* The summary read
  *"Recommended: browser-tab title, favicon and client support"*, a feature list, while the
  sentence that actually decides it — *"skipping it now is the one thing that would make you
  come back to this page later"* — was **inside the disclosure it was arguing for**.
  - Same trap as the original, one layer softer: the page declares the job finished at step
    3 and then offers what reads as an optional extra. Nobody returns to a page they have
    already finished, which is the whole reason the widget ships in the paste at all.
  - The **summary** now carries the consequence, in amber — an instruction, not a fault, the
    same distinction the dashboard's session banner makes. It is **not** forced open: the CSS
    line is the genuinely required step and expanding 31KB of code by default would bury it.
    The reason to open it simply has to be readable while it is closed.
  - Pinned by 2 checks in `verify-paste` (**32**), asserting the sentence is in the SUMMARY —
    "it appears somewhere on the page" would have passed the entire time, because it always
    did. Confirmed to fail when the sentence is moved back inside the body.
  - **And the dashboard's half said the opposite.** "Get embed code" hid the same snippet
    behind a link reading *"Show **optional** JavaScript"* — the word that argues against the
    click — with nothing on screen about the cost of skipping it. Expanded, that section was
    already correct and even carried a comment explaining why it says what it says; collapsed,
    which is how everyone meets it, it said "optional" and stopped. This is the screen an
    agency returns to when they *do* come back, so it was the worst place to leave that
    framing. The label now names what the snippet is for, the consequence sits under it in
    amber, and the word "optional" is gone from the modal — it was never quite true anyway:
    optional for THEMING, required for the tab title, the favicon and support.
  - Pinned by 2 more checks (**34**), asserting the consequence renders in the `!showJs`
    branch — "the phrase is in the file" would have passed all along, since the expanded copy
    has always been there. Confirmed to fail when the collapsed paragraph is deleted.
    - The "optional" check had to strip **both** comment forms first: the word survives in the
      prose explaining why it was removed, and a check that reads its own rationale as a
      violation is the CSS-comment trap in another language.
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

##### …and stopping the lie left the failure MUTE on two of the three buttons
Found 2026-08-20, by opening "Get embed code" in a browser — this modal had never been
rendered, on the screen the entire product depends on. The fix above is real: a failed copy
now reports a failure. It reported it in ONE place, a single amber line under the *one-line
embed*, for all **three** copy buttons. Measured at 1440x780 with both disclosures open:

| button fails | where the only report renders | what it says to do |
|---|---|---|
| Copy one-line embed | 26px below it | correct |
| Copy JavaScript | **450px above it** | *"select the line above"* — the `@import`, not the 31KB snippet |
| Copy full CSS | **891px above, scrolled clean out of the modal body** | nothing on screen at all |

- **The label does not change on failure**, so for "Copy full CSS" there was no visible
  effect whatsoever: a dead button. The mirror of the bug this component was already fixed
  for — that one claimed a copy that never happened; this one performs a failure nobody
  sees. Both end with the agency pasting nothing into GHL.
- **This is the documented production path, not an edge of it.** GHL iframes the dashboard
  cross-origin where `navigator.clipboard` is blocked, and on plain http (local dev, ngrok)
  there is no clipboard API at all — which is exactly why the previous fix insisted a
  missing API is a failure rather than a default success.
- Same shape as the login-tab uploads reporting through the branding tab's `logoErr` slot:
  the message was correctly worded and rendered where nobody was looking. **A failure
  message belongs beside the control that failed**, which is the brand-banner rule again.
- **Rendering beside the button is only half of it.** `.modal-body` scrolls, and the message
  appears *below* a button somebody has just scrolled to the bottom edge to reach — so it
  landed a line under the fold. Measured, then fixed by scrolling the message itself into
  view (`block: "nearest"`), which is the minimal move.
- **The manual fallback has to be PERFORMABLE.** *"Select the code above"* is fine for a
  90-byte `@import` line and close to useless for the 31KB JavaScript snippet, which sits in
  a 260px scroll box. A failure now puts the caret round that snippet itself, so the message
  drops to one keystroke — and the suite asserts the browser's **selection really holds that
  text**, because a claim nobody checks is how "Copied!" got here in the first place.
- **Each timer clears only its own message.** A bare `setCopied(null)` lets the first click's
  timeout wipe the second click's answer, so a real failure would vanish two seconds after
  somebody triggered it.
- **A placeholder must not report a state that has already failed.** With the embed fetch
  errored, both disclosures still rendered `<pre>Loading…</pre>` forever, beside a "Try
  again" button that was the actual remedy. They now name the failure and point at it.
- Verified live: **25 checks** (`scratchpad/verify-embed-copy.mjs`), driving a real browser
  and executing the SHIPPED helper against stub clipboards in the order it tries them
  (execCommand first, since that is what works inside the iframe). Each button is asserted
  on three things a mis-placed message cannot satisfy — it is **owned by the button that
  failed** (found by walking backwards to the nearest preceding button, which is the
  property that was wrong), it sits within a line of it, and it is inside the part of the
  body currently on screen. Confirmed to fail **6** under a mutation restoring the shared
  message.
  - One assertion was wrong first and is recorded because the shape recurs: it demanded that
    a success on *any* button clear a standing failure. A failed JavaScript copy is not made
    untrue by the full-CSS button working afterwards. Rewritten to assert the property that
    matters — **retrying the same button** replaces its own message.
##### …and the OTHER screen still failed the same way (found 2026-08-27)
Found by rendering `/onboarding/:agency` and driving both of its copy buttons with every
clipboard route failing — the documented production case, since there is no clipboard API at
all on plain http. This is the page an agency meets FIRST, straight off the OAuth redirect.

```
one-line embed      -> label "Select & copy"   selection length 0   after 2.7s: "Copy"
the 31KB JS snippet -> label "Select & copy"   selection length 0   after 2.7s: "Copy"
```

Both defects had already been found and fixed on the dashboard modal. `embedSnippet.ts`
reconciled WHAT the two screens hand over; what they DO when the copy fails was never
looked at.

- **The instruction was not PERFORMABLE.** "Select & copy" selects nothing. Fine advice for
  a 90-byte `@import` line and close to useless for a 31KB snippet the reader would have to
  drag out of a scroll box — the exact sentence the dashboard fix is written around.
- **And the report of failure TIMED OUT.** 2.5 seconds later the button reads "Copy" again,
  so looking away leaves a normal-looking button over a clipboard that still holds whatever
  it held before. That is the "Copied!" lie in a slower costume, on the one action nothing
  about Mosaic works without. **A success may time out — there is nothing left to do. A
  failure may not.**
- Fixed: a failure now selects the text itself (`Range` over the `<pre>`), says
  *"Selected — press ⌘/Ctrl + C"*, turns amber, and **stays**. Measured after: 90 characters
  selected beginning `@import url(` and **35,277** beginning `(function () {`.
- Verified in a real browser: **13 checks** against the shipped page rather than a reading of
  it, asserting the property the wording cannot supply — that the browser's SELECTION really
  holds the snippet — with the control that a working copy still says Copied! and still times
  out, because a fix that made every button permanently shouty would be its own defect.
  Confirmed to fail **10** under a mutation restoring the old `done()`.
- The same checks are added to `verify-embed-copy` (25 → **36**), which is where they belong:
  one suite for both doors. **That combined run is NOT verified today and this says so rather
  than implying it** — the local Postgres container dropped fifteen times in this session and
  three separate attempts died at the onboarding step. The behaviour above was measured with
  the section run standalone, on one CDP connection, in ten seconds.
  - **Killing a CDP driver leaves the page target's debugger socket CLAIMED**, and the next
    run then hangs at `ws.onopen` with **zero output** — no error, no timeout, an empty log
    file. Diagnosed after stacking four runs against one browser. Restart
    `chrome-headless-shell` rather than re-running, and never start a second driver against a
    live target.

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

##### …and that sentence had never been tested, in the file every client's browser parses
Found 2026-08-24, by asking what covers the claim directly above. `themeCssBundle.test.ts`
held **five** tests, all about menu ordering, and not one of them mentioned `cssColor`,
`cssUrl`, escaping or injection. A security claim written down as settled fact, with no
adversarial coverage, in the one file that ships render-blocking CSS to every sub-account.

**The stylesheet is ONE file for the whole agency**, and that is what turns a malformed
field into somebody else's problem. `generateThemeCssBundle` concatenates the agency default
and every sub-account's block into a single response, so a value the CSS parser chokes on
does not break the sub-account that stored it — it breaks whatever comes **after** it. That
is the cross-tenant coupling `circuitBreaker.ts` was extracted to remove, arriving through
the parser instead of through an exception.

Measured in a real browser, one agency, two sub-accounts, B's block emitted after A's, by
reading the colour B's sidebar is actually **painted**:

| stored on sub-account A | B's sidebar | rules parsed |
|---|---|---|
| a font family with an **apostrophe** (`Ev'il Sans`) | **unpainted** | **0** of 6 |
| a colour holding a comment opener (`red/*`) | unpainted | 1 of 6 |
| an alert message holding a bare **CR** | unpainted | 4 of 6 |
| an alert message holding a **form feed** | unpainted | 4 of 6 |
| a menu label holding a form feed | unpainted | 5 of 6 |
| a sub-account **name** holding `*/` | **repainted red** | 6 of 6 |

None of these requires anybody to be hostile. Every one is a free-text field in the theme
editor, and the inputs are a paste out of a stylesheet, a paste out of a PDF, and an
apostrophe in a font name.

- **Four separate causes, and three of them are the same shape this file keeps recording.**
  - **`fontImports` and `renderRules` had their own idea of what a font family is**, four
    hundred lines apart, and the loose one ran first. `renderRules` reduces it to
    `[a-zA-Z0-9 _-]` with a comment saying why; `fontImports` built its Google Fonts URL
    with `encodeURIComponent`, which does **not** escape `'`, `(` or `)`. So the apostrophe
    closed `url('…')` early — and because `@import` sits at the TOP of the file they all
    share, the parser never recovered its footing and the entire agency lost every rule.
    They also disagreed in the **benign** case: the import asked Google for `Ev'il Sans`
    while the declaration referenced `'Evil Sans'`, so even when nothing broke, the font
    fetched was not the font used. One `safeFontFamily()`, read by both — the `QUEUE_ORDER`
    rule in a fourth place.
  - **The CSS-string escaping was written out twice by hand and the copies had drifted.**
    The renamed menu label folded `[\r\n]+`; the alert banner matched `\s*\n\s*`, which needs
    an actual LF — so a bare CR survived it, and a **form feed** survived both. CSS ends a
    string at LF, CR, CRLF *and* FF. One `cssString()` now, because two copies of "the same"
    escaping is precisely how they end up escaping different sets.
  - **`cssColor` listed the characters that end a declaration and forgot the one that starts
    a COMMENT.** Its own doc comment claimed valid colours never contain the stripped set,
    which was true of `; { } < >` and never considered `/*`. `*` is stripped now and `/` is
    NOT — `rgb(0 0 0 / 50%)` is a real colour, and killing the asterisk closes both
    delimiters on its own.
  - **A sub-account's NAME goes into the stylesheet as a block comment**, and the agency
    types that name into GHL. A `*/` in it closes the comment early and the remainder is
    parsed as CSS, unscoped, in front of every other sub-account's block. Verified by
    painting one client's sidebar red from a string typed into a *different* client's name.
- **CSS error recovery does not delete the rules that follow a broken one — it swallows them
  as NESTED rules inside it.** So B's selector and B's colour are still sitting in `cssText`,
  naming the right sub-account, matching nothing. The first draft of the harness counted
  `cssRules` and searched their text, and it **passed the neighbour's canary on runs where
  the neighbour had no branding at all**. A check that reads rule text is a check that agrees
  with you; the only honest question is what colour the sidebar comes out, so the suite builds
  a GHL-shaped DOM and reads `getComputedStyle`.
- **The bar is containment, not "junk input must work."** Nobody can make `red/*` mean a
  colour, so that declaration is still dropped — correctly. What each case now asserts is
  that the sub-account's *other* rules still apply and the neighbour's are untouched: every
  case stores a valid `sidebarTextColor` alongside the value under test, in a different rule,
  and reads it back off the nav link.
- Verified live: **29 checks** (`scratchpad/verify-css-injection.ts`), against the REAL route
  on a throwaway agency of its own — this file writes theme rows, and CLAUDE.md records
  `verify-desk` leaving a real sub-account at version 30 by doing exactly that. Confirmed to
  fail **2** under each of three mutations (the comment characters back in a colour; the raw
  family back in `fontImports`; the alert keeping its own escaping — which fails the CR and
  FF cases specifically) and **1** under a fourth (the block comment taking the name raw).
- Plus **6 unit tests** in `themeCssBundle.test.ts` (5 → 11, and 19 after the note below),
  which run in `npm test`
  where the browser suite does not. They pin the characters; the browser suite is what
  measures the blast radius, and neither is enough alone.
- **`cssUrl` came out clean, and that is worth writing down rather than leaving implied.** It
  strips exactly `" \ { } < >` and keeps `;` — which the comment above it already explains,
  because stripping `;` turned every base64 `data:` logo into a broken URL. A `data:` logo
  and a quoted alert message are asserted to still work, the control every SSRF check here
  carries: a guard that blocks the feature is not a fix.

###### The escape hatch deleted the agency's media queries, silently
Found 2026-08-25, in the same file, by reading `scopeCustomCss`'s own doc comment and then
checking it. It said the function "handles flat rules … and **passes at-rules
(@media/@keyframes) through untouched**". It was a single flat regex,
`([^{}]+)\{([^{}]*)\}`, which cannot see nesting at all — `[^{}]*` stops at the FIRST brace,
so it matched the rule INSIDE the at-rule and never the wrapper:

```
@media (max-width: 600px) { .hl_nav { display: none } }
  ->  [class~="LOC"] .hl_nav { display: none }

@keyframes pulse { from { opacity: 0 } to { opacity: 1 } }
  ->  [class~="LOC"] from { opacity: 0 }
      [class~="LOC"] to   { opacity: 1 }
```

- **The media query is GONE and the rule it guarded now applies at every width.** Nothing
  errors and the rule plainly "works" — an agency's mobile tweak simply also happens on the
  desktop their client uses all day. This is the worst kind of silent, because the feature
  looks delivered.
- **`@keyframes` is deleted and replaced with junk.** `from` and `to` are keyframe
  selectors; prefixed, they become element selectors, so the animation vanishes and two
  meaningless rules are emitted in its place.
- **A brace inside a STRING truncated the declaration.** `content: "}"` came out as
  `content: "` — an unterminated string, which in this one-file-per-agency stylesheet is the
  next sub-account's problem rather than this one's. Measured: it took the neighbour's
  branding down, exactly as the colour and alert cases above did.
- **Written down and walked into, in the same breath, for the sixth time in this file** —
  after `navigator.clipboard` and *"blocked (silently rejects)"*, `renamedLabels` and *"only
  the renamed ones"*, BulkBrand's *"never lose a long pasted list"*, `findBrandLeaks` and
  *"an index into the FOLDED string"*, and `cssColor`'s *"valid colors never contain these"*.
- Replaced with a brace-matching splitter that respects strings and comments. Conditional
  group rules (`@media`, `@supports`, `@container`, `@layer`) are **recursed into**, so the
  prefix lands on the selectors inside them; `@keyframes`, `@font-face` and `@page` pass
  through whole, because their blocks hold no element selectors.
- **`@import` / `@charset` / `@namespace` are still dropped, and now on purpose.** They are
  only legal before any other rule, and a per-location block is emitted after the agency
  default and after every earlier sub-account — so the browser would ignore them wherever we
  put them. Dropping changes nothing; pretending to honour them would be the worse answer.
- **A stray `}` is stripped from a selector prelude, which the old regex did by accident.**
  `[^{}]+` could not match one, so a paste that lost its opening brace still worked. The
  splitter has to do it deliberately, and without it the brace lands mid-selector, the
  selector is invalid, and the agency's rule silently vanishes — a usability regression I
  nearly introduced while fixing a correctness bug.
- **One of the new checks passed for the wrong reason first, and the reason is worth
  keeping.** It asserted that a leading `}` could not repaint the NEIGHBOUR — and it passed
  with the guard removed, because the prefix is emitted first, so the brace lands in the
  middle of the selector and makes it invalid rather than closing anything. The stray brace
  was never a containment risk; what the guard protects is the agency's own rule. Rewritten
  to assert exactly that, and it now fails when the guard is dropped.
  - A second draft aimed the custom rule at the sidebar BACKGROUND and reported a working
    fix as broken: the theme's own rule carries a `:has()`, so it outranks anything the
    prefix can build, and the custom rule lost on specificity rather than on parsing. It
    targets the nav link, which the theme leaves alone unless `sidebarTextColor` is set.
- Verified live: the suite grew to **29 checks**, including a `@media (max-width: 1px)` rule
  that must NOT paint at this viewport — the only way to tell "the query survived" from "the
  query was deleted and the rule always fires". Confirmed to fail **2** under a mutation
  restoring the flat regex, and **1** under one dropping the stray-brace guard. Plus **8**
  more unit tests (11 → **19**).

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
- **It answered with the agency's commercial packaging, to anyone who asked** (found
  2026-08-19). The endpoint is unauthenticated by necessity — it is fetched by a script
  pasted into GHL, keyed on an `agencyInstallId` that is **public**, since it sits in the
  `@import` line every agency pastes into their Custom CSS. It returned **eight** fields.
  The pasted script reads **two**.
  - `hiddenFeatures` was the sharp one. This file's own note calls it *the proxy for what a
    client bought* — it is the reason `planName` exists at all — so answering with it told
    anyone who asked which features each of an agency's clients did not get.
    `menuLabelOverrides` is that agency's private renaming scheme for their clients. Neither
    has been read by ANY version of the pasted script; `logoUrl` and `secondaryColor` never
    have either.
  - The rule was already written down one file over: the support widget's config endpoint
    *"deliberately does NOT return `forbiddenTerms` or `allowedLinkDomains` — shipping them
    tells an attacker what to work around."* **Return what the client needs, not what you
    happen to have.** This endpoint had simply never been asked the question.
  - **`primaryColor` and `accentColor` stay**, and only because OLDER pasted snippets read
    them — the ones that injected sidebar CSS, still sitting unchangeable in agencies'
    Custom JavaScript fields. Established from the file's own git history rather than
    assumed, which is what separates the four safe removals from the two that are not.
  - **A concern I nearly wrote down and the measurement killed:** `logoUrl` is base64-inlined
    for uploaded logos, so this looked like a large payload on every page load. The route
    **304s on a conditional request** (measured with raw `http.request`, since undici
    attaches `cache-control: no-cache` and would have shown a 200 either way). It was dead
    weight, not a per-page-load cost. Removing it is still right; the reason is smaller than
    it first appeared.
  - `safeLabels` and its `isKnownFeatureKey` import went with the field — a sanitiser
    running on every request for a value nobody receives.
- Verified live: **14** checks (`scratchpad/verify-bundle-config.js`), and confirmed to FAIL
  on the pre-fix code — inheritance, partial override, and the uninstall stop. The payload
  is asserted **by name** rather than by counting keys, so adding a field somebody has
  thought about does not fail while re-adding one of these does; confirmed by putting
  `hiddenFeatures` back.

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
between builds).

##### What it actually renders, measured (2026-08-25)
The file had **no tests at all**, and two claims rode on it. Both were asked of a real
browser via `ctx.filter`, which takes the CSS filter grammar — checking the solver against
its own model of the filter spec would be circular, since the question is what a *renderer*
does with the chain we ship.

- **Determinism holds.** Same chain within a process, across processes, and with other
  colours solved in between; two generations of one theme are byte-identical. That matters
  more than it sounds: `/theme-css` is `no-cache` with an ETag, so a solver that drifted by
  one percent would change the bytes, change the ETag, and ship a **render-blocking**
  stylesheet on every page load — silently, and only for the agencies using this feature.
  - **`verify-themecss-cache` could not have seen that**: its fixture set `primaryColor`
    only, so the one part of the bundle that is *computed* rather than copied was the one
    part that suite never generated. It now gives every sub-account a distinct
    `sidebarIconColor`, distinct so the memo cannot hide a drift either.
- **Black and white are exact.** Confirmed, and they are what most white-label sidebars use.
- **"Solved colours land within ~4/255 per channel" was WRONG**, and is corrected here rather
  than left as a comfortable number. Measured over a 214-colour sweep of the RGB cube:
  **median 2, p90 6, worst 40**, with **33 of 214 exceeding 4**. `#330066` renders as
  `rgb(50,4,62)` — the blue channel off by 40, which is not "approximate", it is a different
  colour. Real brand colours do fit: the worst of fourteen hand-picked ones is 7 (`#b91c1c`).
- **More search budget does NOT help, and that negative result is the useful half.** The
  obvious fix is to crank the restarts, and a seven-colour spot check appeared to prove it —
  `#000033` went from 33 to 1, `#330066` from 40 to 14. Over the **full** cube at four
  budgets (up to 4x the restarts and a 12x tighter acceptance threshold) the distribution
  does not move: median 2, p90 6–8, worst 40–44 throughout, at 2.5–6x the cost.
  - The spot check was **selection effect**: those colours were picked *because* they were
    bad under the shipped seed, so a different random walk was always likely to do better on
    them and no better anywhere else. Recorded because the mistake is cheap to repeat.
  - So the limit is the **chain**, not the search: some colours are not reachable by
    invert/sepia/saturate/hue-rotate/brightness/contrast applied to black, at any budget.
    Cranking it would have cost a cold-cache `/theme-css` real time on a 2.5s render-blocking
    timeout for nothing.
- **Results are memoised** (`cache`, keyed by hex), which is what makes the cost bearable:
  41 distinct icon colours cost **108ms** on the first ever build and **0.16ms** thereafter.
  A palette reused across sub-accounts is free after the first.
- Verified: **15 checks** (`scratchpad/verify-icon-filter.ts`). Its bars are set ABOVE what
  the code does today — 8/255 for brand colours, 48/255 for the saturated corners — because
  asserting the measured figure is a check that can only ever pass. Consequences: multi-colour icons flatten to one colour, and the rule is NOT
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

#### The content area: three columns that rendered nothing, and the selector nobody has
Found 2026-08-27, by asking what is left to build and taking `audit-fields.js` at its word.
`contentBgColor` and `contentTextColor` appeared **nowhere outside `schema.prisma`** — not in
`visualFields`, not in `VisualTheme`, not in `api.ts`, not in a single control. `darkMode` was
worse, because it looked finished from every angle: accepted by the PUT, stored on all three
models, carried through preset apply, threaded into `LookFields`' `Look`, into `lookFrom`'s
defaults, into `applyPreset`, into the save payload and into `mergedTheme` — and **read by not
one line of `themeCssBundle`**, with the words "dark mode" appearing in the two React apps zero
times. The audit had printed all three every run since it was written.

This is the `faviconUrl` shape at its purest: correct from both ends, dead in the middle, and
indistinguishable from finished without a live test.

- **Why it stayed unbuilt is a real constraint, not an oversight**, and it is the interesting
  part. Every other selector in the stylesheet is either confirmed against live GHL DOM (the
  sidebar, the top bar, the logo) or a best-effort guess at a GHL class name (buttons, cards).
  **Nothing in this repository knows what GHL calls its content container** —
  `check-live-dom.js` stopped at `.hl_header` and the mock harness has no content-area markup
  at all. CLAUDE.md's own position was that building it blind would put speculative rules in a
  render-blocking stylesheet on every sub-account, which is the menu-reordering fallback this
  file refuses.
- **That position is right about GUESSING and wrong about not shipping**, because the
  reordering fallback and this are different in the two ways that decide it. That one would
  force `display: flex` onto GHL's own nav — a LAYOUT property, for EVERY sub-account, whether
  or not anybody asked. These rules set colours only, and emit nothing at all until an agency
  turns them on.

##### `CONTENT_SELECTOR` is built from things that cannot be a guess
```
body, #app, main, [role='main']
```
`body` is universal. `#app` is an **id**, therefore unique — it either exists or it does not,
and it can never match the wrong element. `main` and `[role="main"]` are standards, not GHL's
private vocabulary. Not one entry is an invention like `.hl_wrapper`.

What that buys is the **failure mode**. If GHL paints its screens inside a container we do not
name, these rules are a **visible no-op**: the agency picks a colour, nothing changes, and they
clear it. They cannot break the layout, they cannot repaint the sidebar or the header, and
nobody who has not asked pays a byte.

- **`body` is an ANCESTOR of the location wrapper, not a descendant**, so the usual
  `[class~="LOC"] …` prefix reaches nothing. This takes the alert banner's route instead —
  `html:has(<wrapper>) :is(<bases>)` — which keeps the selector above `body` while still
  scoping the page, and keeps the specificity ordering the rest of the file relies on: the
  location form outranks the agency default on every entry in the list.

##### Dark mode resolves the CANVAS ONLY, and that asymmetry is forced
The obvious design — `darkMode` derives a dark background AND a light text colour, exactly as
the top bar auto-contrasts its tabs — was written first, tested, and **thrown away before it
shipped**. It is wrong here for a reason the top bar does not have:

- A **background** on the canvas changes only what sits BEHIND GHL's screens. Its cards,
  tables, modals and inputs keep painting their own light backgrounds on top, and the text
  inside them keeps GHL's own colour. So a canvas colour **cannot make anything unreadable that
  was readable before** — which is the property that makes an unconfirmed selector shippable at
  all.
- A **`color`** on the canvas **inherits into every one of those components**, which we do not
  repaint because we cannot name them. So light text derived from a dark canvas lands on GHL's
  white cards and disappears.

There is no CSS that says *"colour only the text sitting directly on my background"*, so
deriving the text is a guess that breaks half the screen whichever way it goes. `contentTextColor`
is therefore honoured **only when explicitly set**, and the field says in words that it inherits
into cards and tables. Auto-contrast is right for the top bar, where we paint every surface the
text sits on; it is wrong here, where we paint one surface out of many.

- The **preview shows the consequence rather than flattering the feature**: `mp-card` stays
  white on purpose, so an agency turning dark mode on sees white components framed by a dark
  canvas — which is what ships. Measured in the browser: canvas `rgb(248,250,252)` →
  **`rgb(17,24,39)`**, card `rgb(255,255,255)` throughout.

##### `contentTheme.ts` is the single definition, because the preview is a second opinion
`MosaicPreview` hardcoded `canvasBg = "#f8fafc"` — a **fourth** place with its own idea of what
a theme looks like, after the accent colour, the login page and the menu order, all three of
which this pair has already been caught disagreeing about. The resolver lives in its own
dependency-free module, the dashboard mirrors it in `themeDefaults.ts`, and
`verify-preview-truth` compares the two **by value over synthetic themes** — never by reading
either, since "both files mention dark mode" is exactly the check that would have passed all
along. The literal survives in the preview only as its stand-in for *"the stylesheet emits
nothing"*, which is asserted.

- `contrastingTextColor` and `relativeLuminance` **moved** into that module rather than being
  copied; `themeCssBundle` imports them for the top bar. Two copies of "the same" colour maths
  is how `cssString` ended up escaping two different sets of characters.

##### Verified
- **27 live checks** (`scratchpad/verify-content-area.ts`) against the real route on a throwaway
  agency of its own, reading the bytes `/theme-css` actually serves: an untouched theme emits
  **zero** content rules while the colour it did set is present (the control — "no content
  rules" is trivially true of a stylesheet that failed to build); dark mode emits exactly one,
  a background, and no text colour; a chosen colour beats the toggle; the rules never name the
  sidebar or the header and carry no layout property; a sub-account's canvas does not become
  its neighbour's; the agency default paints globally and a sub-account overrides it, emitted
  in that order; and a value carrying `/*` or `;}` cannot open a second block.
  Confirmed to fail **4** under a mutation that derives the text colour and **3** under one that
  drops the location scoping.
- **6 unit tests** (`contentTheme.test.ts`) and **8** more in `themeCssBundle.test.ts` (19 → 27),
  which run in `npm test` where the live suite does not. Confirmed to fail under a mutation that
  ungates the rules.
- **18 more in `verify-preview-truth`** (38 → **56**), twelve of them the two resolvers compared
  case by case. Confirmed to fail **2** when the preview re-derives a dark-mode text colour and
  **1** when the stylesheet paints a canvas nobody asked for.
- **And asserting the resolver proves nothing about the screen.** Rendered in a real browser on
  the dev agency: all three controls present on the branding tab, `text-transform: none` and
  weight 600 (not the `.field label` heading trap that has caught this file three times), both
  colour rows reading **`not set`** with the hatched swatch, and the preview canvas moving to
  `#111827` and back.

##### Two things the audits had to learn, and one they caught
- **`audit-fields.js` reported all three as dead AFTER they were built**, because a column can
  reach the stylesheet through a **resolver** rather than by name: `themeCssBundle` reads only
  `content.bg` / `content.text`. Its file list was widened by measurement, the discipline its
  twin already records for `App.tsx` — of all 65 columns across the two models, `contentTheme.ts`
  mentions exactly these three, so nothing can hide behind it.
- **Its `reaches` regex could not see optional chaining.** `theme\.<f>` and `t\.<f>`, but the
  resolver reads `t?.contentBgColor`. A resolver that reads `t?.x` reads the column exactly as
  much as one that reads `t.x`, and missing that reported three live columns as dead — a
  standing false positive on the audit's own newest work, which this file says destroys a
  report. Widened, with the control that the two genuinely dead columns (`secondaryColor`,
  `updatedByUserId`) still report: 9 findings → **3**.
- **`verify-history-restore` caught a real gap in code twenty minutes old**, which is the
  clearest argument for that check existing. The content colours went into the save payload and
  not into `loadVersion` — the `faviconUrl` bug exactly, restoring an old version keeping
  TODAY's colours and writing them over the top on save.
  - The fix was not to add two lines. Its `LOOK` exemption set was a **hand-written copy of the
    `Look` interface**, so it drifted the first time a field was added and reported a working
    restore as broken. It is parsed out of `LookFields.tsx` now, with a positive control on the
    parse — a set that swallowed the file would exempt everything and pass having checked
    nothing. 24 → **25 checks**, and still fails when `loadVersion` stops reading a field.

##### The assumption is now MEASURABLE, which is the part that was missing
`check-live-dom.js` gained a content-area section, and it does what the reordering half does:
it does not read a computed style and infer, it **paints `body` magenta and asks which
ancestors are covering it up**. Content is found as the largest block that is not the sidebar
and not the header, rather than by guessing a class — the same discipline as the constant.

Verified against two fixtures rather than trusted, because a diagnostic that cannot report the
failure it exists to find is worse than none:

| fixture | verdict | detail |
|---|---|---|
| content in a bare `<main>` | **YES** | "nothing paints over body — a background on `body` is enough" |
| content in a `.hl_wrapper` that paints `#f8fafc` | **NO** | names `div.hl_wrapper.hl_wrapper--inner  [rgb(248, 250, 252)]` |

In the failing case it **names the element to add to `CONTENT_SELECTOR`** and says that nothing
else has to change, because the rules, the resolver, the preview and the controls are all
already built. That is what turns a safe default into a measured one, in thirty seconds, the
next time anybody has a real GHL tab open.

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


#### One blank env var makes EVERY rate limit global (`TRUST_PROXY_HOPS`, 2026-08-25)
Found by asking what tests `services/security.ts` — the answer was nothing, for a file whose
four exports gate the `?k=` slug, keep `client_secret` out of log storage, and hold
`/desk/api/login` to 10 attempts a minute.

`index.ts` read the hop count as `Number(process.env.TRUST_PROXY_HOPS ?? 1)`. **`??` does not
catch an empty string**, and Render's Environment tab will store a key with a blank value
quite happily. `Number("")` is 0 and `Number("two")` is NaN, and Express trusts nothing for
either — so `req.ip` becomes the PROXY's address and every caller lands in one bucket.
Measured with four clients each behind one proxy, against a limit of 3:

```
TRUST_PROXY_HOPS unset   req.ip = 9.9.9.1  9.9.9.2  9.9.9.3  9.9.9.4     0 refused
TRUST_PROXY_HOPS=""      req.ip = the proxy, four times                  1 refused
```

- **What that costs is the whole point of the limits.** `/desk/api/login` becomes ten
  attempts a minute **for the entire internet** — one person mistyping their password locks
  out every Mosaic agent — and `/support/api`'s 60/min starts 429ing real clients' chat
  messages, which is the exact failure the widget's 15s→60s poll widening exists to avoid.
  Nothing in the request path can notice; the limiter looks like it is working.
- **The `Number("")` trap, for the fifth time in this file**, after `maxConcurrent`,
  `slaFirstResponseMins`, `supportEnabled` and a preset's `menuOrder` — and this instance is
  on the setting that makes every OTHER limit per-client rather than global.
- **Not currently set anywhere** — not in `.env`, not in `render.yaml`, not documented — so
  today the default of 1 is correct and this is a trap laid for the next person, most likely
  whoever puts Cloudflare in front and needs 2. It is deliberately NOT being added to
  `render.yaml`: a key sitting there with a blank value is precisely the failure.
- **`trustProxyHops()` lives in `env.ts` and `validateEnv` calls it first**, so a value it
  cannot read fails the BOOT rather than silently globalising the limits. Blank or unset
  means "not configured" and takes the default; anything present and unusable is fatal.
- **`security.ts`'s own comment recommended the insecure option.** It said the limiter
  *"requires `app.set("trust proxy", true)"`* while `index.ts` correctly used a count —
  and `true` trusts the whole `X-Forwarded-For` chain, so any client can prepend an address
  and get a fresh bucket per request, which on the login route is unlimited guessing. A
  comment that argues for the wrong thing is worse than no comment: the next person reading
  it "fixes" `index.ts` to match. Corrected, with the reason.
- **19 unit tests** (`security.test.ts`), the file's first: `safeEqual` returning false on a
  length mismatch rather than throwing (a 500 that a correct-length guess does not produce
  is an oracle); `describeError` asserted against a realistic Axios error to prove
  `client_secret`, `refresh_token`, the auth code and the bearer token are all absent from
  what it returns; `securityHeaders` setting `no-referrer` **and deliberately NOT setting
  `X-Frame-Options`**, since the product is embedded in GHL's iframe; and the limiter driven
  through a real Express app over HTTP, including the one-bucket failure above stated as a
  fact rather than a worry. Confirmed to fail **2** under a mutation restoring
  `Number(… ?? 1)`.
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

##### …and the admin API itself was answering the same question (found 2026-08-20)
`requireAgency` looked the agency up in Postgres FIRST and 404'd on an unknown id, then
checked the token. So an unauthenticated caller could tell a real `agencyInstallId` from a
made-up one — **404 for one, 401 for the other** — which is the `/portal/:slug` oracle
again, on the routes that oracle was closed to protect. The note above says `/admin-embed`
returns a deliberately generic refusal precisely so it reveals nothing; the routes behind it
answered for free.

- **The token needs no database.** It is `agencyInstallId.expiry.signature`, verified against
  the id in the PATH, so checking it first costs one HMAC. As written, every unauthenticated
  request reached Postgres before any credential was examined — on a 512MB single-threaded
  free instance, which is the same reasoning that caps `MAX_FEED_BYTES`.
- The id is public (it is in the `@import` line), so the leak is **enumeration rather than
  disclosure** — worth stating plainly rather than overselling. What makes it worth fixing is
  that the fix is an ordering swap that also removes an unauthenticated query and repairs the
  deploy gate below.
- **It made `npm run smoke` report the opposite of the truth.** That gate probes this
  endpoint with a FABRICATED agency id whenever `--agency` is omitted — the documented
  default invocation — and asserts 401/403. A correctly protected deploy answered **404**, so
  the post-deploy check on *the single most expensive setting in the product* failed on
  exactly the deployments that had it right. Measured against a server booted with
  `DASHBOARD_AUTH_ENABLED=true`, before and after.
  - CLAUDE.md's claim that pointing smoke at localhost "fails exactly twice… that is the
    check demonstrating it discriminates, not a defect" was true only by coincidence: local
    dev runs with auth off, so the failure looked right for the wrong reason. **The one
    environment where the check was exercised is the one where its bug is invisible.**
  - With the ordering fixed, a **404 there now means something**: only a server that skipped
    the token check can produce it, so the gate says so in words instead of printing a status
    code the reader has to interpret.
- Pinned by 3 checks in `verify-session` (**27**), asserted as an **equality between the two
  refusals** rather than as "the 404 is gone" — indistinguishability is the property, and it
  survives somebody later choosing a different status code. Confirmed to fail all three when
  the lookup is put back in front.

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
  - **…and it decided that by SUBSTRING, which was wrong in both directions** (found
    2026-08-25, by asking what tests `validateEnv`; nothing did). It tested the whole URL
    for the strings `localhost` and `127.0.0.1`. Measured:

    | `APP_PUBLIC_URL` | read as | should be |
    |---|---|---|
    | `https://localhost.example.com` | dev | **production** |
    | `https://app.localhost-labs.com` | dev | **production** |
    | `https://127.0.0.1.nip.io` | dev | **production** |
    | `https://real-host.com/?redirect=localhost` | dev | **production** |
    | `https://[::1]:3210` | **production** | dev |

    - **The first four are the dangerous direction.** Read as dev, a deployment requires
      neither `DASHBOARD_AUTH_ENABLED` nor `WEBHOOK_SIGNATURE_PUBLIC_KEY` — the two settings
      this file calls fatal in production — so it boots with the admin API reachable using
      only the public agency id and with forged lifecycle webhooks accepted. It would also
      stop marking the desk cookie `Secure`, and `SAFE_FETCH_ALLOW_LOOPBACK` would no longer
      refuse itself.
    - **The fifth is the same bug in reverse**, and is precisely the case the SSRF work
      already recorded: *"loopback spelled `::ffff:7f00:1` is exempted consistently, since an
      exemption that depended on spelling would be the original bug in reverse."*
    - Same class as that fix, one file over: **a hostname treated as a substring of a URL**,
      where the rule already written down is *"an IP is a number; any check that treats it as
      text is one alternative encoding away from being wrong."* And `env.ts`'s own comment
      shows it had spotted the neighbouring trap — *"the https check alone is not enough"* —
      and then walked into this one.
    - Now parses with `new URL()` and tests the HOSTNAME: `localhost` or `*.localhost`
      (RFC 6761 reserves it), or an address `BlockList` resolves into `127.0.0.0/8` or `::1`.
      `127.1` and `::ffff:127.0.0.1` therefore work, because `BlockList` parses to bytes.
    - **An https URL that will not parse is treated as PRODUCTION.** Unknown must mean the
      stricter answer, or the fail-closed rules are one malformed string away from being off
      — the opposite default to the old code, which fell through to "dev".
    - **14 unit tests** (`env.test.ts`), which is the first coverage `validateEnv` has ever
      had: every required variable named when missing, https demanded even locally, the two
      production refusals, and that `DASHBOARD_AUTH_ENABLED` accepts only the exact string
      `"true"` (`TRUE`, `True`, `1`, `yes` are all refused — it is `!== "true"`). Also that
      the three deliberately NON-fatal gaps stay non-fatal, because making one fatal would
      break a working install. Confirmed to fail **3** under a mutation restoring the
      substring check.
  - **`tokenCrypto.ts` had no tests either, and a deployment rule rests on its behaviour.**
    CLAUDE.md states *"the auth tag means a wrong key THROWS, so every agency silently has to
    re-authorise"* — that sentence is the whole reason `tokenFailure.ts` can tell `decrypt`
    from `revoked` from `transient`, and it was a claim about AES-GCM that nothing checked.
    Were a wrong key ever to return garbage instead of throwing, the refresh loop would send
    rubbish to GHL and read the answer as a revocation, which is the one classification that
    tells an operator to re-authorise when the key is simply wrong. **8 unit tests**: the
    round trip, a random IV per encryption, and a throw for a wrong key, a tampered
    ciphertext, a tampered auth tag, a truncated value and a missing key.
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
- **…and signing back in gave them a BLANK desk** (found 2026-08-20, by rendering the
  overlay — it had never been looked at in a browser). Everything the design promises holds
  for the ticket: the overlay is fixed and covers the viewport, `Ticket` stays mounted, the
  half-written reply is byte-for-byte intact, the same person carries on mid-sentence, and a
  DIFFERENT person gets the view reset and an empty compose box on the very same ticket.
  Then the lists behind it were empty.
  - **Measured, in rows over time: `0ms:0  1000ms:0  2000ms:0  4000ms:0  8000ms:0
    12000ms:2`.** The desk keeps polling behind the overlay with a cookie that no longer
    names anything, so 401s empty `Inbox` and `QueueBoard` — and **nothing in the sign-in
    path asks them to try again**, so recovery is whatever the next 15s tick brings.
  - **An empty inbox is not a neutral thing to show an agent.** It is indistinguishable from
    "nothing is waiting" — the same trap the away banner exists for, *"a quiet desk that
    looks like a quiet day"*. And the whole argument for re-authenticating over the live desk
    is that signing back in restores what was on screen; restoring the compose box and not
    the work queue keeps half of that promise.
  - **The transcript was stale for the same reason, and that is the sharper half.** A client
    message sent while the session was dead was still absent afterwards, so an agent would
    finish and send a reply without seeing what the client said in the meantime. A preserved
    draft becomes a liability at exactly that point. `Ticket` now takes a `reloadKey` and
    reloads the TRANSCRIPT only — the draft is what this whole design exists to protect and
    is deliberately untouched.
  - Fixed with the mechanism already there: `onReauthenticated` bumps `refreshKey`.
  - Verified live: **28 checks** (`scratchpad/verify-desk-reauth.ts`), driving a real browser
    against a session row deleted underneath it — which is what an expiry looks like from the
    browser's side. Confirmed to fail **3** under a mutation dropping the refetch, with the
    row-count line reproducing the twelve-second blank exactly.
  - **A property nobody had written down, measured rather than reasoned about:** the two
    `<Ticket>` elements live in mutually exclusive branches of one ternary, so whether a
    draft survives a glance at the Queue board is a fact about how React pairs those elements
    up. It does survive — asserted now, because the Queue tab is the DEFAULT landing and
    checking the board mid-reply is ordinary desk work, so a future wrapper element would
    silently start eating replies.
  - Two harness faults worth recording, both of which reported a product failure that was not
    there. It matched inbox rows by **the row's whole text, which carries a relative clock**
    ("2m ago") that ticks between two reads — it matches on the subject now. And the fixture
    was written with raw Prisma, so `lastMessageAt` was NULL and the conversation was simply
    **absent from the list the inbox filters and orders on**; the suite then fell back to
    whatever was at the top and later asked for "our ticket", which was never there.
- **…and nobody could change the password they were given** (found 2026-08-18). `POST
  /desk/api/password` existed and was correct — verifies the current password, enforces a
  12-character floor, rotates, revokes every session, mints a fresh one for this browser.
  `changePassword` existed in the desk's `api.ts`. **It had zero callers**, exactly like
  `createCannedReply` before it: a complete mechanism with nothing feeding it, finished
  from every angle except trying to use it. `create-desk-user` even prints *"To reset their
  password, use the desk's password change flow"* — pointing operators at a screen that did
  not exist.
  - It matters more than one missing dialog suggests. The password is chosen by an admin
    and read out over chat or email (deliberately — there is no signup), so with no way to
    rotate it, the credential to an account that reads EVERY agency's conversations stayed
    permanently known to whoever set it up, and permanently sitting in whatever channel it
    was sent through.
  - **A wrong current password returns 401, and the desk reads any 401 as the session
    dying.** Left alone, mistyping your own password would raise the "you have been signed
    out" overlay over the form — false, and unrecoverable-looking. `App.tsx` suspends the
    central handler while the dialog is open, via a **ref**, because the handler is
    registered once and must not close over a stale value (the same reason `hasSignedIn`
    is one). The live check asserts that 401 lands on a session that is still valid.
  - **The endpoint only started needing a rate limit once it was reachable.** It sat on the
    generous 600/min desk budget because nothing could call it; it submits the current
    password, so it is a guessing target, and the case that matters is an unattended
    signed-in machine where guessing it is the difference between reading today's tickets
    and holding the account. Now 10/min, in **its own** bucket rather than login's — a busy
    office behind one NAT must not spend its sign-ins on somebody rotating a password.
  - Verified live: **16 checks** (`scratchpad/verify-desk-password.ts`) with two browsers
    signed in as one agent — the floor and the wrong-password refusal, the rotation keeping
    *this* browser and dropping the other, the old password genuinely dead, no unrevoked
    session left in the table, and the guessing limit not starving sign-in.
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
- Verified live: **43** checks (`scratchpad/verify-desk.js` pattern) including the plan's
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

##### The desk showed agents our template syntax (found 2026-08-26, by rendering a ticket)
`shoot-desk.mjs` printed the provenance row off a real ticket:

```
from: Adding Files To {{FEATURE:contacts}} using a Custom Field, Contact Profile Picture,
      ConvertKit to {{PLATFORM}} (Migration Guide),
      Troubleshooting Bulk Imports Via CSV: {{PLATFORM}} Support Portal
```

Article **titles** are stored placeholdered like everything else in the corpus, and both
places that hand them to an agent passed `c.title` straight through — the ticket payload and
the AI draft. `renderForBrand` was never called on either.

- **The function written to stop exactly this says so in its own doc comment**: an unmapped
  key falls back to its default label *"rather than leaving a raw placeholder on screen"*.
  Seventh instance in this file of reasoning written down and walked into, and the only
  consumer that skipped it is the one that renders to a human.
- **It is not merely untidy.** The whole point of showing provenance to a rep is that they
  read it and sometimes quote it — and `{{PLATFORM}}` is neither a vendor name nor a link, so
  `checkAgentDraft` waves it through. An agent pasting that title sends our template syntax
  into a customer's chat, past all three gates.
- CLAUDE.md had already seen the shape from the other side and not followed it here: the
  chrome-repair note lists *"a citation reaching a support agent is rendered as a title, and
  424 of them read `Text-To-Pay Links: {{PLATFORM}} Support Portal`"* as a reason to strip
  crawled chrome. The chrome was stripped; the placeholder was not rendered.
- One `citationTitles()` read by both routes. **Still titles only, never a source URL** —
  the older rule is asserted alongside the new one, because a fix that widened the payload
  while tidying the wording would be the worse trade.
- Measured after the fix, same ticket: *"Adding Files To **Contacts** using a Custom Field …
  Troubleshooting Bulk Imports Via CSV: **Harbour Suite** Support Portal"*.
- Verified: `verify-desk` 38 → **43 checks**, planting a bot answer whose citation titles are
  placeholdered exactly as the corpus stores them, and asserting both substitutions by value
  plus the absence of `{{`. Confirmed to fail **3** under a mutation restoring the raw
  pass-through.
  - Two of the suite's own checks broke when the fixture grew a message — *"transcript is
    included"* and *"the blocked reply was NOT stored"* both asserted `length === 1`. They
    measure the delta and the ROLES now, which is what they always meant: an absolute count
    says "the refused reply added nothing" only by coincidence.

###### …and the screenshot driver's documented setup was a permanent desk login
Found while running it. `shoot-desk.mjs`'s header said to run `create-desk-user --email
demo@mosaic.test --password screenshot-demo-pass` — **with the password in the comment** — so
anybody who followed the setup left an active account, on a published credential, that can
read every agency's support conversations.

- It now **makes its own account and deletes it**: random password per run, removed at the
  end and on SIGINT/SIGTERM/SIGHUP. The setup step is gone from the header.
- **And it says so LOUDLY when the delete does not happen**, which was measured rather than
  imagined: the datastore dropped mid-run, the delete returned `-1`, and the account was left
  live. A quiet failure there is the whole defect this was built to avoid, so a non-1 count
  prints the address and points at `npm run readiness`.
- The two halves are deliberate: the driver stops CREATING permanent credentials, and
  `harness-desk-accounts` catches the ones a SIGKILL leaves behind anyway.

#### The agent could not see what the agency had written down (2026-08-27)
Asked for directly: *"once a lead comes in from a particular agency the files of that agency
can be viewed in the chat."* There is no file or attachment model anywhere in the schema, so
"files" can only mean the one agency-scoped body of content that exists — the articles they
write in *Client support → Your content*.

The gap was real and had been there since the desk was built. `kbSearch` ranks an agency's
own articles **above** the shared corpus, and this file already says why: they answer *"how
do I use YOUR process"*, which vendor documentation never will. The desk got none of that.
It saw the titles the bot happened to **cite**, on messages the bot **answered** — so on a
ticket the bot returned nothing for, which is most of the ones that reach a human, the agent
saw nothing at all. The most relevant content in the corpus was invisible on the one screen
where a person is deciding what to say.

`GET /desk/api/conversations/:id/agency-kb`, and a collapsed panel in `Ticket.tsx`.

- **Scoped by the CONVERSATION, never by a parameter.** The agency is read off the ticket, so
  there is no id an agent could pass to read somebody else's content — the rule canned
  replies already enforce with a 403. The mutation that drops it is worth recording because
  of what it produces rather than that it fails: every agency's articles on every ticket,
  **rendered under the reading agency's brand name** — `Refund steps in Agency b` on agency
  A's own runbook. One agency's private process, retitled as another's.
- **Rendered for THIS client's brand.** The corpus is stored placeholdered, so a raw title
  reads `Refund steps in {{PLATFORM}}`. This file records that exact defect reaching agents
  through the citation row one day earlier — our own template syntax on screen, which is
  neither a vendor name nor a link and therefore passes all three gates on the way into a
  customer's chat. Measured after: *"How we onboard a new client in **Harbour Suite**… walk
  them through **Contacts** and **Deals**"* — the agency's rename, on the agent's screen.
- **Quarantined articles are WITHHELD and COUNTED.** `needs_review` means something
  brand-shaped survived normalisation, so retrieval skips them; offering one to an agent is
  handing them text we already believe names the vendor. But an absent article is
  indistinguishable from one never written, so the count comes back and the panel says so —
  the review queue's rule, that naming the problem beats silence.
- **No `sourceUrl`, ever.** *"A link visible to a support rep is a link that gets pasted into
  a client reply."* Bodies are safe by construction (every URL is stripped at ingest); the
  provenance column simply must not travel.
- **The panel sits ABOVE the brand banner, never between it and the compose box.** That
  banner is pinned flush to the box on purpose — brand name, renames, hidden features and
  forbidden terms are the last thing read before typing — and displacing it to make room for
  a reference panel would undo the one placement decision the desk is built around. Measured
  in the browser: `gapBannerToCompose: 0px`, `panelAboveBanner: true`.
- **Collapsed, with the count in the summary.** A disclosure whose label says nothing about
  what is inside is one nobody opens — the onboarding-snippet trap, avoided rather than
  repeated.
- **A failed fetch reads as "couldn't load", not "none written".** Those are different facts
  and only one is a reason to stop looking — the same distinction the live gate check makes
  between a FAILED check and a CLEAN one.
- **Zero agency-authored articles existed on this database**, which is the state every
  install starts in and the one this file has been bitten by twice (the hand-off tile that
  hid itself, "Your content" never rendered with data). The empty state therefore says what
  the agency's own content is FOR and where they add it, rather than rendering nothing.
- Verified live: **20 checks** (`scratchpad/verify-agency-kb.ts`) on two throwaway agencies
  with a throwaway desk account, articles written through the REAL ingest route so the
  placeholdering under test is the product's and not the harness's. Confirmed to fail **1**
  under a mutation dropping `renderForBrand`, **3** under one dropping the agency scope, and
  **1** under one admitting `needs_review`. Its load-bearing control is that the same agent,
  in one session, gets **different** content on the two tickets — a route ignoring scope
  passes every single-agency assertion.
- **And asserting the payload proves nothing about the screen**, so it was driven in a real
  browser: panel summary *"This agency's own content — 2 articles"*, titles and bodies
  brand-rendered, and **no `{{` anywhere in `document.innerText`**.
  - One driver fault worth keeping: a synthetic `.click()` on the inbox row is a **no-op**
    (React binds the handler on an inner element), and it printed the row's text as though
    it had worked while the pane still read *"Pick a conversation to work on."* — so the
    panel then measured as `PANEL NOT RENDERED` on a ticket that had never opened. Dispatch
    a real `Input.dispatchMouseEvent` at the row's own coordinates.

#### The banner could not show a rename, and the dry run invented fifty-one
Found 2026-08-19, by rendering the dry run — the go-live gate, which had never been looked
at in a browser. Its verdict line read:

> Answered as **Acme Portal** · using your names: Launchpad, Dashboard, Conversations,
> Calendars, Contacts, Opportunities, Payments…

on a sub-account whose stored `menuLabelOverrides` is **`{}`**. It had renamed nothing, and
was being told it had renamed **all 51** menu items — on the one screen whose entire job is
to show an agency the inputs that differ from every other agency's.

Both surfaces that answer *"what does this client call things"* were handed
`brand.featureLabels`, which is the COMPLETE map (defaults overlaid by overrides) because
`{{FEATURE:key}}` substitution needs every key whether or not it was renamed. And the desk
half is where it bites hardest — `deskInbox.ts` says so directly, one line above the bug:

```
// Only the renamed ones: an agent needs to know what differs from the default, not
// read a 40-row table of things that are exactly what they look like.
renamedLabels: brand?.featureLabels ?? {},
```

The reasoning was written down and the code walked into it in the same breath, exactly as
`navigator.clipboard` and *"blocked (silently rejects)"* did.

- **The banner renders `slice(0, 6)` and "+45", and the six were FIXED by `ALL_FEATURES`
  order** — launchpad, dashboard, conversations, calendars, contacts, opportunities.
  Measured: renaming any of the **other 45** (Payments, Marketing, Automation, Sites,
  Memberships, Reputation, Reporting, and every Settings item) was invisible behind the
  "+45", always, for every agency. So the banner could not show the thing it exists for
  except by an accident of ordering, and spent its six slots on words that are exactly what
  they look like. That is the cross-brand slip it is pinned above the compose box to
  prevent, delivered by the banner itself.
- **`renamedLabels` now lives on the BRAND MAP**, computed once beside `featureLabels`, so
  the desk banner and the dry run cannot arrive at two different answers — the `QUEUE_ORDER`
  and `slaStatus` rule. Both consumers read it; nothing else changed.
- **Added, never narrowed.** `featureLabels` stays complete and its doc comment now says
  why: narrowing it to the renames would silently stop substituting every un-renamed
  placeholder, which is a far worse bug wearing this one's clothes.
- **Compared BY VALUE, not by key presence.** An agency who typed "Contacts" into the
  Contacts box has renamed nothing, and an override map can carry such an entry. A key with
  no platform default is a rename by definition, so `from` falls back to the key.
- **A pair, not a label.** `to` alone is half the fact — an agent reading "Deals" still has
  to guess what it replaced, and moving between the client's words and the platform's is the
  whole job. It was written label-only because 51 pairs would not have fitted; at nought to
  three it does. Rendered: `Renamed: Opportunities → Deals`, and the dry run now says
  `using your names: Opportunities → Deals`.
- **The old check passed for the wrong reason, and so did both drivers.** `verify-dryrun`
  asserted only that `renamedLabels.opportunities === "Deals"` — true the entire time the
  route was returning all 51. It now asserts the SIZE and that an untouched item is absent
  by name. Worse, `shoot-dashboard` sliced the verdict to 140 characters and `shoot-desk`
  sliced the banner to 120, so **neither driver could ever have shown this**: the tail is
  where you see there are fifty-one. Both truncations are gone, with the reason written
  beside them. *A measurement that cuts off the thing under test is a measurement that
  agrees with you.*
- Verified live: `verify-desk` **38** (renames arrive as pairs; a sub-account that renamed
  nothing reports none) and `verify-dryrun` **27**, and confirmed to fail **2** under one
  mutation — dropping the filter, i.e. the original bug. Then rendered in both browsers,
  because asserting the payload proves nothing about the screen.

##### …and that suite had been deleting the agency's whole support policy
Found while fixing the above. `verify-desk`'s teardown ended with
`supportConfig.deleteMany({ where: { agencyInstallId: agency.id } })` — **scoped**, which is
precisely why the sweep that caught the six unscoped ones missed it, and precisely what the
note on that fix says is not enough: *"scoping fixes the neighbours, not the agency under
test."* `agency.id` is `findFirst()`, so on any dev database that is the ONE agency, and
every run destroyed its greeting, blocked terms, business hours, response targets and plan
names. This is the most likely explanation for the config that vanished earlier in the week.

- Now snapshots the row up front and **puts it back**. Proven by planting a marked config,
  running the suite, and reading it back byte for byte — greeting, blocked terms, escalation
  address, plan names, response targets and the master switch all intact, with the teardown
  printing what it restored.
- **It was also renaming two REAL sub-accounts and leaving them renamed.** The theme has to
  be written through the route (a raw Prisma write does not invalidate the brand-map cache),
  so each run added a version and left "Acme Portal" / "Beta Hub" as the current brand
  forever — which is why one sub-account had reached **version 30**. The teardown now records
  each location's top version first and drops everything above it (`themeVersionsDropped=2`).
- **"Assumes an empty database" is now a FIVE-time failure** (see `verify-offboard` below), and this is the sharpest:
  *"refused when the agency has no escalation email"* asserted a 400 straight from the
  fixtures. Configuring an escalation address is REQUIRED before the master switch will turn
  on, so the assumption is false on every real install — it returned 200 and reported a
  safety refusal as **missing**, sending the reader hunting a bug in a guard that is fine.
  The other three misreported a number; this one misreported the refusal that stops a client
  hand-off going nowhere. The suite now ARRANGES the no-address state and restores it.

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

#### A ticket nobody on duty can take, sitting at the top of the board (found 2026-08-19)
Found by RENDERING the queue board, not by reading it. `queueWhere` filters
`tier: { lte: maxTier }`, so a tier-2 ticket on a desk of tier-1 agents is skipped by
`claimNext` and by distribute alike — correctly, per the tier rule above — and shown to
every agent as an ordinary row.

Measured on the live desk: it was the **oldest and reddest row on the board, 28 hours in**,
and pressing "Take next" returned a ticket queued a *day later* without a word about the one
it had stepped past. Every surface said queued; nobody could reach it. That is the stranded
-ticket failure in a new place, and the existing alarm could not see it — it fires only at
**zero capacity**, which is the case where the desk already knows something is wrong. Here
capacity was 11.

- **Readiness has `unstaffed-tier`, and that is not enough.** It is a deploy-time log; the
  agent staring at the board all day never reads it. The fact has to be on the screen where
  the decision is made — the same reasoning that puts the brand banner directly above the
  compose box.
- **Split by REMEDY, because they are not the same problem.** *No account holds that tier at
  all* never clears on its own and means raise somebody's tier or hand it to the agency;
  *whoever holds it is away* fixes itself when they are back. One sentence for both would be
  wrong half the time.
- **Silent when nobody is on at all**, because the zero-capacity alarm already says exactly
  that — two alarms for one fact is one alarm people stop reading.
- **`queueReach.ts` is extracted**, same reasoning as `slaTone` and `bulkEnableLogic`: it is
  a judgement an agent acts on, and inline in a component it can only be checked by
  clicking. It invents nothing — both halves are already in the one `/desk/api/queue`
  payload, so it is a reading of what the desk was shown, not a second opinion.
- Verified live: `verify-tickets` grew to **74 checks**, EXECUTING the rule rather than
  reading it, and confirmed to fail 2 under a mutation that makes nothing unreachable.
  `shoot-desk.mjs` is the witness that the alarm actually renders — which is what found it.

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
- Verified live: **24 checks** (`scratchpad/verify-offboard.js`), and confirmed to score
  **12/13** on the pre-fix code — including the widget telling a waiting client that somebody
  had picked their conversation up.

##### The Staff screen reported a routing state nobody held, and wrote one nobody chose
Found 2026-08-19, by rendering `StaffAdmin.tsx` — the screen readiness itself points at
(*"Raise someone's tier in the desk's Staff tab"*), and the one place offboarding happens.
It had never been looked at in a browser. The CSS was fine; the two defects were both about
`maxConcurrent`, which is what decides *"all agents are busy, you're 3rd"*, who distribute
levels onto, and whether a fourth ticket is refused.

- **A REFUSED limit stayed on screen looking accepted.** Measured: typing 99 over a stored 3
  got back `400`, and the cell still read **99** while the database held **3**. The input is
  uncontrolled for a real reason — a controlled one re-renders the table on every keystroke
  and the value only leaves the cell on blur — so the component's own revert could never
  reach the DOM. Fixed with a `key` carrying the stored value plus a per-row revision, which
  keeps the reason and makes the revert real: the box is remounted from the server's answer
  whenever a save settles, either way.
- **And the reason was 390px above the row.** The page-level `.error` banner sits above the
  "Add a team member" card; the first table row is below it and every other row further
  down, so on a desk with more than a handful of accounts the refusal is off-screen and the
  only thing visible is the number the server declined. It is a `.row-error` beside the
  control now — the same reasoning that puts the brand banner directly above the compose box.
- **CLEARING the box took a live agent out of rotation, silently.** `Number("")` is 0, and 0
  is a REAL value here (documented: *"a way to take someone out of rotation without marking
  them away"*), so the server genuinely could not tell an emptied box from somebody choosing
  it. Measured: select-all, tab away, and `maxConcurrent` went to 0 — an **active,
  available** agent invisible to `claimNext`, skipped by distribute, counted as zero capacity
  in the client's wait estimate, with a **blank cell** and no error. That is the
  away-versus-disabled failure through a third door: a routing state nobody chose.
  - **Two layers, like the gates.** The client never sends an emptied box (a blank is a
    mid-edit state, not an instruction, and it says so). The route also refuses a blank or
    non-numeric value outright rather than letting `Number()` turn it into 0 — the general
    trap, not a detail of this column: `Number("")`, `Number(" ")` and `Number(null)` are
    all 0, so **any field read straight through `Number()` reads a cleared box as a
    deliberate zero.** A typed 0 still works, because forbidding it would break the
    documented way to take somebody off rotation.
- **The blast radius of Disable was unreadable before the click.** The confirm said *"any
  ticket they are holding goes back to the queue"* — a hedge the reader cannot resolve, when
  the number is in our own database and is exactly what decides whether the offboarding
  happens now or at the end of a shift. Same principle as the dashboard's bulk disable naming
  how many sub-accounts are on another page. There is a **Holding** column (`3 of 3`, amber
  at the limit) and the confirm names the count.
  - **The count the screen SHOWS is the count the release DELIVERS.** `heldCountsFor` and
    `releaseTicketsFrom` read one `HELD_STATUSES`, so the dialog cannot promise a disruption
    the disable does not honour — the `QUEUE_ORDER` rule, and the load-bearing check in the
    suite. One `groupBy` for the whole list, never a query per row.
- Verified live: **29 checks** (`scratchpad/verify-staff.ts`), each rejection asserted twice —
  the status *and* the stored row, since a 400 alone says the route refused it and only
  reading the row proves nothing was written. Confirmed to fail **11** under two mutations
  (reading the numbers straight through `Number()`; dropping the count from the list).
- **And asserting the route proves nothing about the cell**, which is the whole shape of the
  first defect — the server was already right to send a 400. So `shoot-desk.mjs` grew a Staff
  step that reads the DOM: after a refused 99 the cell must read the stored value, after a
  cleared box it must read the stored value, and the confirm text is captured from the CDP
  dialog event.

###### Two driver faults found in the same run, both printing readings from nothing
- **The New-ticket step had been searching the wrong screen.** "New ticket" lives in the
  queue board's header, and the steps above it navigate to the Inbox and open a ticket — so
  it printed `NOT FOUND`, then `modal-backdrop present: false` and `backdrop position: none`
  as though those were measurements. That modal is the exact screen `audit-styles.js` was
  written for (it shipped with no `position: fixed` backdrop at all), and this step is the
  only thing that can see it. It goes back to the Queue tab first, and now **throws** rather
  than reporting a backdrop reading taken from a screen that never opened.
- **The password modal was left open over everything after it.** The Staff assertions still
  read the right cells — `.click()` ignores what is on top — but every screenshot showed a
  dialog over the screen under test, and a human clicking there could not have reached it.
  The pictures are what find half of these, so a step that leaves a modal up disables the
  next one. Same trap already recorded for the dashboard's footer button.
- `confirm()` **blocks the renderer**, so `Runtime.evaluate` never returns while it is open:
  the click must not be awaited and the text is read from `Page.javascriptDialogOpening`.
  Cost one hung driver to learn.

###### …and `verify-offboard` was the FIFTH suite to assume an empty database
It asserted `before === 0` and then exact queue depths. A genuinely escalated tier-2 ticket
from two days earlier — the very row the queue-reach alarm exists to report, i.e. intended
data — failed **four** checks at once and read as the release putting the wrong things in the
queue. The queue is desk-wide by design, exactly like `firstResponseStats` and the automation
passes, so "empty" was never what was meant. Depths are measured from a printed baseline now,
and the ordering check ranks **our three fixtures among themselves** rather than demanding
first place on the whole board — which would be asserting an empty database in a second
costume.

#### Nothing read the clocks (`ticketAutomations.ts` + `ticketSla.ts`, 2026-08-18)
Every clock these passes read already lived on `Conversation` — `queuedAt`,
`assignedAt`, `firstAgentReplyAt`, `lastMessageAt` — and **nothing read any of them on a
schedule**. The desk coloured a row red after an hour and that was the whole of it:
computed at render time, so it existed only while somebody had the tab open, and the one
state it could never describe is the one that matters — a ticket nobody is looking at.

`npm run ticket-automations --workspace @ghl-theme-builder/server` (`-- --dry-run`),
five passes in this order: unsnooze → nudge unclaimed → the response target → nudge the
holder → sweep idle.

- **A SCRIPT ON A SCHEDULE, never a `setInterval`** — the free instance sleeps after ~15
  minutes so an in-process timer stops, and a second instance would run every pass twice.
  Same hosting reasoning as `poll-feeds`, and the same shape of workflow: GitHub Actions,
  **one secret** (`DATABASE_URL`), **exit 0 with a notice** when it is absent, because a
  scheduled job that fails every ten minutes until somebody configures it teaches people to
  ignore this repo's CI. A pass that *throws* does fail the job — absent and broken are
  different answers.
- **Each pass CLAIMS its right to act** with a conditional `updateMany`, the `claimNext`
  idiom: the loser matches zero rows. The timestamp is the claim, not a log written
  afterwards — claim-then-send can lose a notification, send-then-claim duplicates one, and
  duplicates land in a real person's inbox. Email is documented as convenience rather than
  mechanism, so losing one is plainly the better way to fail.
- **TEN MINUTES IS THE RESOLUTION, NOT THE PRECISION.** Actions delays scheduled runs under
  load, so every threshold is worded "at least N minutes" and nothing claims an exact breach
  time. An SLA promising a precision the scheduler cannot deliver is worse than one that
  admits its granularity.

##### The response target is counted in the agency's OPEN hours
Against the wall clock a ticket raised at 9pm on a 4-hour target breaches at 1am, escalates
a tier, breaches again, and arrives at **tier 3 by morning without one human having had the
chance to answer it** — so the desk opens every day to a backlog manufactured entirely by
the clock, and learns to ignore the alerts. Counted in open hours it breaches mid-morning,
once, with somebody there to act. `businessHours` already existed for the client's ETA;
this is the second thing it buys.
- **Unknown hours fall back to wall clock, never to "the target never elapses."** An SLA
  nobody is watching is the thing this exists to prevent, so unreadable hours must mean
  "measure it crudely", which is the same direction as `removedReason` refusing to
  resurrect what it cannot explain.
- **FIRST response only.** The pass only ever looks at `firstAgentReplyAt: null`, so the
  clock stops the instant a human replies and can never punish us for a client who took the
  weekend to come back. A next-response SLA is derivable (the newest message's role) but it
  is not the same measurement, and conflating them produces an automation that chases the
  desk over somebody else's silence.
- **A raise UNASSIGNS**, exactly as a manual escalation does, and keeps the ticket's
  existing `queuedAt` through `enterQueuePatch` — a client who has waited 47 minutes must
  not go to the back of the line because of something we did. When a held ticket is *also*
  overdue the raise wins: re-queuing it beats nudging the one person who has already been
  shown not to be answering.
- **At tier 3 it does not silently stall.** The route refuses to escalate past `MAX_TIER`
  and names handing the ticket to the agency; an automation that quietly gave up here would
  leave the single most overdue ticket in the system as the one nothing further happens to.
- Targets are per priority and spread wide on purpose (15 / 60 / 240 / 480 minutes): with
  `urgent` and `normal` close together, priority stops changing anything and the field is
  decoration. A stored policy falls back **per key**, so an agency who set only `urgent`
  keeps a working policy for the rest.
- **And the column was un-settable until the field was built.** `slaFirstResponseMins` was
  read by the automations, returned by the GET and validated by the PUT — and had **zero
  references in the dashboard**, so no agency could ever change it and every install ran on
  the code defaults forever. The same shape as `faviconUrl` and the agency-level
  `brandName`: correct from both ends, dead in the middle, and indistinguishable from
  finished without a live test. Found by grepping the dashboard for the column, which is
  what `audit-fields.js` exists to automate for the theming half — **`SupportConfig` has no
  equivalent UI-side audit**, and this is the second time that gap has cost something.
  - **Not a data-losing bug, and that distinction was measured rather than reasoned.** The
    PUT does clear any field it is not sent, so the obvious conclusion is that every save
    wiped the policy — but the editor round-trips the object the GET handed it, which
    already carried the field, so it survived. The checks assert both halves: the round trip
    keeps it, and a payload that omits it resets to the defaults.

###### …and once the field existed, it stored a number nobody typed
Found 2026-08-20, by a sweep for the two form traps this file already records — an
uncontrolled input, and a value read straight through `Number()`. The box clamped on every
**keystroke**: `Math.max(5, Math.round(Number(e.target.value)))` inside `onChange`.
Measured in a browser, one keypress at a time:

```
type "240" into Normal   2 -> 5      4 -> 54     0 -> 540
type  "30" into Urgent   3 -> 5      0 -> 50
clear the box entirely              -> 5
```

Any first digit below 5 is rewritten to a 5 and the remaining digits appended to it. The
realistic targets all start below 5 — 15, 30, 45, 120, 240, 480 — so the field stored the
wrong number nearly every time an agency set one, **and the wrong number is on screen
afterwards**, which nobody re-reads.

- **This is the column the automations enforce.** 240 becoming **540** leaves a client
  waiting nine hours before anything chases their ticket while the agency believes four; a
  cleared box becoming **5** breaches every ticket at that priority almost immediately,
  raises a tier and unassigns it — the backlog-manufactured-entirely-by-the-clock failure
  the open-hours rule exists to prevent, arriving through the form instead.
- **The clamp carried its own reason**, and the reason is real: *"below the server's floor
  the save is refused outright, which would lose the rest of the form's edits to a stray
  keystroke in a number box."* Right about the problem, wrong about the fix — the same
  shape as `navigator.clipboard` and *"silently rejects"*, and as `renamedLabels` and
  *"only the renamed ones"*. **A guard that runs while somebody is still typing is not
  validating their input, it is competing with it.**
- Answered on **BLUR**, exactly like the desk's `maxConcurrent`: the box holds text while
  it is being typed, a blank or out-of-range value is REFUSED rather than rewritten, the
  refusal is said **beside its own row** (four rows in a scrolling body — a message in the
  modal's top banner is a message nobody reads), and the box goes back to what is actually
  **stored**, because a refused value left on screen looking accepted is the other half of
  that same bug.
- Verified live: **25 checks** (`scratchpad/verify-sla-input.mjs`), driving a real browser
  and asserting the **server**, not the input — the Plan-cell lesson, which already cost one
  driver a false pass. Confirmed to fail **16** under a mutation restoring the per-keystroke
  clamp.
  - Two of its own checks exist because the first draft passed for the wrong reason: it
    typed **240** into a target that already held 240, so the save assertion was green
    whether or not the form changed anything. The suite now asserts up front that each value
    **differs from what is stored** and **starts with a digit the old clamp would have
    rewritten**, so neither trap can come back quietly.
  - **And its cleanup turned the agency's master switch off**, which is worth recording
    rather than quietly fixing. The GET answers an **envelope** — `{config, locationsEnabled,
    locationsTotal}` — while the PUT takes the bare config; `api.ts` declares both correctly
    and the harness read neither, so it snapshotted the envelope and PUT it back. The route,
    being whole-object, saw no `enabled` and no `escalationEmails` and **deleted them**. That
    is the `planTiers` trap this file already documents, catching the person writing the
    harness for it, one screen over. Restored by hand and asserted back byte for byte.

##### The idle sweep warns before it closes, and the warning must be VISIBLE
Silently marking somebody's conversation dead is how a client discovers days later that
nobody was coming. So: warn at 3 days, close 2 days after the WARNING (not after the last
message), and a client who replies in between cancels the close — which is the outcome the
warning exists for.
- **The warning is written as `bot`, the closing note as `system`,** and that split is the
  whole of it. `CLIENT_VISIBLE_ROLES` filters `system` off the client's screen, so a warning
  written as `system` is a warning nobody was warned by — visible in our transcript, invisible
  to the only person it addresses. The live check asserts it through the widget's **own
  poller**, not by reading the role back.
- **It must never touch an ESCALATED ticket.** Those are waiting on US; sweeping them would
  delete our own backlog while every screen reported a healthy queue — the same failure as a
  ticket stranded on a disabled account.
- Closing **clears `botPaused`**, or a client returning weeks later to a thread some
  long-departed agent paused gets silence from the assistant and nothing saying why.

##### Snooze, bot-pause, and desk-raised tickets
- **`snoozedUntil` is a column, not a `status` value.** "In progress" is `assignedToId`
  being set and "waiting for the customer" is the newest message's role; encoding all three
  as statuses is how a status column stops being answerable. A snooze into the **past** is
  refused — almost always a timezone slip, and storing it makes the ticket reappear instantly,
  which reads as the snooze being broken. Unsnoozing preserves the original `queuedAt`.
- **`botPaused` stops the assistant answering over a human.** The widget's message route
  called `answerQuestion` unconditionally, so an agent could claim a ticket, reply, and have
  the bot answer the client's very next message on top of them — contradicting them, or
  re-offering a hand-off for a conversation somebody was already handling. Set when an agent
  claims or replies (not left to a button, because forgetting is silent), cleared on resolve.
  The client is told a person has it rather than met with silence.
- **A desk-raised ticket has `accessTokenHash: NULL` and is unreachable BY CONSTRUCTION.**
  `requireConversation` looks up by the hash of the header, which can never be NULL, so no
  token matches and the refusal is **byte-identical** to the one a conversation that does not
  exist gets — which is also what stops it being an oracle for real ticket ids. Minting a
  token nobody is handed would be a live credential we cannot reason about.
- **The opening message is deliberately NOT gated.** It is stored `role=user`: the agent is
  transcribing what the CLIENT said, and the gates are for text travelling *to* a client.
  Gating it would refuse an agent for accurately writing down that their client said
  "GoHighLevel" — the most likely thing a confused client says, and exactly what the desk
  needs to see. Their own reply is gated by the reply route, on the same ticket.
- Still no separate `Ticket` model. A conversation already IS one, and this is that comment
  implemented literally: a ticket raised without ever using the bot is a Conversation whose
  first `Message` has `role=user`.

##### The desk had its OWN idea of late, and it disagreed in both directions
Adding a real response target immediately made a third definition visible. The inbox
reddened a row after 60 minutes and again at 240; the queue board did the same; the
automations used the agency's configured target, per priority, counted in their open
hours. Three definitions of one fact, and the two an agent actually looks at were the
wrong ones:

- an **`urgent`** ticket on a 15-minute target sat **green on both screens for 59
  minutes**, while the automation had already breached it, raised a tier and unassigned
  it. The agent's own list said the ticket was fine while the system was escalating it.
- **overnight, the reverse**: every row went red by 4am, while the target — correctly —
  had not moved, because none of those minutes were open hours. A colour that is red
  every morning is one people stop seeing, which is the exact failure the open-hours
  rule exists to prevent, arriving through the UI instead.
- worst of the three, the inbox measured from **`lastMessageAt`**, so a client sending
  *"hello? anyone there?"* **reset their own row to green**. The person who had waited
  longest and was chasing us looked like the freshest thing on the page. `deskQueue.ts`
  already refuses to ORDER the queue that way and says why; the colour did it anyway.

`services/slaStatus.ts` is now the single resolver, read by the inbox, the queue board
**and** the automation — which was rewritten to call it rather than keep its own copy of
the same arithmetic. This is the `QUEUE_ORDER` rule applied to lateness: two definitions
drift, and nobody can see both screens at once to notice.

- **It must be computed on the SERVER.** The target lives on the agency's `SupportConfig`
  and the clock runs in their business hours; a browser knows neither. The row carries
  `inOpenHours` so the UI can say *which* clock it is counting — the same number means
  two different things, and a column that does not say which is showing both at once.
- **`null` is a real answer, not zero.** No clock runs on a conversation that was never
  escalated, or that a human has already answered. Painting "0 of 240" on a ticket nobody
  owes a reply to is worse than saying nothing, so those rows are left UNCOLOURED.
- **One config read per AGENCY, never per ticket** — the desk inbox is cross-agency by
  design, so a 100-row page would otherwise be 100 queries for a colour.
- The queue board keeps its wall-clock `waitingSeconds`, because *"how long has that person
  actually been sitting there"* is a fair question with a factual answer. What changed is
  that whether it is **late** is no longer decided by that number.
- **The queue's select had to learn `firstAgentReplyAt`.** Everything in that list is
  unassigned, which is NOT the same as unanswered: a ticket answered once and later
  re-queued has no first-response clock running, and hardcoding `null` there would have
  shown a live target on a ticket that had already met it.
- **`slaTone.ts` keeps the client-side rule in ONE place too**, shared by both lists —
  extracted for the same reason as `bulkEnableLogic.ts`: it is a judgement an agent acts
  on, and inline in a component it can only be checked by clicking. It invents no
  threshold of its own; it only chooses a class from what the server decided. It warns at
  **three quarters** of the target, so there is time to act before the client is owed an
  apology.
- Verified live: the suite grew to **69 checks**, and confirmed to fail **6** under two
  deliberate mutations — the server ignoring the agency's hours, and the desk colouring
  from a fixed threshold again.
  - **Asserting the server payload proves nothing about the screen**, which is the
    `verify-delivery` lesson exactly: that suite was 23/23 green while the widget never
    called the endpoint under test. So the desk's rule is **executed** here, not read, and
    a separate source check pins that neither list has re-grown a hardcoded threshold or
    gone back to measuring from `lastMessageAt`. Worth knowing which check does what: the
    source check did NOT catch the fixed-threshold mutation, because that lived in
    `slaTone.ts` — the executable checks caught it. Neither would have been enough alone.
  - One assertion was wrong first and is recorded because the shape recurs: it demanded
    "open minutes" from a live row belonging to an agency with no hours set, where
    "minutes" is correct. The fix asserts both wordings from synthetic input instead of
    guessing which one the database was in.

##### Readiness sees it, because nothing in the request path can
The scheduler lives outside this deployment entirely, so `automations-never-run` is
**self-validating rather than a configuration read**: a conversation waiting over 24h whose
`slaBreachedAt` is still null could not exist if a pass had run. The grace window is a full
day against a ten-minute cadence, because a blocker that fires when Actions is twenty
minutes late is one people learn to ignore, at which point it is worse than absent.

- Verified live: **69 checks** (`scratchpad/verify-tickets.ts`), and confirmed to fail
  **4** under three deliberate mutations — the SLA ignoring the agency's hours, the idle
  warning written as `system`, and the dry-run guard removed from the SLA pass. Each was
  caught by the check written for it, and the `system` mutation was caught *independently*
  by the widget-poller check, which is the one that does not simply re-read the role.
- **A harness bug worth recording, because it read exactly like a product bug.** The
  assignee-nudge section inherited the 5-minute target set two sections earlier, so the SLA
  pass took the ticket first and un-assigned it — and the reminder never fired. That is
  correct precedence, not a defect. It is now asserted as its own check rather than worked
  around, and the section widens the target so the reminder is the only thing that can act.
- **The passes are GLOBAL and the suite says so out loud.** There is no scoping option and
  there should not be one, so any live conversation already on the database is swept too. A
  hard failure there would report a dirty dev database as a product defect; silence would let
  the suite act on somebody's rows without saying so. It prints the ids instead.

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
  (Since 2026-08-25 it is `EXTERNAL_VISIBLE_ROLES` in `services/transcriptVisibility.ts`,
  because it turned out to have a SECOND door to guard — see the hand-off email below.)
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

##### …and the reload it promised DESTROYED the thread, every time (found 2026-08-22)
Found by rendering a whole conversation in the real widget — not a stub, not HTTP. Both
existing checks were green and neither could see it: `verify-delivery` drives `/updates`
itself (the blind spot that suite is already named for), and `verify-widget-poll` runs the
snippet against a **DOM stub**, so it can prove a request was made and nothing about what
anybody sees.

Measured: the thread was in `sessionStorage` before the reload and **gone afterwards**, with
the panel showing a fresh greeting.

- **`restoreThread()` runs at boot; `buildPanel()` ran only inside `toggle()`** — the first
  time the client clicks the bubble. So `state.els.body` was undefined, `addMessage` threw a
  TypeError, and the throw landed in a `.catch` written for a network failure, which
  **cleared the conversation id and the bearer token**. The comment on it read *"could not
  restore - fall back to a fresh conversation rather than a dead one"*: the fourth-and-fifth
  instance of reasoning written down and walked into.
- **This is the write-only failure the whole mechanism exists to prevent**, arriving through
  the door built to close it. The client reloads, their conversation is discarded, they see a
  fresh greeting; the agent goes on replying into the old one; `firstAgentReplyAt` records a
  response nobody received. A CRM page reload is not an edge case.
- Fixed with `ensurePanel()` — build it hidden at boot, so a restore has somewhere to draw.
- **And then the catch had to learn the crawler's lesson.** Keeping the thread on EVERY
  failure is the same mistake pointing the other way, and I introduced it: a 401/404 means
  the conversation genuinely is not ours, so holding the id makes `ensureConversation()`
  skip creation and every later message is posted to something that does not exist —
  measured, the client got *"Sorry, something went wrong on my end"* for the rest of the
  session with no way out but closing the tab. **GONE and UNREACHABLE are different
  answers**: only 401/403/404/410 retires a thread; anything else keeps it and retries when
  the panel is next opened. `api()` now carries the status on the error, because an Error
  whose only content is a sentence forces every caller to guess.
  - The unreachable case is ordinary, not exceptional: every `/support/api` route shares
    **60 req/min per IP** — several of a client's colleagues sit behind one office NAT — and
    a sleeping free instance takes ~50s to wake.
- **The panel is cleared only once there is a transcript to put in its place.** Clearing
  before the fetch wipes the greeting and then, on a conversation that turns out to be gone,
  leaves the client looking at an empty panel with nothing to explain it. Node by node
  rather than `innerHTML`, because the unit test forbids a second `innerHTML` in that file
  on purpose and a blunt guard is worth more than a clever one.
- Verified live: **30 checks** (`scratchpad/verify-widget-live.ts`), which loads the REAL
  pasted snippet, holds a whole conversation, has an agent reply through the desk routes,
  and asserts the client's window catches up **on its own poller**. Confirmed to fail 2
  under a mutation restoring the blanket clear.
  - **An agent's reply is asserted to be pixel-identical to the assistant's** — same class,
    background, border, radius and colour. `addMessage` says why in words; nothing had ever
    looked. Also: the internal note is absent, no Mosaic staff name appears, zero vendor
    names, zero links.
  - **A first negative control PASSED, and that was the useful part.** Dropping
    `ensurePanel()` did not fail the suite, because the retry-on-open path silently covered
    for it — so the checks were passing on the recovery rather than on the fix. The property
    the recovery cannot supply is that **the poller keeps running while the panel is
    closed**, which is the ordinary case after a reload. Asserted now by counting `/updates`
    responses on the wire: with the fix, `replay=1` is followed by `after=<cursor>`; without
    it, the replay is the only request that ever happens.
  - Its own first draft had a check passing for the wrong reason too: *"the assistant
    answers"* matched any bot-styled bubble, and the greeting is one — so it went green on a
    run where the conversation POST had been rate-limited and the panel read *"Sorry,
    something went wrong on my end"*. It asserts the exact sentence `FRUSTRATION_RE`
    guarantees, and a missing conversation now **throws with the reason** (the shared 60/min
    bucket) rather than being asserted against.

###### A missing field is not an instruction to switch the widget off
Found in the same session, by a harness sending the wrong key. `PUT
/admin/api/:agency/locations/:loc/support` read `!!req.body?.supportEnabled`, so **any body
without that key turned the widget off** — a typo, an older client, a request that meant
something else. It is the `Number("")` trap in a boolean costume, on the switch that decides
whether the widget appears in front of the agency's own customers, and the route cheerfully
reported success. It refuses a non-boolean now, which is the same answer `maxConcurrent` and
`slaFirstResponseMins` already got.

##### …and it was STILL write-only if the desk spoke first (found 2026-08-17, by the user)
Reported as *"I sent messages from the portal but it didn't come through in the widget."*
Everything above is real and `verify-delivery` was 23/23 green — because it drives
`/updates` over HTTP itself. **Nothing ever asked whether the widget CALLS it.**

`watchUpdates` was started from exactly one place: `addQueueWatcher`, which runs only when
the **client** escalates. But the desk inbox filters by status and `inboxCounts` surfaces
`open` as its own tab, so an agent can open a chat nobody escalated and reply to it. That
reply passed all three gates, was stored, set `firstAgentReplyAt` and counted toward the
response time the agency is shown — and the widget never polled. Same failure as the
original, through the one door nobody had walked: **the desk starting the conversation
instead of the client asking for a person.** Worse, too, because the metric records that we
answered.

- **The poller now runs for the whole life of the conversation**, started from
  `ensureConversation` — from the client's first message, not from a hand-off. `restoreThread`
  likewise restarts it whatever the status; gating that on `waiting || escalated` was the
  same bug one layer down.
- **ONE poller, guarded by `state.polling`.** There are now three callers, and two pollers
  would double every waiting client's share of a 60/min budget shared with SENDING.
  `boot()` calls `stopPolling()` when the sub-account changes, or the flag stays true, the
  new conversation can never start one, and the widget is write-only again — in the one
  navigation a CRM user does constantly.
- **A HIDDEN TAB MAKES NO REQUESTS.** This is what makes "poll from the start" affordable:
  polling every open-but-unwatched CRM tab is the cost that would otherwise pay for it, and
  nobody is reading a reply they cannot see. Returning to the tab polls **immediately**,
  which is also the moment a waiting client most wants an answer.
- **The interval widens 15s → 60s and RESETS on activity** (`quicken`). And the first
  version of `quicken` **scheduled at `POLL_MIN`**, which pushed an already-due 2s first
  poll out to 15s — it delayed the very check it exists to hurry. Caught by the harness,
  not by review; it now schedules a short `POLL_NUDGE`.
- Verified: **16 checks** (`scratchpad/verify-widget-poll.js`), which runs the ACTUAL pasted
  snippet in a DOM stub against a **virtual clock** — real timers would make it a 90-second
  test whose failures read as flake. Confirmed to score **10/16 on the pre-fix code**, the
  headline failure being *"zero /updates requests — an agent replying from the desk would
  never reach this client"*.
  - Two of its own assertions were wrong first: it counted `created.map(textOf)` across
    every element, so one message read as **5 copies** (parents and children both contain
    the text), and it asserted before clicking the bubble, when the panel does not exist yet.

##### "How long until someone answers?" — the honest version
`estimateWaitSeconds` returns null below 5 measured responses or with nobody on the desk,
and that rule is right. It also left the **most common** case saying nothing: a client who
escalated at 9pm saw *"You're number 1 in line"* and no way to tell whether that meant two
minutes or Monday. Silence there is not caution — they sit and refresh.

`services/businessHours.ts` turns a fact the agency has **already given us** into one true
sentence, and never a duration:
- a measured estimate exists → **stay quiet**, rather than stacking two claims about one wait;
- nobody on the desk + hours known → *"The team is back at 9am tomorrow."*;
- nobody on the desk + **no** hours → **null**. We genuinely do not know, and "someone will
  be right with you" is the promise people remember and quote back;
- somebody IS on the desk → *"Someone from the team is here"* — a fact about the present,
  not a prediction. A real agent working late **outranks** the posted hours.
- **Read through `Intl`, never a UTC offset** — an offset is wrong twice a year, and this is
  exactly the code that would then say the desk opens an hour later than it does. An
  unusable timezone means UNKNOWN, never closed.
- 11 unit tests (`businessHours.test.ts`), including the same instant being a working
  Monday in New York and the middle of the night in Tokyo.

##### Reply templates existed, and there were zero of them and no way to make one
`CannedReply` is fully built — stored placeholdered, rendered per conversation, gated on
create with an empty link allowlist, scoped so one agency's reply 403s on another's ticket.
`createCannedReply` was in the desk's `api.ts` with **zero callers anywhere**, and
`Ticket.tsx` renders the row only `if (canned.length > 0)`. So the count was 0, the row
never rendered, and the feature was invisible from every screen — the same shape as the
write-only review queue: a correct mechanism with nothing feeding it.

- **`npm run seed-canned-replies`** — 8 starter templates, shared (`agencyInstallId` NULL),
  idempotent by title. They run the **same gate the route runs**, because seeding through a
  side door would put the one text an agent reuses most beyond the guarantee covering
  everything they type by hand.
- **"Save as template" in the compose box**, which is the moment an agent has just written a
  good reply. It **swaps the client's brand name back to `{{PLATFORM}}` before saving**,
  longest-first — a template saying "the Harbour Suite team" would say Harbour Suite inside
  every other client's chat, and a template is the one text nobody rereads. The server
  re-runs the gate and refuses anything that still names a brand.
- Templates are deliberately **short**. One long enough to feel finished is one an agent
  sends without editing, and a reply that reads as boilerplate is worse than a slower human.

##### The widget had NEVER been rendered, and the local harness was a stale copy
Found 2026-08-19. The one surface that appears in front of the agency's own customers had
never been looked at in a browser, and there was a reason: **the real paste cannot work
locally.** `env.ts` requires `APP_PUBLIC_URL` to be https even on a laptop (so
`isProductionUrl()` can treat a localhost host as dev), while `npm run dev:server` serves
plain http — so the snippet is built pointing at `https://localhost:3210`, which nothing is
listening to. Rendered as-is the widget builds nothing and looks broken.

Everything that *did* exercise it sidestepped this: the DOM-stub suites stub `fetch`, so the
origin never mattered to them, and `scratchpad/harness/location/<id>/index.html` **inlined
639 lines of hand-pasted javascript** under the comment *"THIS is what the agency pastes"*.
That claim had rotted. Measured against the shipped snippet, the committed harness was
missing:
- the **single-poller guard** (`state.polling`),
- the **`POLL_NUDGE`** fix to `quicken`,
- and the server-built wait sentence.

The first two are documented fixes, so anyone opening that page to "see the widget" was
looking at behaviour already corrected, and any conclusion about polling drawn from it was
wrong. Same drift as the onboarding snippet, same answer: **one source**.

- **`scratchpad/shoot-widget.mjs`** renders the REAL thing — fetches `jsSnippet` from the
  embed endpoint in Node (no CORS), rewrites **only the scheme** (asserted: the rewrite must
  change exactly the byte count of the scheme, or it refuses to render something that is not
  the real paste), serves the page itself over http, and drives it. Verified: shadow host
  present, bubble in the brand colour, header *"Harbour Suite Support"*, the greeting, the
  composer reachable, **zero vendor names and zero links** in the shadow DOM.
- **The harness's copy is gone**, replaced by a 44-line loader that fetches the snippet and,
  when it cannot, says so on screen and names the tool that can. It usually cannot — the
  admin API allows only the dashboard's origin, correctly — and that visible refusal is the
  point: the page shows the stylesheet, which is what it is for, instead of a duplicate that
  quietly disagrees with what ships.
- **Served over http, never `file://`.** The widget reads `window.location` for its
  sub-account, and a `file://` page has no path of that shape — so it takes the "no
  sub-account" branch and renders nothing, which is indistinguishable from being broken.
- The consequence worth keeping in mind: because the real snippet cannot run locally, a
  defect in the GENERATED javascript would first appear in production. That is what makes
  rendering it worth doing deliberately.

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

##### Three formatters for one number, and the desk claimed to be quoting the client
`formatWait` turns seconds into words and had **zero callers**. It was not merely tidy-up:
the widget did its own `Math.round(s / 60) + " min"` inline, and `QueueBoard` its own
compact `2h 15m`, so one estimate produced three answers. What makes it a defect rather
than duplication is the desk payload's own comment — *"what a client at the back of the
queue would be told right now, so the promise the widget is making is never a surprise to
the desk"*. It was **re-deriving** that promise with a different formatter:

- at 4,000 seconds the desk read **`1h 7m`** while the client was told **"about 67 min"**;
- under a minute the desk showed **`45s`**, a precision the client never sees, against
  "Usually under a minute";
- and the client's own version had no hours branch at all, so a long queue said *"Usually
  about 243 min"* — a number the reader has to convert, on the screen of somebody who is
  already waiting.

Same shape as three definitions of lateness, and the same fix: `waitSentence()` builds the
whole sentence **server-side**, like `connectHint` beside it, and both surfaces render that
string. The desk **quotes** it rather than paraphrasing.
- **Null in, null out.** `estimateWaitSeconds` returns null below five measured responses
  or with nobody on the desk; formatting a null would invent the exact promise that rule
  exists to withhold.
- **The sentence, not the fragment.** "Usually about under a minute" is why the branch
  lives in one function instead of being concatenated at each call site.
- Verified live: `verify-routing` grew 4 checks (**53/53**) — the desk carries a sentence,
  the client's matches its shape, no compact desk format can reach a client, and an
  unqueued conversation is promised nothing. Confirmed to fail **3** under one mutation
  (`waitSentence` emitting the compact format).
- **And asserting the payload proves nothing about the screen**, so `verify-widget-poll`
  grew 2 more (**18/18**) that read the rendered queue line out of the executed snippet.
  Confirmed to fail both when the widget goes back to its own arithmetic.
  - Getting there exposed a check **passing for the wrong reason**: *"the queue position
    still renders"* was written `... || convStatus === "escalated"`, which is true here by
    construction, and it passed on a run where zero polls had fired and the row was blank.
    The row is written by a poll and the interval has widened to its 60s ceiling by then,
    so 20 virtual seconds buys no request. Advancing the clock costs nothing and makes it
    an assertion about the screen again.

##### A suite that assumes an empty database reports a human's own data as a bug
`verify-routing`'s percentile section asserted `count === 0` and then exact medians.
`firstResponseStats` is **desk-wide on purpose** — the desk is Mosaic's own and answers
every agency — so any settled conversation counts. Two chats somebody had made by hand
while trying the widget two days earlier failed **four** checks at once, and the failure
read as a broken percentile query.

The same trap `verify-tickets` records for the automation passes: the thing under test is
global, so the suite must measure **relative to what is already there** and say out loud
what that was. Every assertion is now about the delta — sample count moves by exactly the
fixtures added, and *"MEDIAN, not mean"* is stated as **the outlier barely moves it**
rather than as a hardcoded 120. That is what was meant, and it is true on any database.

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

#### …and the term it named was one the agency had never written
Found 2026-08-20, by rendering "Your content" with articles in it. `shoot-dashboard.mjs`
draws that tab with a comment saying which state it is drawing — *"the state EVERY install
starts in: no articles of their own"* — and that is the only state anybody had ever looked
at. Measured first: the dev agency held **0 articles and 0 feeds**, so the list, both
warning branches, the Publish button and the whole feed panel were markup nothing had
drawn. `audit-styles.js` was green (every class is defined) and `verify-kb-authoring` was
green (30 checks, all driven over HTTP) — neither can see what a row *says*.

An article containing **`GoHighLeveI`** (capital i for the l) came back reading:

> Mentions **“gohighievei”**, **“highievei”** — remove it to make this usable.

- **Neither string occurs in their article.** The defanged scan folds homoglyphs to
  canonicalise them — `l`, `1`, `|` and `!` all become `i` — and it reported **its own
  folded token** as the thing to delete. So the one screen whose job is to say what to fix
  told them to search for a word that is not there. **A remedy the reader cannot carry out
  is worse than no remedy**, which is the `fix`-field rule readiness already follows.
- **The reasoning was written down and a caller walked into it** — the fourth time this
  file records that exact shape, after `navigator.clipboard` and *"blocked (silently
  rejects)"*, `renamedLabels` and *"only the renamed ones"*, and BulkBrand's *"never lose a
  long pasted list to a stray Escape"*. `findBrandLeaks` said so directly:

  ```
  Note the defanged pass reports an index into the FOLDED string, not the original.
  That is fine for its purpose: a hit means quarantine the article or regenerate the
  answer, never "patch this one span".
  ```

  True of the GATE, which only needs yes/no. False of the other consumer, which shows these
  to a person as the words to delete — and nothing had asked the function which one it was
  answering.
- **Fixed in the lexicon, not at the call site**, because there are five consumers (both
  dashboard routes, the shared-queue CLI, and two logs) and every one of them wants the
  source text. `defangWithMap` folds exactly as `defang` does and carries each folded
  character back to the span that produced it; **`defang` is now implemented on top of it**
  rather than beside it, since two functions applying "the same" rules is how the fold and
  its map drift apart — and that drift would be silent, still finding the term and then
  quoting the wrong words back.
  - **Detection had to come out byte-identical, and that was measured rather than argued**:
    5,964 comparisons against the original implementation over **1,481 real articles** plus
    every adversarial form, **0 differences**. The folding is the fail-safe; a fix that
    quietly narrowed it would be far worse than the bug.
  - Three folds are not one-to-one — invisible characters and stripped separators vanish,
    and `|-|` → `h` collapses three characters into one — so a span, not an index. A naive
    one-character span would quote `|` alone.
- **One occurrence is one thing to fix.** `GoHighLeveI` trips both `defanged-gohighlevel`
  and `defanged-highlevel`, so the message listed two terms for one mistake — and deleting
  the first silently removes the second. `leakTerms()` drops spans contained in another
  span and is now the single definition of *what to show a person*, replacing three
  hand-written copies of the same mapping that had already accumulated. It only works
  because both scans now index into the same original text: under the pre-fix code the two
  folded coordinate spaces are not comparable, which the mutation run demonstrates.
  - `findBrandLeaks` still reports **every** hit. Two rules firing is diagnostic, and the
    gate wants all of it — the narrowing belongs at the surface that renders it, exactly as
    `featureLabels` stays complete while `renamedLabels` is the filtered twin.
  - Rows quarantined before this keep their folded token; nothing can recover the original
    for them, and re-saving the article repairs the row. Stated in the code rather than
    papered over.

##### A feed we had given up on said the agency had paused it
Same render. `feedPoll` disables a feed after ten consecutive failures — `enabled: false`
on top of the error — and the row showed a **“paused”** badge beside a **“Resume”** button,
which is byte for byte what a feed the agency parked deliberately looks like. So the screen
claimed an action they never took and omitted the only fact that matters: **nothing will
happen until somebody clicks.** The remedies genuinely differ — a pause ends when they say
so; an abandoned feed never polls again — which is the `availability`-vs-`status` split
arriving in a third place.

- **`gaveUp` is derived on the SERVER**, from `MAX_CONSECUTIVE_ERRORS` where the poller
  enforces it. A copy of `10` in a React component is the `QUEUE_ORDER` failure in
  miniature: two definitions, drifting, with nobody able to see both at once.
- The badge reads **“stopped”**, the warning says *"so we've stopped checking it"*, and the
  button says **“Try again”** — which is what it does, since re-enabling clears the error
  and the counter so the feed gets its full allowance back rather than one poll before it
  re-disables.
- **And the optimistic toggle only moved `enabled`,** so after clicking, the row still read
  *"Failed 10 times in a row"* over a feed that was running again — reporting a fault we had
  just forgiven. It mirrors the whole server-side change now.
- Verified live: **30 checks** (`scratchpad/verify-kb-states.ts`), which plants all four
  states — usable, quarantined, held-from-a-feed, and abandoned — renders them in a real
  browser and reads what each row says. Confirmed to fail **2** under a mutation restoring
  the folded token (reproducing `Mentions “gohighievei”, “highievei”` exactly) and **6**
  under one restoring the paused/Resume wording. The unit file that did not exist until now
  (`brandLexicon.test.ts`, **12 checks**) fails **5** on the same first mutation.
- **The button's absence is asserted against the ROUTE as well as the row.** "The UI hides
  it" and "the action is impossible" are different claims, and only one survives a second
  caller — so the suite also asks the approve endpoint directly and requires its 422.
- **A teardown that only runs on the happy path is missing exactly when it is needed**, and
  this suite proved it on itself. Two interrupted runs left their fixtures behind; the next
  run matched a **stale row by its human-readable title**, clicked the retry on somebody
  else's feed, and reported the product broken when the product was fine. That is the
  assumes-an-empty-database trap for the **sixth** time, arriving through a harness's own
  leftovers rather than a real user's data. Fixtures now carry a per-run stamp and the
  cleanup is armed on `SIGINT`/`SIGTERM`/`SIGHUP` as well as in `finally`.

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
- **"What needed a person" (`handoffTypes`) is the complement, and it exists because of
  that limitation** (added 2026-08-18). `ticketType` was captured on the desk and
  filterable in the inbox, and **nothing aggregated it** — so the one field that can say
  what clients contact us ABOUT fed no report. The questions that beat the bot are exactly
  the ones where retrieval found nothing, so they cite no article and are **invisible to
  `topTopics`**: the blind spot documented on that function is precisely what this sees.
  It is also the agency's most actionable number, because those are the conversations that
  cost a human.
  - **Counted over conversations that reached the human queue (`queuedAt` set), never by
    `status === "escalated"`.** Status is where a conversation is NOW, so counting it would
    drop every ticket the desk has since resolved — exactly the work that got done. The
    question is what needed a person in this window, not what still does.
  - **`untyped` is reported, not hidden.** Types are set by hand, so a breakdown of only
    the categorised ones would quietly describe a subset while looking like the whole —
    the same reasoning as `firstReply.sampleCount`, and the tile says so in words.
  - Costs **no extra query**: it is computed from rows `supportStats` already loads.
  - **AND THE TILE HID ITSELF ON DAY ONE** (found 2026-08-19, by rendering it). The server
    is right in every state — `{total: 2, untyped: 2, types: []}` is a true and useful
    answer — but the dashboard gated the whole tile on `types.length > 0`, so with nothing
    categorised it rendered **nothing at all**: no number, and no hint that categorising
    would produce one. Types are set by hand on the desk, so that is not an edge case, it is
    **the state every install starts in**, and the number this file calls the agency's most
    actionable was invisible until Mosaic's own staff happened to categorise something.
    - It is the same reasoning as reporting `untyped` beside the breakdown rather than
      quietly describing a subset — carried one step further. An empty tile at least asks a
      question; an absent one hides its own reason. It now renders whenever anything reached
      a person and says, in words, that nothing has been categorised yet.
    - **Only rendering found it.** `verify-stats` was 29/29 green on a payload that was
      correct, and `audit-styles` was green because every class exists — neither can see a
      component that decided not to draw. `shoot-dashboard.mjs` gained an Activity step and
      reports the tile's rows, whether an empty container was left behind, and the sentence.
    - Pinned by 2 source checks in `verify-stats` (**31**), with the `slaTone` precedent's
      known limit written down: they prove the CONDITION, not the pixels. Confirmed to fail
      when the `types.length` gate is put back.
  - Verified live: `verify-stats` grew to **29 checks**, and confirmed to fail **4** under
    two mutations (counting by current status; dropping the uncategorised).
  - **Its fixtures live on a THIRD agency.** They have to be conversations that reached a
    person, which necessarily moves totals, settled counts and the deflection rate — and
    agency A's checks are built on deliberately round numbers ("3 of 6 settled = 50%").
    Rewriting those to fit new fixtures would be changing the assertions to match the data,
    which is how a suite stops meaning anything. My first attempt did exactly that and
    broke seven checks; the agency is the fix.
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

#### …and it stripped the citations and sent our staff rota (found 2026-08-25)
Found by asking what tests `email.ts` — nothing did — and then reading the one sentence
directly above, which says what must never leave: *"a Mosaic-internal source URL, so
citations are stripped on the way out."* It had thought about ONE of the two things in that
table and not the other.

`Conversation`/`Message` holds the client's conversation and Mosaic's own workflow in the
same rows. The workflow rows are `system`, and the client's chat window has filtered them
since the day it was built, with the reason written down: *"Internal notes, transfers and
hand-offs live in the SAME Message table as the transcript and carry Mosaic staff names …
One missing filter puts our workflow in a customer's chat."* The tier-3 hand-off email —
the one place a whole transcript is sent to the **AGENCY** — had no filter at all, and
`renderTranscript` labelled those rows **`Note:`**, which reads as something we wrote for
them deliberately.

Measured, by driving the real desk routes and then executing the shipped mailer against a
stub provider. What the agency owner received:

```
--- Conversation so far ---
Client: My contact import keeps failing halfway through the file.
Note: [ticket raised by Ada Lovelace — email]
Mosaic: Sorry for the wait. Splitting the file into batches of 500 rows will get it through.
Note: [escalated to tier 2 by Ada Lovelace]
Note: [transferred from Ada Lovelace to Bo Diaz] client is on the legacy billing plan,
      check before promising anything
Note: [still unanswered] held by Bo Diaz for at least 90 minutes with no reply to the client.
Note: [returned to the queue — Bo Diaz's account was disabled]
```

- **Every line of that is ours, and three of them are not merely internal.** *"held by Bo
  Diaz for at least 90 minutes with no reply to the client"* is our own missed response
  target, reported to the customer it was missed for, in a sentence the automation wrote for
  the desk. *"Bo Diaz's account was disabled"* is why a named person stopped working — sent
  to somebody who does not employ him. And the transfer note is one agent's private aside to
  another about the reader's own commercial arrangement.
- **`tier 2` is Mosaic-internal by design**, and this file already says so: tiers 1–3 are
  ours and *"distinct from `handedToAgencyAt`, which is the hop OUT of our remit entirely."*
  The email announcing that hop was narrating the tiers on the way.
- **There was already a deliberate channel for anything we want this reader to know** — the
  `note` field, rendered under *"Note from our team"*. So the leak is not a gap in what the
  agency is told; it is the transcript being handed over unread beside a curated note that
  does the job properly. That is what makes it a filter rather than a redesign.
- **The definition now lives in `services/transcriptVisibility.ts`** and both doors read it:
  `EXTERNAL_VISIBLE_ROLES` (the old `CLIENT_VISIBLE_ROLES`, renamed because "client" was
  half of its job) plus `visibleOutsideMosaic()`. Two doors out with one filter between them
  is the `QUEUE_ORDER` rule; the decision had already been made once here and only half of
  it shipped.
- **Filtered in the MAILER, not at the call site.** The route hands over
  `conversation.messages` whole and so would the next caller — the same reasoning that keeps
  `searchKb`'s `status = 'ready'` in the SQL rather than in its callers. An **allowlist**, so
  a role added later is invisible to both doors until somebody decides otherwise.
- **A heading with nothing under it is its own defect**, so a transcript with nothing visible
  says so — the dangling `from:` rule from the desk's citation row.
- Verified live: **28 checks** (`scratchpad/verify-handoff-email.ts`) on a throwaway agency
  with throwaway desk accounts. Every `system` row is produced by driving the real routes —
  raise, reply, escalate, transfer, disable — and **every assertion is derived from what
  those routes stored**, because a harness that hard-codes the bodies is a hand-kept copy of
  a contract and drifts the first time somebody rewords a transfer note. Confirmed to fail
  **8** under a mutation restoring the unfiltered render.
  - Two positive controls, both of which exist because the run without them was weaker than
    it looked: the suite refuses to pass unless the desk actually wrote ≥4 internal rows, and
    unless **both** outward roles are present. The first draft sent the reply route `body`
    where it reads `text`, so the agent's message was never stored — and *"the conversation
    still arrives"* went green having checked the client's message alone.
- Plus **16 unit tests** (`email.test.ts`, the file's first), which run in `npm test` where
  the live suite does not. They also pin the OTHER promise this file makes and nothing had
  ever exercised — *"sending must never throw into a caller"* — against a provider 5xx, a
  422, a refused connection, an abort at the 8s timeout, and a response body that errors
  mid-read. Confirmed to fail **3** under the same mutation.

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
- **And every save of the support form DELETED the plan names** (found 2026-08-18). The
  PUT writes `planTiers` unconditionally, defaulting to `{}` — while the GET did not return
  the column **at all**. The editor saves by PUTting back the object the GET handed it, so
  changing the greeting, or one blocked term, or the master switch, wiped every plan an
  agency had recorded. Nothing said so; nothing could put them back, because **no screen
  sets them**; and the only visible symptom is this answer quietly reverting to the generic
  wording, months later, in a client's chat. Reproduced by replaying the old payload shape
  (the GET's object minus the key) against the live route: `{"loc":"Starter"}` → `{}`.
  - Fixed at the GET, which is where the convention already was — *"GET returns a full
    config shape even when no row exists, so the form has one code path."* `planTiers` was
    simply never added to it. Pinned by two checks in `verify-plan.js`, one asserting the
    GET carries it and one editing the greeting and demanding the plans survive.
  - **A whole-object PUT makes every field the GET omits a deletion.** That is the general
    trap, not a detail of this column: `slaFirstResponseMins` sits behind the same PUT and
    is safe *only* because the GET returns it. Anything added to `SupportConfig` must be
    added to both ends, and the audit below is what catches it when it isn't.
  - **And its own suite could not tell the two apart.** `verify-plan`'s evidence that the
    plan reaches the answer was a regex for "starter" over **model prose**, and nothing
    else. It came back once as *"Memberships isn't part of your current setup"* — which is
    the documented PRE-fix wording, so a wording change reads exactly like the column having
    been silently dropped again, on the one field this file records being dropped for months.
    It now reads the stored value back **before** asking the model, and the prose check
    carries that value into `plan-failures.log` — so the entry names the layer instead of
    leaving it to be rediscovered. **19 checks.**
- **Set from a `Plan` column in the locations table**, not from the support modal. It is one
  map on the agency's config but a per-sub-account FACT, exactly like the Support toggle it
  sits beside — and the table already searches and paginates 41 sub-accounts, which a
  620px dialog does not. Three things it must do, all of them consequences of the PUT being
  whole-object:
  - **Saves on BLUR, never per keystroke** — each save PUTs the entire support policy, so
    typing "Starter" would be seven round trips of the whole config.
  - **Read-modify-write against the loaded config**, and it **refuses to save at all** when
    that config failed to load. The four initial resources load through `allSettled`
    precisely so a support failure cannot blank the sub-account list, which is exactly the
    state in which a partial PUT would wipe the greeting, the blocked terms, the hours and
    the response targets.
  - Verified end to end against the live route: the exact save the cell performs stores the
    plan, leaves greeting / `forbiddenTerms` / `slaFirstResponseMins` intact, clearing the
    box removes the entry, and `resolveBrandMap` then reports `planName: "Starter"` — which
    is the thing that actually changes what a client is told.

#### One resource, two shapes on the wire — and the client stored both in one variable
The support GET normalised (a nullable Json column handed back as `[]`, the response
targets resolved into a complete policy) and the PUT returned `res.json(config)` — the raw
Prisma row. The dashboard puts BOTH into the same `SupportConfig`-typed state, so which
shape it held depended on whether the last thing it did was load or save.

Measured, with `slaFirstResponseMins` NULL, for one row, seconds apart: the **GET** answered
`{urgent:15,high:60,normal:240,low:480}` and the **PUT** answered `null`.

Nothing was losing data — the Plan cell's read-modify-write happens to re-send a null that
was already null — so it survived on **luck**, and luck is exactly what ran out when a
nullable Json column reached `ChipInput` and blanked the entire dashboard. A declared type
is a promise the SERVER makes; nothing type-checks JSON crossing the wire.

- **`serialiseSupportConfig()` is now the single shape**, read by the GET and the PUT.
- **And by the no-row branch**, which was the other half: a hand-written object listing the
  same thirteen fields, so adding a column and wiring it into the PUT while forgetting that
  list binds a fresh agency's control to `undefined`. Invisible on any database that already
  has a row — which is every database anybody develops against. It now serialises
  `EMPTY_SUPPORT_CONFIG`, so the two branches are one shape with two sets of values.
- Verified live: `verify-plan` grew to **18 checks** — the PUT answers the GET's field set,
  both resolve the policy with the column NULL, and the no-row branch carries the same
  shape and the defaults the automation will actually enforce.

#### THE HARNESSES WERE DELETING THE USER'S OWN DATA
Six suites cleaned up with `p.supportConfig.deleteMany({})` — **unscoped**. That removes
every agency's greeting, blocked terms, business hours, response targets and plan names,
including agencies the script never touched. Two were guarded by `if (made.configCreated)`,
which reads careful and is the same bug in a costume: creating one config still deleted all
of them.

Invisible on a one-agency dev database and destructive the moment there are two — the same
shape as a per-tenant check written as an aggregate, which this file already records
readiness getting wrong twice. It is silent from every side: the next symptom is the bot
answering with the generic wording weeks later, or readiness reporting a support config
that "was never set up".

- All six now **snapshot every row before writing anything and put them back**, rather than
  scoping the delete — scoping fixes the neighbours, not the agency under test, and these
  suites deliberately own that agency's config while they run (they PUT their own policy
  through the route, which is the only thing that invalidates the brand-map cache).
- Proven by planting a marked config, running the suites, and reading it back byte for byte:
  greeting, blocked terms, plan names, response targets and the master switch all intact,
  with `cleanup: supportConfigs=1` where it used to say 0.
- **Found by accident**, which is the uncomfortable part: it surfaced only because a new
  check needed the no-row branch and I went looking for why the row kept vanishing.

##### "Assumes an empty database" is now a FIVE-time failure — treat it as a default suspect
Every occurrence looks like a product bug and is a suite that can only be right on a
database nobody has used:
- `verify-routing`'s percentiles asserted `count === 0` and exact medians, while
  `firstResponseStats` is desk-wide **on purpose**. Two chats made by hand while trying the
  widget failed four checks and read as a broken percentile query.
- `verify-dryrun` asserted `conversation.count() === 0` to prove a dry run writes nothing.
  The claim was always about the DELTA; five pre-existing rows made it read as the dry run
  storing transcripts.
- `verify-tickets` got there first and says so out loud, because the automation passes are
  global.
- `verify-desk` asserted *"refused when the agency has no escalation email"* straight from
  the fixtures — and configuring one is REQUIRED before the master switch turns on, so the
  assumption is false on every real install. It returned 200 and reported a safety refusal
  as **missing**, sending the reader hunting a bug in a guard that is fine. The suite now
  ARRANGES the no-address state.
- `verify-offboard` asserted `before === 0` and then exact queue depths. One genuinely
  escalated ticket from two days earlier — the row the queue-reach alarm exists to report —
  failed four checks and read as the release queueing the wrong things.

The rule: when the thing under test is global, **measure relative to what is already there
and print the baseline**. "MEDIAN, not mean" is now stated as *the outlier barely moves it*
rather than as a hardcoded 120, "writes nothing" as *no new rows*, and a queue depth as
*baseline + the fixtures added* — which is what was meant every time, and is true on any
database.

###### Two more, found 2026-08-20 by running every suite instead of the ones I had touched
Both are the same rule from new directions, and the second is the worst instance in this
list because it made a suite go GREEN over a real leak.

- **`verify-readiness` assumed support had never been switched on, deployment-wide.**
  `readiness.supportEnabled` is true if ANY agency has the master switch on — deliberately,
  since it asks whether this DEPLOYMENT is running the support product. Three checks
  asserted `=== false`, so they held only until a real agency configured support, and then
  failed in a way that reads like readiness being broken rather than the suite being wrong.
  It now snapshots the rows that are on, switches them off for the probe, **prints what it
  found**, restores them, and asserts the teardown against that baseline rather than against
  zero. Verified in BOTH directions — 33/33 with the deployment's support on and 33/33 with
  it off — because a fix that only works on today's database is the original bug again.
- **`verify-feeds` assumed its fixture was the only article about its topic**, and that is
  how a **check passing for the wrong reason** hid a broken quarantine gate. The pair
  "retrieval returns neither" / "retrievable now" both queried *"trigger links that track
  who clicked"*. Since the help centre was crawled, **twenty genuine articles answer that
  better** than a five-sentence fixture — measured on the 1,443-article corpus, the fixture
  is nowhere in the top 20. So the positive check started failing (which is what surfaced
  it) and the negative one had been **vacuously true since the crawl landed**.
  - Proven rather than argued: with `searchKb`'s `status = 'ready'` filter mutated to admit
    `needs_review` — retrieval serving quarantined articles straight to clients, which this
    file calls correctness, not optimisation — the suite reported **24 passed, 0 failed**.
    A green run over the exact leak the check exists to catch.
  - The property under test is **status gating, not ranking**, so the query no longer
    competes with the real corpus: the fixture carries a per-run token nothing else
    contains, and both checks use it, which makes them each other's control. That is what
    every other suite does when it plants a marked row; it is not fitting the test to the
    data. With the fix, the same mutation fails the check immediately.
  - The general form is worth keeping: **a corpus that grows makes any rank-dependent
    assertion decay silently.** It never errors — it just stops being about what it says it
    is about, and the negative half decays first, because "not in the top 5" gets easier
    every time the corpus grows.

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
- Verified live: **30** checks — the renames it used named as `from → to` and ONLY the two
  the fixture set, zero vendor names, zero URLs, a
  not-owned `locationInstallId` 400s, and no rows written. Plus the three below, which stop
  the suite reading a dead model as a product failure.

#### "Nothing leaked." over six questions the model never saw (2026-08-26)
Found by running `verify-plan`, watching one check fail, and asking the model directly why:

```
429 insufficient_quota — You have no credits remaining.
```

The key was set and valid. The account was empty. `answerQuestion` catches every model
failure and returns one sentence — *"Sorry — I'm having trouble right now. Let me get someone
from the team to help."* — which is exactly right for a client, whose chat window inside their
own CRM is no place for `insufficient_quota`. It is useless for the AGENCY, and this is the
screen they use to decide whether to switch a client-facing product on.

Measured against the live failure, before anything was changed:

```
allClean: true
  identity       clean=true  escalated=true  findings=0  "Sorry — I'm having trouble right now…"
  vendor-direct  clean=true  escalated=true  findings=0  "Sorry — I'm having trouble right now…"
  renamed-menu   clean=true  escalated=true  findings=0  "Sorry — I'm having trouble right now…"
  add-contact    clean=true  escalated=true  findings=0  "Sorry — I'm having trouble right now…"
  link           clean=true  escalated=true  findings=0  "Sorry — I'm having trouble right now…"
  money          clean=true  escalated=true  findings=0  "That one's best handled by the team…"
```

The verdict line read **“Nothing leaked.”** An agency reads that as a pass and switches
support on, and every client question from then on becomes a hand-off to their own team.

- **`allClean` is computed from GATE findings, and a sentence the model never wrote passes
  every gate.** There is nothing in it to leak, link or copy — the same reasoning the empty-
  answer check already records one file over, arriving at the screen instead of the bubble.
  `clean` still means what it says, because the rest of the screen is built on that sentence;
  what was missing is the PRIOR question, and it is answered separately as `ready`.
- **The deployment note's advice was wrong in the case that actually happens.** It said *"if
  all six answers are hand-offs, the key is missing"* — so the reader is sent to check the one
  thing that is fine. An unset key is what a fresh deploy has; an empty account is what a
  working one meets months in, and they are indistinguishable on every screen.
- **`modelFailure.ts` classifies it, exactly as `tokenFailure.ts` does for a refresh** — five
  answers needing different people: `not-configured`, `auth`, `no-credits`, `rate-limited`,
  `transient`, each with a remedy. **Quota and a rate limit are both 429s and need opposite
  actions**, so the code and message separate them, not the status; and anything
  unrecognisable is `transient`, because telling an operator to go and fix billing that is
  fine is the dangerous direction. `isPermanentModelFailure` is what decides whether *"try
  again"* is honest advice.
- **The count is `5 of 6`, not `6 of 6`.** The money question is a *correct* pre-model hand-off
  — the guard that stops the bot committing an agency to something — so it carries no failure
  and is still badged `clean`. Collapsing the two would have made the one working guard look
  like part of the outage.
- **Never reaches a client.** It rides on `AnswerResult`, and `/support/api/.../message`
  returns a named list of fields, so the widget cannot pick it up by accident.
- The row badge says **`no answer`** rather than `clean`, because a per-row badge saying
  "clean" beside a failure banner is the same lie one level down.
- **Its own suite was blind in exactly the same way.** `verify-dryrun` reads answer TEXT, so
  with the account empty it reported a dozen failures about brand names and renamed labels,
  none of which were about the product. It now **throws with the real reason** before any of
  those run — the `verify-session` 429 rule: when the failure mode is known, make the
  occurrence self-documenting rather than leaving the next person to rediscover it. Verified
  against the live condition:

  > `the model answered 1 of 6 probes (no-credits). The OpenAI account has no credits left.
  > The key is fine — nothing here will start working again until credits are added, and
  > retrying can't fix it. Nothing below this line would be about the product.`

- **9 unit tests** (`modelFailure.test.ts`), including the real 429 verbatim, an ordinary
  rate limit that must NOT be read as billing, and that every kind carries a remedy the
  reader can carry out.
- **And asserting the payload proves nothing about the screen**, so `shoot-dashboard.mjs`
  reads the rendered modal. Measured after the fix, against the same live failure:

  > verdict: **“Nothing to judge yet — the assistant never ran.”**
  > banner: *“The assistant didn’t answer 5 of 6 questions — those aren’t results, they’re
  > failures. The OpenAI account has no credits left… Running this again will give you the
  > same six hand-offs.”*
  > badges: `no answer × 5`, `clean × 1`

  The step **throws** if rows say "no answer" with no banner, if the banner names no remedy,
  or if the verdict still reads as a pass — so the screen cannot quietly go back to claiming
  a clean run over a dead bot.
- Amber, not red, and above the verdict: an instruction with a remedy, not a leak — the same
  split `App.tsx` makes for an expired session.

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

### Crawling a help centre: three traps, all silent (2026-08-17)
Turned on for `help.gohighlevel.com` at the user's explicit instruction. Getting there
found three separate failures, and **every one of them reported success**.

##### 1. `--dry-run` WROTE TO THE DATABASE
The one procedure this file insists on — *"ALWAYS dry-run first"* — did the opposite.
`crawlHelpCenter` called `ingestArticle` unconditionally and then consulted its own
`dryRun` flag only to decide how to LOG the result, so the row was already written. It
printed **"DRY RUN - nothing will be written"** and wrote every article it visited.
Measured on a cleared database: a 3-page dry run left **2 rows** behind.

It is worst precisely where it is used most — pointing the crawler at an unfamiliar site to
see what extraction produces is exactly when you do not want the output in your corpus.
`ingestArticle` now takes `dryRun` itself and guards **both** write sites (the
unchanged-poll `lastCrawledAt` touch as well as the upsert). Everything above them is pure
computation, so the reported classification is still exactly what a real run would store.
The dry-run summary also **counts** now: it previously reported all zeros, which read as
"found nothing to do".

##### 2. The extractor returned page furniture, and it passed every gate
`help.gohighlevel.com` is JS-rendered: 172KB of HTML per article containing **no article
body at all**. So `extractMainContent` returned the portal shell — *"• Home • Knowledge
base • Surveys … All Articles Recent Searches … Sorry! nothing found"* — about 4KB of text,
which sails past the 200-char nav-stub floor.

**That chrome names no vendor and carries no link, so it ingested perfectly: 60 articles,
status `ready`, 0 quarantined, 50 of them placeholdered.** The brand gates prove an article
is SAFE. Nothing proved it was an ARTICLE. Left alone this was 2,854 rows of navigation
furniture that retrieval would serve to real clients.
- **Fixed by using the structured source.** Freshdesk publishes every article as JSON at
  `<article-url>.json` — `title`, `description` (authored HTML), `desc_un_html`, and a
  `status` where 1 = draft and **2 = published**, which is now honoured so a draft cannot
  reach a client. The HTML path remains the fallback for non-Freshdesk sites.
- **And a general TEMPLATE DETECTOR**, because the trap is not Freshdesk-specific: when
  extraction silently yields furniture, every page produces nearly the same text. The crawl
  now fingerprints each body's opening and **aborts** if one fingerprint covers ≥60% of at
  least 8 pages. Aborting mid-run is right — the alternative is thousands of rows somebody
  must later identify and delete, and a corpus nobody trusts meanwhile.
- The summary states **how many bodies came from JSON versus HTML**, because "did we get
  real articles" is the question its reader is actually asking.

##### 3. The sitemap is not at the root
`/sitemap.xml` 404s; Freshdesk publishes at `/support/sitemap.xml`. The crawler assumed the
root and reported *"no sitemap - nothing to crawl"* with an all-zero summary and exit 0 —
which reads as "this site has no crawlable content" rather than "we looked in one place".
Hence `--sitemap`, and the failure message now names the path actually tried. The sitemap
must be **same-origin** as `--origin`: it selects what gets ingested, so an arbitrary host
could otherwise direct the crawl.

##### 4. The abort did not abort, and we hammered a host that had said stop
The template detector fired for real on the full run — and the `throw` was **inside the
per-article `try`**, whose `catch` counts one failure and moves to the next URL. So the
"abort" swallowed itself and the crawl made **217 further requests to a server already
answering `403 "You have exceeded the limit of requests per hour"`**. Continuing after a
host says back off is the one crawler behaviour that earns a permanent block.
- **`abort` is a flag checked at the top of the loop**, not an exception thrown from inside
  a block designed to swallow per-article failures.
- **Five consecutive non-2xx responses stop the run.** A refusal streak is a rate limit, a
  block or an outage — it applies to every remaining URL, not just this one. Any 2xx resets
  the counter, so one dead link among successes still costs nothing.
- **The abort message printed the CURRENT page, not the repeated text.** It showed a
  perfectly good article beside a claim that everything looked alike, so the report argued
  against itself and I read a true positive as a false one. It now reports the dominant
  shape's own sample.
- **An aborted run sets `truncated`**, or stopping a quarter of the way through reads as
  complete coverage of a small help centre.
- Verified live: **17 checks** (`scratchpad/verify-crawl-guards.ts`) against a real HTTP
  server serving three fixtures — distinct articles, identical furniture, and a host
  refusing everything. It asserts requests actually *stop* (measured by counting them at
  the server, not inferred from the summary), that the dry run writes zero rows while still
  reporting real counts, and that the refusal message names the refusal rather than blaming
  extraction.

##### 5. ABSENT and REFUSED are different answers — collapsing them retired 584 real articles
The worst bug of the crawl, and it was introduced by the fix above rather than found in old
code. `fetchStructuredArticle` returned `null` for a **403 rate limit** exactly as it did
for a **404 no-such-JSON**. So once the host began refusing us:
- every article read as *"this one has no JSON"*,
- the skip path marked it `archived` with `lastCrawledAt` set,
- and the resume filter skips those **forever**.

A temporary rate limit permanently retired **584 perfectly good articles**, silently, while
the run reported `0 failed`. Worse, that path never calls `fetchText`, so the
consecutive-refusal guard never saw a single refusal to count — the protection added one
commit earlier was structurally unreachable from the code path that needed it.

- `fetchStructuredArticle` now returns a discriminated `article | absent | refused`. Only
  **404/410** mean absent; 401/403/429/5xx are the host declining to answer, which says
  nothing about the article.
- A refused JSON now feeds the SAME refusal counter as a refused page, so the crawl aborts.
- The 584 markers were **deleted rather than un-archived**: we cannot tell which were
  genuine 404s and which were rate-limited, and unknown must mean "try again", not "retired
  forever" — the same reasoning as `removedReason` refusing to resurrect a sub-account it
  has no reason for.
- **And the fix for it had a bug of the same family.** I reset `consecutiveRefusals = 0`
  unconditionally after the JSON check, which runs *before* the HTML branch can count its
  own refusal — so the counter was zeroed every iteration and could never reach the
  threshold. The guard looked present in review and could not fire. Caught only because the
  `refuse` fixture went from aborting after 5 requests to making all 40. **A counter that is
  reset on every path is not a counter**; reset only on content actually obtained.
- Verified live: the guard suite grew to **28 checks**, including a fixture whose JSON
  endpoint 403s while its HTML still serves — the exact shape of the real rate limit. It
  asserts the run aborts, that nothing is written, and specifically that the refusal is
  **not counted as `skipped`**, since that is the number that would read as "these articles
  have no JSON".

##### Retrieval had to be re-tuned, and one of the two fixes was a real design flaw
Crawled content is the first thing to test the floor since the corpus was written. Both
changes were **swept, not guessed** (`scratchpad/probe-crawl-impact.ts`, which A/Bs by
toggling the crawled rows' status — a before/after reading is worthless here, and my first
attempt proved it by measuring neither state while a crawl was still running).

- **`DEFAULT_MIN_RANK` 0.1 → 0.25.** 159 crawled articles — 6% of the help centre — took
  the off-topic controls from 1/6 leaking to **5/6**: *"capital city of portugal"* returned
  a voice-permissions article. The full sweep is recorded above the constant; 0.18–0.30 all
  give 0 leaks, so 0.25 is the middle of the window rather than an edge.
- **THREE provenance tiers, not two.** The rank bonus was
  `CASE WHEN source = 'agency' THEN 1.5 ELSE 1.0` — and the 253 hand-written articles carry
  `source='ghl'`, **identical to crawled vendor pages**. They competed as exact peers, so
  content written specifically for this product (symptom-titled precisely because retrieval
  is full-text) had no edge over scraped documentation. Measured: *"i need a client to sign
  an agreement electronically"* stopped returning the contracts article and started
  returning **HIPAA Compliance** — a real question answered confidently and wrongly, which
  is worse than an off-topic leak. Hand-written now sits at 1.25 via the `mosaic:kb/` key.
- **A withdrawn finding, recorded because the reasoning is the useful part.** The identity
  question appeared to regress badly: `searchKb({strictOnly:true})` led with a crawled page
  at **228x** the rank of our own "What this software is for", because the strict pass runs
  with no floor. It is not reachable — `supportBot` never calls `searchKb` for these at
  all, short-circuiting to `Promise.resolve([])` one level above. Chasing it would have
  meant redesigning the strict pass to fix a bug that cannot occur. `probe-floor.ts` now
  pins the **short-circuit**, and imports the real `ANSWERED_WITHOUT_KB_RE` rather than a
  copy that would keep passing after the original changed.
- **Re-measured at 1,315 articles** (5x the seed corpus): still **0/6 off-topic leaks** and
  no dilution. The tuning holds at scale, which is the thing a 412-article reading could
  not establish.

##### …and at 1,443 the tuning has stopped holding (found 2026-08-20)
That "no dilution" reading measured **leaks**, and leaks are still 0/6. It did not measure
the other axis at width. `verify-kb-coverage` asks THIRTY realistically-phrased questions,
and four of them now retrieve **nothing at all**:

> coupons-and-discounts · the-chat-widget-on-your-website · custom-fields · products-and-prices

*"i want to give someone ten percent off at checkout"* returns zero rows, so `supportBot`
reads thin retrieval and files a ticket — with the hand-written article that answers it
sitting in the corpus, `ready`, and ranking **first** the moment the floor is lowered. That
is the failure two-pass retrieval was built to remove ("0 retrieving nothing" at sign-off),
returning by a different door as the corpus grows.

- **The two windows have stopped overlapping.** Zero leaks needs `minRank >= 0.25`; zero
  silenced needs `<= 0.20`. They overlapped at 412 articles, which is why 0.25 looked like
  the middle of a safe window. **The table recorded above the constant is now stale in the
  dangerous direction** — it says 0.20 gives 0/6 leaks; measured, it gives 2/6. It has been
  annotated in place rather than rewritten, because what it recorded was true at 412 and the
  drift is the point.
- **Three other levers were measured and rejected**, and the negative results are the useful
  part:
  - **ts_rank length normalisation** is the textbook answer, because every leaking article
    is LONG (42k, 23k, 20k, 18k chars) and unnormalised `ts_rank` rewards documents that
    contain more of everything. Tested at 0/1/16/32/33: it **narrows** the overlap — 32% of
    the wanted articles' range at norm 0, 11% at norm 1 — and never inverts it. No floor
    separates the two sets under any normalisation.
  - **`MIN_LOOSE_TERM_HITS`** trades one axis for the other: 4 buys 0 leaks with 2 silenced
    instead of 4, and costs "answered from the right article first" (11 → 9).
  - **The 424 HTML-fallback articles** — 36% of the crawl, `<title>` ending "Support Portal"
    and portal chrome still in the body — were my hypothesis and were **wrong**: archiving
    them changes off-topic leaks by **zero** at every floor. They do crowd out real answers
    ("in top 5" 20 → 24 at floor 0.10 without them), which is a corpus-quality problem worth
    fixing on its own and not this one.
- **What the leaks actually are: ordinary English.** *"when did the second world war end"*
  matches on when/second/world; *"best way to cook a medium rare steak"* on best. A CRM help
  centre says "wait 30 seconds", "worldwide", "when the workflow runs", "best practices" — so
  a large corpus of verbose vendor documentation defeats a two-distinct-terms rule that held
  comfortably over 253 hand-written ones. **The rule did not break; the corpus outgrew it.**
- **Deliberately NOT retuned.** Leaking answers an unanswerable question wrongly; silencing
  files a ticket for one we can answer. This file argues both sides in two different places
  — the floor comment calls zero rows "the safe direction", the two-pass comment calls it
  "the worst bug the bot has had" — and both are right, about different questions. The floor
  cannot tell them apart, which IS the finding. Picking between them is a product decision.
- `scratchpad/probe-floor-sweep.ts` is the durable artefact: a two-axis sweep over
  `minRank` x `MIN_LOOSE_TERM_HITS`, reading both question sets **out of the suites that own
  them** so it cannot drift into sweeping a private copy, and printing the silenced slugs by
  name. Run it after any crawl — this is the measurement that says whether retrieval still
  works, and it is the one that had never been run at width.

###### …and then the cause turned out to be an inconsistency, not a tuning
The floor compared the **RAW** `ts_rank` while the SELECT one line above ordered by the
**BOOSTED** one:

```sql
SELECT (ts_rank(...) * CASE WHEN source='agency' THEN 1.5 WHEN mosaic:kb/ THEN 1.25 END) AS rank
WHERE   ts_rank(...) >= floor      -- no multiplier
```

Two definitions of relevance, and the floor won. So the three provenance tiers documented at
length directly above it — the tiers that exist because hand-written articles "had no edge
over scraped pages" — applied only to rows that had **already survived a bar set as if they
did not exist**. An agency's own article and a crawled vendor page were held to the identical
absolute threshold; the boost could reorder what got through and never save anything from
being cut. It reads correct in review because both lines say `ts_rank`.

- **With the value 0.25 unchanged**, making the two the same expression:

  | | before | after |
  |---|---|---|
  | off-topic leaks | 0/6 | **0/6** — the fail-safe is untouched |
  | answerable questions retrieving nothing | 4/30 | **1/30** |
  | wanted article first | 11/30 | **13/30** |
  | wanted article in the top 5 | 14/30 | **20/30** |

- **The multiplier's magnitude makes no difference** across 1.25–3.0, which is what says the
  defect was the inconsistency and not the number. Had it responded to the magnitude, the
  honest reading would have been "we tuned until the test passed".
- This is the `QUEUE_ORDER` rule in a third place: **one definition of a thing, read by
  everything that uses it.** Two drift, and here nobody could see both at once because they
  were four lines apart in the same query.
- **`probe-floor-sweep.ts` reported the OLD numbers for a full run after the fix landed**,
  because it REPRODUCES the query rather than calling it — `MIN_LOOSE_TERM_HITS` is a module
  constant with no override, which is a real constraint and also the drift this file warns
  about, inside the tool built to measure the drift. It now **self-checks against the real
  `searchKb` before sweeping anything** and throws if the two disagree, because a sweep whose
  baseline differs from the product is a table of numbers about nothing.

###### The 424 chrome-laden articles: a correct fix that changed nothing measurable
`extractMainContent` argues the case in its own doc comment — *"Ingesting those means every
article carries the same boilerplate, which poisons ranking (every article matches every
query)"* — and none of its container patterns match a Freshdesk portal, so 36% of the crawl
fell through to `<body>` and was stored with the whole page: ~350 characters of navigation
per article, and the portal's name in the **title**, which is weighted A.

- Fixed at the pipeline (`stripHelpCentreChrome` / `stripPortalSuffix`, 9 unit tests, two
  independent signals required so ordinary prose is never cut, and a refusal to leave less
  than `MIN_BODY_CHARS`) and repaired in place by `npm run repair-kb-chrome`, which writes a
  **backup file before its first write** and restores from it — the text exists nowhere else,
  and re-crawling to recover it would mean 424 requests to a host that has rate-limited us.
  190KB of navigation removed, 459 chars/article.
- **And the retrieval table came back byte-identical.** Not one of leaks, silenced, first or
  top-5 moved. Earlier, ARCHIVING those articles moved top-5 from 20 to 24 — so they crowd out
  real answers by their genuine content, not by their chrome, and the hypothesis that the
  furniture was doing the damage was wrong twice over.
- Kept anyway, on grounds that are not about ranking: a citation reaching a support agent is
  rendered as a title, and 424 of them read *"Text-To-Pay Links: {{PLATFORM}} Support Portal"*
  inside a white-label product; and the chrome feeds the model lines like *"Sorry! nothing
  found for …"* as context. **The measurement is reported as it came out** rather than the
  change being justified by a number it did not produce.
- `featureTags` are deliberately NOT recomputed: they were derived before placeholdering, from
  text this repair does not have, so recomputing would UNDER-tag — and under-tagging is the
  failure that reaches a client, while this file records over-tagging as mild. 224 articles
  keep a tag with no evidence left in the body; the script reports them and touches nothing.

##### The hidden-feature hand-off broke, and only a REAL ANSWER showed it
Every retrieval measurement was green — 0 leaks, no dilution, 1,443 articles. Then the bot
was asked actual questions with a real model, and *"how do i point my own web address at my
funnel"* came back with a complete, correct answer **and** `shouldEscalate: true`:

```
escalationReason: asked about Memberships, which isn't part of their setup
```

The client is told a person is coming, having just been answered in full; the desk queue
fills with questions the bot got right; and every one is recorded as a deflection failure.
No retrieval metric could see this, because retrieval was working.

- **Cause: tagging is case-INSENSITIVE by design, and crawled prose cannot be corrected.**
  The seed corpus keeps over-tagging harmless through HOUSE STYLE — never use a nav label as
  ordinary English — which is advice you can only follow for pages you write. Measured:
  **4.6% of crawled articles carry the `memberships` tag against 0.4% of hand-written ones**,
  so some incidentally-tagged page matches nearly any query.
- **Raising the rank floor does not help,** and this is the useful part: the match is
  genuinely strong, it is the TAG that is wrong. Verified at 0.5 and 0.8 — the same crawled
  domains article comes back.
- **The fix is to compare against the alternatives.** The probe asked *"does ANY
  hidden-tagged article match?"*, which at 1,443 articles is nearly always yes. It now asks
  for the single best answer overall — neither `onlyFeatures` nor the hidden exclusion — and
  treats a hidden tag on THAT as the signal. If the best answer we have is about a feature
  they cannot see, they asked about it; if it ranks third behind two articles that answer
  them properly, they did not.
- **A first attempt was wrong and is worth recording.** I restricted the probe to
  hand-written content (`authoredOnly`), which killed the false positives — and also killed
  the flagship case, because the article that matches *"a friend told me i can build a course
  area for my members"* is a crawled one. Reverted rather than kept: an option with no caller
  is worse than none.
- **The backtick trap bit again, in a new file.** The comment `` `authoredOnly` `` inside
  `kbSearch.ts`'s `$queryRaw` template literal ended the string, exactly as documented for
  `supportWidgetScript.ts`. Any SQL built as a tagged template has the same hazard.
- Verified with real model calls: 18 checks (`scratchpad/verify-crawl-answers.ts`), asking
  every question twice — with and without the crawled rows — so a difference is attributable
  to the crawl rather than to the model having a good day. `verify-plan` still 12/12.

##### And it earns its place: 2/8 → 8/8
Every coverage probe until now used questions the hand-written corpus already answers, so
they could only ever show the crawl doing no harm. Against questions it does *not* cover —
call quality, A2P rejections, Twilio rebilling, merge fields, country restrictions,
snapshots — the seed corpus answers **2 of 8** and the crawled corpus answers **8 of 8**,
with the right article first. That is the argument for the crawl, and it did not exist
until it was measured.

##### What the crawl actually yields
- **2,854 article URLs** in the sitemap; `robots.txt` disallows only search/tickets/login
  and explicitly advertises it. Crawling is serialised at the site's stated 1.5s delay,
  excerpts only, never a mirror.
- **~25% are video-only** — the body is a bare Loom `<iframe>` and `desc_un_html` is two
  spaces. Correctly skipped by the 200-char floor: a text-retrieval bot cannot use a video,
  and an empty article is worse than a missing one. Real yield is therefore **~2,100**.
- **Legal posture is a decision, not a check.** `robots.txt` permission is not a
  redistribution licence; the hand-written corpus exists specifically to avoid that
  question. Recorded because the green robots check does not answer it.

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

#### GHL's real changelog feed (found 2026-08-17)
`https://ideas.gohighlevel.com/api/changelog/feed.rss` — 200, `application/rss+xml`, and it
is **not linked from anywhere a human would look**: the changelog page is an SPA that
returns its HTML shell for every guessed path (`/changelog/rss`, `/changelog.rss` and
`/changelog/feed` all answer **200 with HTML**, so probing by status code finds nothing).
The URL is only in a `<link rel="alternate">` in the page shell. Freshdesk's `.rss` paths on
`help.gohighlevel.com` 302 away and are not it.

- **Added to the local DB, `autoPublish` OFF**, which is the whole point: these are
  changelog entries, not how-tos, and an entry ingested as an article makes the bot answer
  *"how do I add a contact"* with a release note. They sit in the review queue.
- **The pipeline holds on the vendor's own copy.** Ten items ingested, **0 quarantined, 0
  residual leaks, 0 URLs, 0 vendor names surviving**. The clearest case:
  `Import Data Directly from HubSpot into HighLevel` was stored as
  `{{FEATURE:settings-import-data}} Directly from HubSpot into {{PLATFORM}}` — and
  **HubSpot was correctly left alone**, because a third party's name is not the vendor
  being white-labelled. A second poll reported *10 unchanged*, so the content-hash
  short-circuit works against a real publisher.
- **It advertises no ETag and no Last-Modified**, so the conditional GET can never 304 and
  every poll re-downloads ~37KB. Irrelevant hourly; worth knowing before polling it often.
- **It is a rolling window of 10 items.** Polling must be frequent enough that more than 10
  entries can't appear between two polls — hourly is far inside GHL's several-per-week rate.
- **Scheduled by GitHub Actions, not Render** (`.github/workflows/poll-feeds.yml`). Render
  cron is a paid feature; Actions cron is free and the repo is already on GitHub, so the
  "needs a paid plan" blocker was never real. Hourly at **:17** — off the hour deliberately,
  because that is when every scheduler on the platform fires and GitHub delays queued runs
  under the load. A `concurrency` group covers the exact concern that keeps the poller out
  of the server process: two overlapping runs re-fetch every feed and race the same upserts.
  - **One secret, `DATABASE_URL`, and nothing else.** Verified by running the poller with an
    empty environment: `validateEnv()` is a function rather than an import-time check, so
    nothing else is required. Either Neon endpoint works — the PgBouncer caveat is about
    `prisma migrate deploy`, and this job runs no migrations.
  - **Without the secret it exits 0 with a notice, not red.** A scheduled workflow that
    fails every hour until somebody configures it teaches people to ignore this repo's CI,
    and the next failure it hides is a real one. Not scheduling feed polling is a supported
    state; a permanently broken CI signal is not.
  - It also prints the readiness report as a non-failing step, because readiness is
    otherwise only logged at boot — an hourly run is the only regular chance anyone has to
    read it, and `feed-review-backlog` is precisely the line saying items are waiting.

##### "Actions cron is free" is true by the run and FALSE by the month
Measured 2026-08-20, before adding a third scheduled workflow. Actions bills private repos
by the minute and **rounds every job up to a whole one**, so cadence alone sets a floor that
no amount of making a job fast can get under:

| workflow | cadence | runs/month | billed floor |
|---|---|---|---|
| `ticket-automations` | every 10 min | 4,320 | 4,320 min |
| `poll-feeds` | hourly at :17 | 720 | 720 min |
| | | | **5,040 min** |

The free private-repo allowance is **2,000 minutes/month** (3,000 on Pro or Team), so the
two workflows already committed are **2.5x over before a single second of real work** — and
each job also runs `npm ci` over 336 packages and `prisma generate`, so the true figure is
several times that again. A separate 10-minute keep-warm workflow would have taken it to
4.7x.

- **The floor is the useful number, because it removes the tempting fix.** Trimming the job
  — caching, skipping `prisma generate`, a leaner checkout — cannot help: a ten-second job
  still bills a minute. **Cadence, repository visibility, or money are the only three
  levers**, and all three are decisions rather than code.
- **The failure is silent and it is the automations that stop.** When the allowance is spent
  GitHub simply stops running scheduled workflows. Nothing in the request path notices —
  which is exactly why `automations-never-run` exists in readiness, and that check would
  then be reporting a BILLING state while reading like a broken scheduler.
- This qualifies the claim above. Actions cron is free per run; it is not unmetered, and at
  a ten-minute cadence on a private repo the meter is what binds. Public repos are genuinely
  unlimited, which is the cheapest of the three levers if the history is clean enough to
  publish.

##### …which is why keep-warm is a STEP, not a workflow
The free Render instance sleeps after ~15 minutes and takes ~50s to wake, and because
theming is a render-blocking `@import` that stall lands on the client's **entire GHL UI**,
not just the branding — the deployment note's long-standing open item and the most likely
thing to be reported as "GHL is slow". The cadence it needs is ten minutes, which is exactly
the cadence `ticket-automations` already runs at, so it ships as the **first step** of that
job and costs nothing.

- **First, before checkout**, because it needs only `curl` and waking the instance early
  means it is up long before the job finishes.
- **`-m 90`, not the default.** Waking a sleeping instance takes ~50s, so a short timeout
  would abandon precisely the request the step exists to make.
- **It never fails the job.** A dead datastore already fails it properly — a pass that
  throws does — and a ping that red-Xes a ten-minute schedule on a transient runner hiccup
  is how people learn to ignore this repo's CI, which is the same argument that makes a
  missing `DATABASE_URL` exit 0. Non-200 is a `::warning::` in the run summary instead.
- **A >20s wake is called out in words**, because that number IS the stall an agency's whole
  GHL UI takes; left in the timing line it reads as a slow test.
- **Best effort, and it says so.** Actions delays scheduled runs under load — the same
  caveat that makes every SLA threshold here read "at least N minutes" — so a ten-minute
  cron can arrive twenty minutes late and the instance sleeps anyway. It reduces cold
  starts; a paid plan abolishes them.
- **`APP_PUBLIC_URL` is read as a repository VARIABLE**, not a secret: it is in the `@import`
  line every agency pastes. `secrets` is accepted as a fallback because keeping everything
  there is the common habit.
- Verified: **22 checks** (`scratchpad/verify-keepwarm.mjs`), which **extracts the script out
  of the workflow file** and runs it against local HTTP stubs — 200, 503, a 21-second wake,
  a refused connection, a trailing slash, and no URL at all. Testing a copy would let the
  two drift, the trap already recorded for the pasted snippet. The extractor carries a
  positive control (five markers the block must contain) so a renamed step throws instead of
  silently testing an empty string; confirmed by renaming it. Confirmed to fail under three
  further mutations — dropping the trailing-slash strip, shortening the timeout to 5s, and
  making a bad status exit 1.
- **It only ever runs once `ticket-automations.yml` is in git**, which it is not. That file
  is among the fifteen `verify-deployable` reports.

##### The shared review queue was WRITE-ONLY (`scripts/reviewKb.ts`, 2026-08-17)
Adding the first shared feed exposed it immediately: `autoPublish: false` puts items in
`needs_review`, and **nothing in the product could ever take them out again**. The
dashboard's approve route is scoped `{ agencyInstallId, source: "agency" }` — which is
*correct*, since an agency must never publish into the corpus every OTHER agency's bot
reads — so no agency owns a shared item and no agency can release one. Items went in and
stayed. The same shape as the desk storing replies nothing delivered.

`npm run review-kb --workspace @ghl-theme-builder/server` (`--show`/`--approve`/`--reject`
/`--approve-all --feed <id>`/`--trust-feed <id>`).

- **A CLI, not an HTTP route.** The shared corpus is Mosaic's own, so a route needs a new
  authorisation surface, and the desk exists to answer clients rather than curate a corpus.
  Same reasoning as `create-desk-user` having no signup.
- **An operator cannot wave a real quarantine through** — singly *or* in bulk. A fail-safe
  anybody may override is advisory, and this one is the last thing between a vendor name
  and a client's chat.
- **A rejection must SURVIVE the next poll, or it is a treadmill, not a decision.** Deleting
  the row would not: the feed still lists the item, so the next poll re-creates it within
  the hour. `archived` (already in the enum, "manually retired") is skipped by retrieval
  exactly like `needs_review`, and `ingestArticle` short-circuits on an unchanged
  `contentHash` *before* it would rewrite status — so the decision holds until the publisher
  genuinely edits the item, which is the one case worth re-reading.

###### `--approve-all --feed <id>` ignored the feed, and nothing in the DB could express it
It validated the feed id, then approved **every** pending shared article regardless of
origin — a flag that names a scope and does not apply it. With two shared feeds, vouching
for one publisher silently publishes the other's backlog. **Found by the live check, which
published all 10 real changelog items as a side effect**; reading the function did not show
it, because the scope was *unexpressible* — no column linked an article to its feed.

- `KbArticle.feedId` added (nullable, `onDelete: SetNull`). **SetNull, never Cascade:**
  removing a feed must not delete articles somebody already read and approved — at that
  point they are corpus, not the feed's property.
- **No backfill.** A row predating the column genuinely does not know its origin, and
  matching URL prefixes would *invent* provenance.
- **But the unchanged-poll path ADOPTS a missing link,** which is not inference: that poll
  is fetching that exact URL from that exact feed right now. Without it, rows ingested
  before the column existed could never acquire one (the content-hash short-circuit means
  an unchanged item is never rewritten) and would stay permanently unreachable from the one
  group action they need. It only ever fills a NULL — a later feed polling the same URL
  cannot steal an article from the feed that first brought it in.
- Verified live: **31 checks** (`scratchpad/verify-kb-review.ts`) — including two feeds
  proving A's backlog publishes without touching B's, the quarantine refused in bulk, the
  rejection surviving a re-poll, adoption not resurrecting review status, and an agency's
  held article being invisible *and* unreachable from the shared CLI.
  - Two checks were rewritten because they **passed for the wrong reason**: an absence
    assertion against CLI output is trivially satisfied when the CLI never ran, so each now
    carries a positive control (a known row that MUST be listed), and the helper throws on
    ENOENT rather than returning empty output.
  - The launch failure that exposed that: `new URL("..", import.meta.url).pathname` stays
    **percent-encoded**, and this repo lives under "GHL theme builder" — so the space became
    `%20`, the cwd did not exist, and every CLI call died ENOENT while reading as a normal
    test failure. Use `fileURLToPath`.

##### Crawling the full help centre is a LEGAL decision, not a technical one
`help.gohighlevel.com/support/sitemap.xml` is a flat list — **3,277 URLs, 2,854 of them
articles** — and `robots.txt` disallows only search/tickets/login/helpdesk while explicitly
advertising that sitemap. So `crawl-kb` would technically work today.
- **robots.txt permission is not a redistribution licence**, and the corpus was written by
  hand *specifically* to avoid this: "no crawl-legality question, no takedown story". Do not
  treat the green robots check as the answer to the question it does not address.
- **It would also invalidate the retrieval tuning.** `DEFAULT_MIN_RANK` and
  `MIN_LOOSE_TERM_HITS` were measured at 150 and re-checked at 253. At ~3,100 an off-topic
  question has an order of magnitude more chances to find two matching terms, and if the
  floor degrades then genuinely unanswerable questions **stop reaching a human** — the exact
  failure the two-pass retrieval exists to prevent, arriving from the other side.

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

#### "Voice and wording" turned the whole dashboard WHITE (2026-08-17)
Reported by the user, and it was not a styling glitch — it was a crash that unmounted the
entire React tree, leaving a blank page with nothing on screen saying why.

`SupportConfig.quickActions` is a **nullable Json column**, so a stored row hands back
`null`, while the no-row branch of the same handler correctly hands back `[]`. `api.ts`
declares `quickActions: string[]`. `ChipInput` called `.map` on it. Every agency that had
never set a quick question hit it — and that tab is the *only* place to set one, so the
crash was reachable by every agency, on the first click, forever.

- **TypeScript cannot catch this.** Every response crosses the wire as `any` and is
  asserted into its interface by `handle()`, so a declared type is a PROMISE the server
  makes and nothing checks it. That is the general shape, not a detail of this field.
- **Fixed at the SERVER**, not the call site: the declared type is the contract, and a
  caller that trusts it should be right. `ChipInput` also now absorbs a null (`value:
  string[] | null`) because it renders four fields and no form input is worth a blank page.
- **`scratchpad/verify-dashboard-shapes.ts` (21 checks) reads its field list OUT OF
  `api.ts`** rather than hand-listing it. Three times while writing it I asserted a field
  the contract does not claim — `presets[].hiddenFeatures` (presets are look-only by
  design) and `presets[].menuOrder` (declared `| null`, and the editor branches) — and each
  time it reported a correct server as broken. A hand-kept copy of a contract drifts from
  it, and a shape checker that mis-states the shape sends you to fix code that is right.
  It follows `extends`, so `ThemeConfig` inherits `VisualTheme`'s fields rather than being
  silently under-checked.
- **A positive control for the KB rows**, because with no agency-authored articles every
  `KbArticle` assertion reported "no rows to check" and the suite went green having checked
  nothing — the same trap as `verify-kb-review`. It plants an article, checks, deletes it.
- Confirmed to FAIL 2/19 on the pre-fix code, including the assertion that a NULL column is
  normalised before it reaches the browser — which is the only version of this check that
  fails, since reading the API alone goes green the moment somebody saves a quick question.
- **…and then the PARSER did it a fourth time** (found 2026-08-19, while sweeping after an
  unrelated change). The scan read every line of an interface body with one regex and no
  notion of depth, so a field inside an inline nested object was recorded as a **top-level**
  field. `SupportStats.handoffTypes.types` became a demand for `payload.types`, which has
  never existed — and the suite failed in red against a server returning
  `{total: 2, untyped: 2, types: []}` exactly as declared.
  - Worse than the three above, which were a hand-written list: this is the mechanism that
    was supposed to make a hand-written list unnecessary, and it would have done the same to
    **the next nested type anybody adds**. It also fails the suite's exit code, so it could
    gate a release on a lie.
  - **Nested fields are kept, not dropped** — they are real fields the dashboard maps over —
    and emitted as the dotted path `collect` already understood, with `[]` inserted when the
    literal closes as an array of objects. Coverage went up: `handoffTypes.types` is now
    checked at its real path, where before it was checked at a path that does not exist.
  - **A field under an OPTIONAL or nullable group is not a promise**, so nothing under one
    is claimed. The flat scan claimed them: measured on a synthetic fixture, it produced six
    phantom top-level fields, two of them from containers the server never guaranteed.
  - **The parser now self-tests before touching the network**, because the `}[]` branch has
    no live example in `api.ts` — every array-of-objects there holds only scalars — and an
    untested branch in a shape checker is how it mis-states a shape again. **21 checks**;
    confirmed to fail both self-checks when nesting detection is switched off.

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
- **Pre-deploy gate 1 (cheapest, run it first):** `npm run verify-deployable --workspace
  @ghl-theme-builder/server` — asks whether the code GIT HOLDS still builds. No database,
  no network, no build. See Deploy below.
- **Pre-deploy gate 2:** `npm run verify-migrations --workspace @ghl-theme-builder/server`
  — applies every migration to an empty scratch DB, the way Render will. See Deploy below.
- **Post-deploy gates:** `npm run readiness --workspace @ghl-theme-builder/server` — the
  states that boot clean and answer nobody (unseeded KB, unstaffed desk, unstaffed tier).
  Non-zero exit on a blocker; the server logs the same report at boot. Then
  `npm run smoke --workspace @ghl-theme-builder/server -- --base <url> …` for what only
  shows up over the network (a stale static build, an unprotected admin API, CORS).
- Create a support-desk account: `npm run create-desk-user --workspace
  @ghl-theme-builder/server -- --email a@b.c --name "Name" --role mosaic_admin`
- Ticket automations (nudges, response targets, snoozes, idle sweep): `npm run
  ticket-automations --workspace @ghl-theme-builder/server` (`-- --dry-run`). Scheduled by
  `.github/workflows/ticket-automations.yml`, not by anything in the server process.
- **Local dev needs `APP_PUBLIC_URL` to be `https://localhost:<port>`** — `env.ts` requires
  https, and `isProductionUrl()` then treats a localhost host as dev. A plain `http://`
  value fails the boot on the https rule, and the deployed host fails it on the
  `DASHBOARD_AUTH_ENABLED` rule, so both obvious values are refused for different reasons.
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
    The way to catch it is the dashboard's dry run ("Client support → Setup → Try it"),
    which now NAMES the cause — *"if all six answers are hand-offs, the key is missing"* was
    wrong in the case that actually happens, and is corrected below.
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

#### THE DEPLOY BUILDS FROM GIT, AND GIT DID NOT HAVE THE CODE (found 2026-08-19)
`npm run verify-deployable --workspace @ghl-theme-builder/server`. Run it **first** — it
needs no database, no network and no build, because it asks a question about the
repository rather than about a running system.

Render clones the repo and builds that. The working tree is not deployed. Measured on this
branch: **fifteen untracked source files**, and **eleven unresolvable imports** in what git
held — `services/ticketSla`, `slaStatus`, `businessHours`, `ticketTypes` on the server, and
`NewTicket`, `ChangePassword`, `queueReach`, `slaTone` in the desk. `tsc` and `vite` both
fail on the first one. The whole ticket-automation and SLA half of the desk, the two npm
scripts a GitHub workflow calls, and `.github/workflows/ticket-automations.yml` itself
existed on one laptop and nowhere else.

- **Nothing warns about this, in the one direction that matters.** Everything compiles
  here, every suite is green, 300+ checks pass — and the deploy fails immediately. It is
  the same root cause as the thirty harnesses written to a temp directory and never
  committed, which left every "verified live" claim in this file a dangling reference.
  Same mistake, expensive end: there the loss was evidence, here it is the build.
- **`verify-migrations` could not see it, because it reads the disk.** It applied 27
  migrations to an empty database and printed ✓ while git knew about 26. Measured by
  applying only the git-tracked set to a scratch database: `Conversation` missing
  **eleven columns** (`origin`, `ticketType`, `snoozedUntil`, `botPaused`,
  `lastReminderAt`, `slaBreachedAt`, `idleWarnedAt`, `contactEmail`, `contactName`,
  `createdByDeskUserId`), `SupportConfig` missing `slaFirstResponseMins`, and
  `accessTokenHash` still NOT NULL. Prisma selects every scalar by default, so that is not
  a degraded deploy — the desk 500s on any conversation query and the widget cannot open
  one. That gate now checks git tracking **both ways**: a migration on disk and not in git
  would be absent from the deploy, and one in git but not on disk would apply there having
  never been exercised here.
- **Three legs, each a different way to ship a hole:** an import nothing in git resolves; an
  npm script whose entry point is untracked (which fails on a GitHub Actions schedule
  nobody watches); and a workflow file that is never scheduled because the deploy has never
  seen it.
- **`git ls-files` reads the INDEX**, so staged-but-uncommitted counts as shipped — the
  right reading, since the next commit carries it, and the failure being hunted is a file
  nobody has told git about at all.
- **`dist/index.js` is exempt** and that exemption is the point: `start` runs a build
  artifact that is *supposed* to be absent from git. Without it the report carried one
  permanently wrong line, which this file records three times as the thing that teaches
  people to skim past the real ones.
- Verified both ways: it names all three failures on the current tree, and goes green
  (**134** source files, 2 workflows, every script) against a **throwaway git index** with the
  files staged — which also proves the remedy is exactly `git add`.
- **Re-run 2026-08-25: still 0/3, and now THIRTEEN unresolvable imports rather than eleven**,
  because two tracked files have since come to depend on the untracked `themeDefaults.ts`. An
  untracked module does not stay isolated; it acquires callers, so the gap widens on its own
  while every local suite stays green.
  - **RESOLVED 2026-08-27 — `verify-deployable` is 3/3 and `verify-migrations` is green.**
    The count had reached **seventeen** unresolvable imports by then, having grown on its own
    at every re-run while every local suite stayed green, which is the mechanism this note
    describes doing exactly what it predicts. The remedy was `git add`, as measured: 295 files
    known to git, 137 source files whose every relative import resolves, both workflows
    shipped, all 27 migrations applying cleanly from zero — including
    `20260818120000_desk_tickets_and_automations`, the one whose absence left `Conversation`
    eleven columns short. Nothing was committed or pushed; the index holds it.
  - **FIFTEEN by the end of the same day**, and the last two are the mechanism caught live:
    `services/transcriptVisibility.ts` was written that afternoon and imported by
    `routes/support.ts` and `services/email.ts`, both of which git DOES hold. So a commit of
    only the tracked changes would ship two files importing a module that does not exist —
    a NEW way to fail a build, created by an ordinary refactor into a new file. Nothing warns
    about it; `npm test` is 355/355 and every audit is clean. The remedy is still `git add`.
- **`verify-migrations` catches the same blocker independently, and names the worst file.**
  All 27 migrations apply cleanly from zero — generated column and GIN index both verified —
  and its ONLY failure is that `20260818120000_desk_tickets_and_automations` is on disk and
  not in git. That is exactly the migration whose absence this file already describes:
  `Conversation` short eleven columns, `SupportConfig` short `slaFirstResponseMins`,
  `accessTokenHash` still NOT NULL, so *"the desk 500s on any conversation query and the
  widget cannot open one"*. Two gates built for different questions, arriving at one cause.
  Both go fully green against the throwaway index, which is what makes "the remedy is exactly
  `git add`" a measurement rather than a hope.

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

### Three of the dashboard's four startup fetches failed in SILENCE
Found 2026-08-22, by blocking each endpoint in a real browser and looking at the result.
`App.tsx` loads four resources through `allSettled` for a stated reason — *"a failure in a
secondary one (presets, the default theme, support) must not blank out the sub-account
list, which is the core of the page"* — and then stops one step short: *"surface an error
only if the essential locations call fails."*

Not blanking the page and not mentioning it are different decisions, and only the first one
had been made. Measured, with the agency default, the presets, or the support config
failing: **ten rows, no banner, every control in place** — byte for byte a healthy page.

- **Each silence is a false statement in the agency's own terms**, not merely a gap: the
  default theme reads as *you have never set one*, and its editor then opens as though there
  were nothing there — a save from that state writes over a real agency-wide theme, which is
  the largest blast radius in the product (recoverable, because `AgencyDefaultThemeVersion`
  snapshots before every save, but not something to discover afterwards). The presets read
  as *you have no presets*. Support reads as **OFF**, because `supportOn` starts false — a
  false claim about the switch that decides whether the widget appears in front of their
  clients.
- **Named, not counted.** *"Some things didn't load"* tells somebody to worry without telling
  them what about. The banner lists the resources by what the reader would look for, and the
  support line says what the screen is now getting **wrong**, because a status dot reading
  "off" is worse than a blank one.
- **Amber, not red**, matching the split `App.tsx` already makes for an expired session: this
  is an instruction — reload — not a fault the reader caused.
- Verified live: **17 checks** (`scratchpad/verify-degraded-load.ts`), blocking each endpoint
  in turn. Every case asserts **both halves** — the page says what is missing AND the
  sub-account table is still fully there — because a fix that reported the failure by
  emptying the page would be worse than the silence it replaced. Confirmed to fail **7**
  under a mutation removing the report.
  - It also pins the guard that was already right: with no support config, the Plan cell is
    **disabled** rather than accepting a value it cannot save. A message beside a control
    that still looks usable is half a fix.
  - One of its own checks measured the wrong control first — "the first input in a row" is
    the Support toggle CHECKBOX, not the Plan box — and reported a working guard as broken.
    It now type-narrows and asserts it found one.
  - It navigates to `about:blank` between cases: returning to the same URL can be served
    from the back/forward cache, which would replay the previous case's render and make
    every assertion a statement about the run before it. And it clears the blocked-URL list
    in a `finally`, because a pattern left blocked on the browser target silently breaks the
    next driver and looks like a product failure.

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

### Login-page branding, and the tab whose failures landed on another screen
Eight `login*` columns on `AgencyDefaultTheme`, `renderLoginRules` in `themeCssBundle.ts`,
a `LoginPreview` beside the fields, and a **"Login page" tab shown only for the agency
default** — because there is one GHL login before any sub-account is chosen, so this is
agency-wide by nature and correctly has no per-location twin. Threaded end to end and
**undocumented in this file until now**, which is why it is written down here even though
most of it was already right.

- **Its delivery is UNCONFIRMED, like the sidebar-reordering flex assumption.** The rules
  ride the same `@import` the agency pastes into *Settings → Company → Custom CSS*, and
  whether GHL applies that sheet to the **login** page is a question no code here can
  answer. Recorded rather than assumed.
  - **`check-live-dom.js` can close it now** (2026-08-27). It used to bail on any page with
    no `#sidebar-v2`, which is every login page — so the note above correctly said the script
    could not help. It takes the login branch instead: sign out, or open a private window,
    load the login page, paste the same script.
  - **It answers TWO questions separately, because they fail differently and need opposite
    fixes.** Whether our stylesheet is loaded there at all — if not, the eight `login*`
    columns cannot work by this route whatever the selectors say, and no selector work will
    help. And whether each of `renderLoginRules`' selectors matches this markup — if the
    sheet is applied, it names the ones matching nothing and says the columns, the tab and
    the preview are already built.
  - Verified against two fixtures, one of each verdict, like the reordering half: a login
    page with a `/theme-css/` sheet linked reports **YES** and matches five of six
    selectors; the same page without it reports **NO** on the decisive line. A diagnostic
    that cannot report the failure it exists to find is worse than none.
- **The bytes are paid by every page whether or not it works.** `loginBgImage` is
  base64-inlined into a render-blocking stylesheet at up to 1600px, and it can only ever
  matter on a page its audience has already left.

#### Uploading on that tab failed silently, and the message was on a tab nobody was on
`handleLoginBgFile` and `handleLoginLogoFile` both reported failures through **`logoErr`**
— which renders inside the `tab === "branding"` block, while the controls live in
`tab === "login"`. The two are mutually exclusive, so the correctly-worded message went to
a screen the agency was not looking at: **the button appeared to do nothing at all**, and
switching to Branding later showed a stale error beside the wrong control.

- **Not a rare path.** `fileToDownscaledDataUrl` rejects on `img.onerror`, and
  `accept="image/*"` admits **HEIC** on macOS, which Chrome cannot decode. A login
  *background* is precisely where somebody uploads a photo straight off a phone.
- Its own `loginErr` slot now, rendered on its own tab — **not** the logo's, which is the
  whole bug.
- **And no cost readout**, alone among the uploads. The logo reports *"Uploaded 2000×1200px
  → stored at 512×307px as WEBP, 34.2 KB"* precisely because the cost has to be visible at
  the moment of the decision. The login background is downscaled to **1600px**, not 512, is
  typically a photograph rather than flat art, and is the single largest thing that can
  enter the render-blocking stylesheet — and it was the one upload that said nothing. Both
  login uploads now report format and KB.
- Verified by DRIVING it: the browser is handed a file that reads cleanly and does not
  decode (`new File([bytes], "hero.heic")` — the real case), and the driver asserts which
  tab is active *and* which errors are visible on it. Confirmed to report
  `{activeTab: "Login page", errorsVisibleOnThisTab: []}` on the pre-fix code — the silent
  failure, measured — against `["Could not load image"]` after.

##### The only way to upload an image was styled as a section heading
Third instance of the `.sla-row` specificity trap, found in the same render. A file input
needs a `<label>` to be clickable, so the control is a LABEL carrying `.btn` — and
`.field label` (0,1,1) beats `.btn` (0,1,0). Measured: **uppercase / 700 / muted grey /
0.36px tracking**, byte for byte the treatment of the "BACKGROUND IMAGE" heading directly
above it, while every real button beside it was `none / 600 / accent`.

Not cosmetic: an agency scanning that panel for a button saw **two headings and a URL box**,
and would reasonably conclude that pasting a link was the only option. It affects all four
uploads (logo, favicon, login background, login logo).

- **`label.btn` did not fix it, and that is the part worth keeping.** `label.btn` is (0,1,1)
  — a TIE with `.field label`, decided by source order, and `.field label` sits 130 lines
  further down. The first attempt changed nothing, and only re-measuring showed it.
  `label.btn.logo-upload-btn` is (0,2,1) and wins wherever it sits. The menu-order catch-all
  relies on source order deliberately; relying on it *here* would break the moment somebody
  reorders the stylesheet.
- **Pinned in the pixels, because nothing else can see it.** The driver now asserts every
  `.btn` in the editor renders with `text-transform: none` and reports any that don't
  (`buttons render as buttons: 6/6`). Confirmed to fail on the pre-fix rule, naming both
  labels. `audit-styles.js` was green throughout and always will be — its documented limit,
  reached for the third time from a third direction.

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

#### Escape threw the whole run away, under a comment saying it must not
Found 2026-08-19, by rendering it: the modal had never been looked at in a browser. Its
Escape handler read

```ts
// Never lose a long pasted list to a stray Escape.
if (e.key === "Escape" && !busy) onClose();
```

`busy` is false for the entire time anybody is *reading* the results, which is the only
moment the guard was for. Measured: a five-line pasted list vanished on Escape and
reopening gave an empty box; **a completed scan of five sites went the same way**; and a
backdrop click did both. The reasoning was written down and the code walked into it in the
same breath — the third time this file records that shape (`navigator.clipboard` and
*"blocked (silently rejects)"*; `renamedLabels` and *"only the renamed ones"*).

- **Third instance of the unguarded-exit bug specifically**, after the theme editor overlay
  and the support settings modal, and the sharpest of the three. Those risk typing you can
  redo. This risks a **sequential pass of fetches over other people's websites** — serial
  precisely so an agency does not get their IP blocked, so 41 clients is minutes — and
  redoing it means going back to every one of those sites.
- **The prompt names WHICH loss it is.** Unapplied scans and an unread list are different
  costs, and a warning that describes the wrong thing is one people learn to click through
  — the same rule the support modal's three-way message follows.
- **A run that has SAVED something is not dirty.** Those rows are in the database and
  closing costs nothing; nagging a finished run is how a guard gets trained out of people.
  A PARTLY applied run still is, because the unapplied scans are only on screen.
- **`bulkBrandDirty` is extracted**, same reasoning as `summariseBulk` and `slaTone`: it is
  a judgement a person acts on, and inline in a component it can only be checked by
  clicking — which is exactly how a modal with no guard on any of its three exits went
  unnoticed. 9 checks in `verify-bulk` (**30**).

##### …and the modal had an error banner nothing could ever fill
`setError` was called in exactly two places and both passed `null`, so
`{error && <div className="error-banner">}` was unreachable markup — the `audit-reach`
shape, inside a component where that audit cannot see it. Every failure went into the
per-row `note` instead, which means after applying to 41 sub-accounts the only report of a
partial failure was a red word in a scrolling list.

- **It now reports through `summariseBulk`**, the same summariser the bulk enable/disable
  uses rather than a second one written here. That buys both of its rules at once: state
  the SUCCESSES (*"38 of 41"* rather than *"3 failed"*, which leaves the reader wondering
  about the other 38), and pass a session expiry through **verbatim**.
- **The session expiry is the one failure with a remedy**, and it was the worst-served:
  buried per row as *"Missing or invalid dashboard token"* in 11px grey, which means
  nothing to an agency owner. It renders as the amber `.session-banner` here too — an
  instruction, not a fault — matching the split `App.tsx` makes on the same constant.
- The success line states the count as well: *"Applied to 12 sub-accounts"*, not *"saved"*.
- Verified by DRIVING the full cycle in `shoot-dashboard.mjs` — Escape raises the prompt,
  **Cancel keeps the list** (a guard that loses the work anyway is worse than none), a
  backdrop click raises it again, and Discard genuinely closes. Confirmed to fail under a
  mutation that sends the exits straight to `onClose`: the driver throws *"Escape discarded
  the list with no prompt"*.

##### …and the THIRD copy of that default was the tool that writes forty-one at once
Found 2026-08-25, by asking which other code hardcodes a theme colour. `lookFrom` was fixed
above and `themeDefaults.ts` extracted so the editor reads the server's chain. `mergedTheme`
in `bulkBrandLogic.ts` — the payload "Brand from websites" PUTs for every sub-account it
touches — still carried its own:

```
accentColor: existing?.accentColor ?? "#f59e0b"
primaryColor: existing?.primaryColor ?? "#4f46e5"
```

It is complete on purpose, because `visualFields` resets any column the payload omits. What
it got wrong is that **"everything they already have" has to include not having chosen a
colour.**

- **A scan can find a brand colour and no accent, and that is ordinary.** `brandScan`'s own
  doc says a result *"may have only themeColor, only an image, or …"*, and `paletteFromImage`
  returns null on a logo the browser will not decode. `BulkBrand` then spreads
  `...(row.accent ? { accentColor: row.accent } : {})` — so on those rows the key is absent
  and the amber goes in unasked. Measured, `resolveAccentColor` reading what was stored:

  | starting state | scan found | stored `accentColor` | active menu item painted |
  |---|---|---|---|
  | no theme at all | colour only | **`#f59e0b`** | **`#f59e0b`** |
  | no theme at all | colour + palette | `#14b8a6` | `#14b8a6` |
  | branded teal, accent never set | colour only | **`#f59e0b`** | **`#f59e0b`** |

- **The third row is the compounding one.** "Branded teal, accent never set" is precisely
  what a PREVIOUS bulk brand leaves behind, so running the tool twice — onboarding, then a
  rebrand — is what writes the amber over the client's own colour.
- **Its own suite had a check that could have caught this and asked the wrong question.**
  *"a brand-new sub-account still gets a complete payload"* asserted only that no field is
  `undefined`, which a colour nobody chose satisfies perfectly. **Complete is not the same as
  true**, and that is how the section passed over this for the life of the feature.
- Fixed by removing the literals: an unset colour is `""`, the same thing the editor stores
  for a cleared field and what `renderRules` reads as "fall through to the primary".
- Verified: `verify-bulk` grew 30 → **40 checks**, reading `resolveAccentColor` — the
  established single definition, which `verify-preview-truth` already asserts against the
  real `renderRules`, rather than inventing a fourth opinion. Confirmed to fail **7** under a
  mutation restoring the two hex literals.

##### The sidebar-icon field promised a default the stylesheet does not have
Found in the same sweep. `LookFields` drew that swatch as
`sidebarIconColor || accentColor || "#f59e0b"` under a hint reading **"Defaults to the accent
color."** `renderRules` emits the icon filter **only** `if (theme.sidebarIconColor)` — there
is no accent fallback anywhere in the bundle.

So an agency with a teal accent saw a teal swatch, the hex printed beneath it, and a sentence
saying that is what the icons do. The icons were GHL's own grey. Measured on the dev agency,
whose accent is `#4f46e5`: the row read `#4f46e5` and the stylesheet emitted no `filter:`
rule at all.

- **Saving never made it true**, which is what separates this from the four rows above it.
  `lookFrom` materialises `topBarColor`, `buttonColor`, `scrollbarColor` and
  `sidebarTextColor`, so those become real on the next save — the over-materialisation this
  file already recorded and accepted. It leaves `sidebarIconColor: ""`, so this row would
  have shown a borrowed colour for ever.
- **This is `LoginPreview`'s defect on the branding tab**, one day later: an
  `<input type="color">` cannot be empty, so "not set" renders byte for byte like "chose
  this". `ColorRow` gained the same treatment its login twin got — a hatched swatch, the
  words **not set**, and a Clear button, because picking the same colour again fires no
  change event and without Clear an accidental choice is permanent.
- **The hint was corrected rather than the server.** Making the icons default to the accent
  would repaint every existing sub-account's sidebar from a render-blocking stylesheet on a
  guess — the fallback this file refuses for menu reordering. The hint also argued with
  itself: *"Defaults to the accent color. Leave default to skip."*
- Measured for context and deliberately NOT changed: on a sub-account branded in bulk
  (colours found, nothing else set) the editor shows **five** colour rows and the stylesheet
  emits a rule for **none** of them. Four of those are the `lookFrom` decision already
  recorded; only the icons could never be made true by saving.
- Verified: `verify-preview-truth` 26 → **31 checks** — no icon rule with the field unset, one
  with it set (a fix that kills the feature is not a fix), and the source no longer resolving
  through the accent. **And asserting the resolver proves nothing about the row**, so
  `shoot-dashboard.mjs` reads it out of the DOM: whatever this agency has stored, the row must
  say WHICH it is and the swatch and Clear button must agree — then pick `#112233` (reads the
  hex, un-hatches, Clear appears) and Clear (back to `not set`, hatched). Measured on the dev
  agency: `{"reads":"not set","hatched":true,"hasClear":false}`, then `#112233`, then back.
- Confirmed to fail **2** at the source level, and the driver **throws** under the same
  mutation, reading the pre-fix state off the real screen:
  `{"reads":"#4f46e5","hatched":false,"hasClear":false}` under *"Defaults to the accent
  color."* — the agency being told, in the hex, that the icons are their accent while the
  bundle emits no icon rule at all.
  - Four earlier attempts at that control ended in the driver's **zero-row guard** firing
    instead: the local Postgres container dropped nine times in this session. That is the
    guard doing its job — the step refused to report readings taken from a blank page — and
    it is worth knowing it looks identical to a product failure until you check `/health`.

###### …and the PREVIEW beside it told the same lie
`MosaicPreview` painted its glyphs `look.sidebarIconColor || look.accentColor` — the fourth
place with its own idea of what a theme looks like, and the one an agency actually stares at
while deciding. Fixing the field's wording alone would have left the mock sidebar still
showing accent-coloured icons next to a row saying *not set*.

- **Unset means "the colours they came with"**, which in a mock with no GHL icons is the tone
  of the labels beside them. Measured after the fix: icon `rgb(255,255,255)`, label
  `rgb(255,255,255)`, accent `#4f46e5`; picking `#112233` paints `rgb(17,34,51)`.
- Confirmed to fail in the browser under a mutation restoring the borrowed accent — the
  driver throws with `icon: rgb(79,70,229)` against `label: rgb(255,255,255)`, which is the
  defect stated in the two numbers.
- **The rest of the pair was compared while I was there, and came out clean**: the gradient
  needs a colour on both sides (the login tab's bug, checked here), the three button-shape
  radii agree (`0` / `10px` / `999px`), and unlisted menu items sort LAST in both — the
  disagreement already recorded and fixed. `verify-preview-truth` 31 → **38 checks**.
- **Four rows of the editor CANNOT be in this state and one deliberate omission remains.**
  `lookFrom` materialises `topBarColor`, `buttonColor`, `scrollbarColor` and
  `sidebarTextColor`, so their `||` fallbacks in the preview are unreachable — which is why
  the icons were the only live one. The preview also ignores `sidebarImageUrl` entirely: it
  under-shows rather than contradicts, so it is recorded here rather than changed.

###### The driver only put back what it broke when nothing went wrong
Caught by that mutation run. `shoot-dashboard.mjs` types into a real agency's Plan column,
and the restore added earlier this session ran at the END of the script — so the one run
that threw part way left the screenshot script's test value sitting in the agency's plan
map. **A restore that only happens on the happy path is missing exactly when it is
needed.** It is a function now, called on the normal path and armed on
`unhandledRejection` / `uncaughtException`, and it prints what it restored. Proven by the
mutation: the run exited 1 and still printed `plan map restored: {}`. (Those two were not
enough — see the signal note below, which cost the same column six days later.)

The step also had to move **before** the theme-editor and upload steps. Those leave the
editor overlay open and a native **file chooser** up, and a file chooser blocks the
renderer exactly as `confirm()` does — so an `evaluate` after it never returns and the
script dies on an unsettled top-level await, which reads as a hang rather than a
mis-ordered driver.

###### A `pkill` is not an `uncaughtException`, and it cost a real agency's plan map
Recorded because I did it. Two `shoot-dashboard` runs were started against one browser target,
fought over the same page, and I killed them — and `pkill` bypasses the
`unhandledRejection`/`uncaughtException` handlers the restore was armed on. The step's own
test value, `"Enterprise Enterprise Enterprise…"`, was left sitting in `planTiers` on a live
sub-account: the column that turns *"isn't part of your setup"* into *"isn't included on your
Starter plan"* in a client's chat.

- Restored by round-tripping the GET's `config` through the PUT — whole-object, so reading it
  back first is what stops the restore deleting the greeting and the escalation address.
- The driver now arms `restorePlans` on **SIGINT/SIGTERM/SIGHUP** as well, which is the same
  lesson `verify-kb-states` records for its fixtures. Ctrl-C is how a driver usually dies.
- **Seventh instance of a harness writing over the user's own data**, and the first through a
  signal rather than a code path.


### "Apply preset" meant two different things, and one of them deleted the banner
Found 2026-08-25, by asking which fields the bulk preset-apply route carries forward. This is
the one action in the product that rewrites MANY clients' themes at once, and it is the only
one with **two implementations**: `ThemeEditor.applyPreset` for a single sub-account, and
`POST …/presets/:id/apply` for however many are selected. Three defects, all measured against
the live routes before anything was changed:

- **Bulk apply DELETED the sub-account's announcement banner.** The route hand-lists what it
  keeps and its own comment names that list — *"keeps the client's identity (brand name, logo,
  hidden/renamed menu items, custom CSS)"* — while `alertMessage` and `alertColor` were simply
  not on it. `createThemeVersion` writes what it is given, so an unlisted column is written
  NULL. Apply a colour preset to twenty sub-accounts and twenty banners vanish: a client-facing
  message, gone, with nothing on any screen saying so and the History tab the only way back —
  once per sub-account. The same shape as `planTiers` and `slaFirstResponseMins`: a column
  added to the model and to one path, never to the other.
  - **The theme PUT had the identical gap one screen up.** It carries client-owned fields
    forward for any key the body OMITS, *"so a partial PATCH from some other client can't
    silently null out the logo, hidden features, labels, or order"* — and the banner was not on
    that list either. Both lists were written before the banner existed and neither was
    rechecked when it arrived. `clientOwnedFields()` is now the single named set.
- **The two paths disagreed about `menuOrder`, and their comments contradicted each other.**
  The server: *"Menu order is structural, not part of a color preset - keep the sub-account's
  existing order instead of wiping it."* The editor, four files away: *"Presets can carry a
  saved sidebar order; apply it if present."* Both confident, both shipped. So the same preset
  through two doors produced two different sidebars, and the door an agency uses for
  forty-one clients was the quietly different one. `ThemePreset.menuOrder` was stored on every
  save and read by exactly one of the two consumers.
- **An EMPTY array was read as an instruction to CLEAR.** "Save as preset" sends
  `{...look, menuOrder}` unconditionally, so a preset made from a sub-account nobody had
  reordered stored `[]` — and both readers tested `Array.isArray`, which `[]` passes. So the
  ORDINARY preset, the one an agency makes by opening any client and picking colours, wiped
  the target's own sidebar order when applied in the editor. **The `Number("")` trap in an
  array costume**, on a field the client sees, and the fourth place this file records it after
  `maxConcurrent`, `slaFirstResponseMins` and `supportEnabled`.
- **Fixed by making one rule and giving it a name.** `presetMenuOrder()` answers "does this
  preset carry an order" — non-empty or nothing — and both paths read it, so a preset that
  really was saved with an order now applies it in bulk exactly as it always did in the
  editor. `presetLookFields` stores `null` rather than `[]`. **No backfill**: the rows written
  before today are harmless once both readers agree, and the suite plants one to prove it.
- **And the reorder is named before the click**, not discovered afterwards. A preset is
  understood as colours; reordering somebody's menus is not what "apply preset" sounds like.
  The toolbar says *"This preset also sets the sidebar order (N items)"* beside the button —
  a line, not a dialog, because a confirm on the non-destructive direction is how people
  learn to click through confirms. Same rule as bulk disable naming how many sub-accounts are
  on another page.
- Verified live: **33 checks** (`scratchpad/verify-preset-apply.ts`) against the real routes on
  a throwaway agency of its own, and confirmed to fail under **five** separate mutations — 4
  when the banner is dropped from `clientOwnedFields`, 2 when bulk apply ignores the preset's
  order, 1 for each half of the empty-array rule, and 2 when the PUT stops carrying the banner
  through a partial save.
- **One harness fault worth recording, because it reported a real route as broken.** It sent
  `customCssOverride` in the PUT — the COLUMN name. The payload key is `customCss`, an alias
  this file already documents (`audit-fields.js` knows about it). So nothing was stored, and
  the suite then blamed the bulk apply for losing what had never been there. A harness that
  writes through the wrong key measures its own bug.


##### …and the History tab could not restore the favicon
Found 2026-08-25, by asking where the per-location restore ROUTE is. There isn't one, and that
is deliberate — the History tab loads an old version back into the form and Save writes a new
one, so history stays append-only and *"a restore is itself an auditable version"*. The cost of
that design is that `loadVersion` and the save payload are **two lists of the same fields**,
forty lines apart in one file, and anything on one and not the other is silently not restored.

`faviconUrl` was on the save list and not the load list. So restoring version 12 gave you
version 12's colours, brand name, logo, renames, hidden features, menu order, custom CSS and
banner — **and today's favicon**, then wrote it over the version being restored on save.

- **History was the only place a replaced favicon could come back from**, and it was the one
  field history could not return. Third time this file records that exact column: it shipped
  with *neither* half built, then with the API silently dropping it, and now with the restore
  unable to load it. A field that has been wrong three times in three different layers is
  telling you something about how it gets added.
- Measured in a real browser against a throwaway agency with two versions: after clicking
  **View** on the older one, the brand name read `Harbour Suite` (old) and the favicon box
  still read the NEW url.
- **Fixed structurally, not just by adding the line.** `verify-history-restore.ts` reads the
  SAVE PAYLOAD's keys out of `ThemeEditor.tsx` and requires each to be read from the version
  row inside `loadVersion` — with `lookFrom(v)` accounting for the Look fields, `secondaryColor`
  exempt (a dead column `audit-fields` already reports every run), and `login*` exempt because
  the agency default's history restores through a server route and never through this
  function. Proven to generalise: dropping `setSidebarImageUrl` instead makes it name
  `sidebarImageUrl`.
- Verified live: **24 checks** (10 for the restore itself), and confirmed to fail **2** under
  the mutation that removes the fix — one structural, one in the browser, **independently**. Neither would have been enough
  alone: the source check cannot see whether the form actually updated, and the live check
  covers only the fields it happens to assert.
- **Two controls, on two different tabs.** The banner is asserted as well as the favicon, and
  it lives on Advanced while `loadVersion` lands on Branding — so "the form reloaded at all"
  and "this particular field reloaded" cannot be confused, which is exactly how the favicon
  hid behind everything else looking right.

##### There were TWO history lists, and they disagreed about the ordinary row
Found 2026-08-26 by a sweep for theme-colour literals in the editor that the server never
emits — which turned up `#cbd5e1` next to `v.primaryColor`, and CLAUDE.md's own claim one
section up that *"a version with no colours set shows no swatches, honestly, rather than
inventing a placeholder."* True of one list. There are two, seventy lines apart in
`ThemeEditor.tsx`:

```
per-location    [primary, accent, topBar].filter(Boolean)   -> nothing when nothing is set
agency default  primaryColor ?? "#cbd5e1"                   -> ALWAYS a swatch, grey if unset
```

- **"No colours" is not an edge case, it is the ordinary row.** Measured on this database:
  of the newest per-location versions, every one carries a brand name and **not one carries
  a colour**. So the agency-default list would have drawn an identical grey square on every
  row — implying somebody had chosen grey, and making the rows indistinguishable, which is
  the exact problem swatches were added to solve.
- **On the list with the largest blast radius in the product.** This file already argues
  that `AgencyDefaultThemeVersion` exists because that row *"styles EVERY sub-account at
  once"* and had the smallest safety net. Telling two versions apart matters more there, not
  less — and the honest renderer went to the other list.
- **`??` where the sibling used `filter(Boolean)`.** A cleared colour is stored as `""`, so
  `??` passed it straight through and produced `linear-gradient(135deg, , )` — invalid, so
  the parser drops the whole declaration and the row shows an **unexplained blank box**
  rather than saying nothing. Two different wrong answers for the two ways a colour can be
  absent.
- **The payload disagreed too, so the drift was in three places.**
  `GET /default-theme/versions` returned `primaryColor` and `accentColor` and not
  `topBarColor` — so even a correct renderer could only ever have shown two of the three the
  other list shows. One renderer needs one field set.
- **It had NEVER been rendered with data**: this database holds **zero**
  `AgencyDefaultThemeVersion` rows, so every look at that tab has been the empty state. Same
  shape as every other find this week — a surface nobody had put data in front of.
- Fixed with one `VersionSwatches`, read by both lists. Nothing rather than a placeholder,
  because that is the decision the sibling list already made deliberately.
- Verified live: `verify-history-restore` 10 → **24 checks**, planting the four shapes a real
  row takes and reading the rendered DOM:

  | stored | swatches | background-image |
  |---|---|---|
  | nothing set | 0 | — |
  | primary only | 1 | none |
  | primary + accent + top bar | 3 | none |
  | primary and accent **cleared** (`""`) | 0 | — |

  Confirmed to fail **7** under a mutation restoring the second renderer, and **2** under one
  dropping `topBarColor` from the endpoint — the latter failing in **both layers
  independently**, the payload check and the rendered swatch count, so neither would have
  been enough alone.

#### Reset deletes the History tab, which is the safety net the History tab IS
Found 2026-08-25, immediately after the preset work, by asking what else writes theme
versions. `DELETE …/locations/:loc/theme` runs `themeConfig.deleteMany({ locationInstallId })`
— **every version, not the current one** — so the sub-account's History tab is emptied and
there is nothing to restore from.

That is precisely the asymmetry `AgencyDefaultThemeVersion` was built to remove, pointing the
other way. Its own note argues: *"This row styles EVERY sub-account at once, so it has the
largest blast radius in the product and had the smallest safety net: no history at all, while
a single sub-account's theme has a full History tab."* The agency default was then given a
snapshot before every save **and before Reset**. The sub-account's Reset button was never
looked at, and it destroys the net it was being compared against.

- **Measured on this database: `190 Ranch` was carrying 30 saved versions and `711 MBS` 28**,
  behind a confirm that said only *"Its custom theme will be removed."* One misclick on a
  small ghost button next to Edit, and thirty saved states of a real client's branding are
  gone — the logo, the renames, the hidden features, the menu order, the banner, every version
  of them.
- **The delete itself is RIGHT and was deliberately left alone.** A blank version is not the
  same as no version: `themeCssBundle` renders any row that exists, so an "empty" theme would
  paint the default `#4f46e5` primary instead of letting the sub-account inherit the agency
  default. Reset must genuinely remove the rows. **The dialog was the thing that was wrong**,
  and saying so is cheaper and truer than redesigning the model around a confirm string.
- **The count is in our own database and is exactly what decides whether somebody clicks.**
  The listing now returns `themeVersions` — **one `groupBy` for the whole list, never a query
  per row**, the `heldCountsFor` rule — and the confirm reads *"This removes its theme and all
  30 saved versions — the History tab will be empty, and this cannot be undone."* Same rule as
  the desk naming how many tickets a Disable releases, and as bulk disable naming how many
  sub-accounts are on another page.
- The route returns `versionsDeleted` too, so a caller can report what actually went rather
  than a success that reads the same whether it dropped one version or thirty.
- Verified live: `verify-preset-apply` grew to **33 checks** — the listing's count matches the
  table, the delete removes exactly that many, and the listing agrees afterwards.
- **And asserting the count proves nothing about the dialog.** `shoot-dashboard.mjs` opens the
  real Reset confirm on the real 30-version sub-account, reads it, and **cancels** — confirming
  it there would destroy a client's branding history to take a screenshot, which is the
  harness-writes-over-the-user's-data failure this file already records six times. It captured:
  > Reset "190 Ranch" back to the agency default look? This removes its theme and all 30 saved
  > versions — the History tab will be empty, and this cannot be undone.
  and asserts Cancel closes it, because a step that leaves a modal up disables the next one.

##### A driver step that reports a reading from an empty page
Caught in the same run, and it is the third instance. Docker had stopped, the dashboard
rendered **zero sub-accounts**, and the new Reset step printed
`{"ran":false,"reason":"no Reset button — no sub-account has a theme"}` — a true sentence about
a blank page, and a completely misleading one. Every step below it would have described
nothing while looking like a measurement.

The driver now **throws** if the table renders zero rows, naming the datastore rather than the
page. Same shape as the New-ticket step that reported `backdrop position: none` from a screen
that never opened.
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
- Verified: **12** checks (`scratchpad/verify-bulk-enable.ts`). One check was **deleted rather
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
- **Feeds were invisible to it, and every way they fail is silent** (added 2026-08-17).
  Polling is an external script by design — the free instance sleeps, and two instances
  would race the same upserts — and the cost of that decision is that NOTHING in the
  request path can notice it stopped. The bot keeps answering, fluently, from whatever it
  learned last; a confident stale answer is worse than a hand-off. Four findings:
  `feed-never-polled` (configured but nothing schedules it — the state a fresh deploy is
  in), `feed-stale` (>7 days: the scheduler died, which looks exactly like a publisher who
  went quiet), `feed-disabled` (auto-disabled after 10 failures), `feed-review-backlog`
  (items that passed every gate and wait on a human who does not know they exist).
  - **A SHARED feed is the sharp case and the reason this belongs here.** An agency's own
    feed surfaces its error on their "Your content" tab; a shared one belongs to no agency,
    so **no screen in the product displays it, ever**. Same root cause as the write-only
    review queue — shared content has no owner, so no per-tenant surface covers it.
  - **NOT gated on the support switch, and the first version was.** With feeds inside
    `if (supportEnabled)`, a deployment holding a real feed, a ten-item backlog and no
    scheduler reported *"all checks passed"* — verified on the actual dev database. Creating
    a feed row is a deliberate act meaning "keep this corpus current", unlike an env var
    that is merely absent by default, so severity follows that intent rather than the master
    switch. The live check proves it by turning support back OFF, because by that point in
    the suite an earlier section has switched it on — which is exactly how the first version
    of the check passed while asserting nothing.
  - **`feed-never-polled` has an age window.** A feed added an hour ago has legitimately not
    polled yet; without the window the check trips the moment anybody adds one, and a check
    that cries wolf on correct behaviour is worse than absent.
- Verified live: **40 checks** (`scratchpad/verify-readiness.js`) — each finding driven by
  real database state and asserted to appear **and** disappear, because a readiness check
  that is itself wrong reports green over precisely the failures it was written for. Run it
  with `npx tsx`, not `node`, and see the note below for why.

##### SEVEN suites were testing the last BUILD, not the code
Found 2026-08-26 by running every suite rather than the ones I had touched — the rule this
file already records finding two real bugs. `verify-readiness` came back **33/1**, and the
failure was not what it looked like.

**The failing check was the suite's fault, and its neighbour was worse.** Three feed findings
were asserted against the GLOBAL finding list, and these findings are deployment-wide. This
deployment has one real feed — the GHL changelog, shared, last polled the day the scheduler
stopped — so `feed-stale` fires on every run:

- the NEGATIVE check (*"a disabled feed is not ALSO reported as stale — one problem, one
  line"*) failed, reporting a true readiness line as a product defect;
- the POSITIVE one four lines above it (*"a feed not polled in over a week is reported"*)
  **passed for the wrong reason** — the neighbour's staleness satisfied it, so it would have
  gone green with the fixture's staleness undetected entirely.

Both directions of the same mistake, four lines apart. **Ninth instance** of a suite that can
only be right on a database nobody has used — and `verify-readiness` is the suite this trap
was already fixed in once, on `supportEnabled`: the fix went to the finding in hand and not
to the one beside it. Every feed assertion is now scoped to the fixture's own URL, and the
baseline is **printed** (`feed-stale=already firing`) so the reader can see why.

**Then the mutations wouldn't fail, and that was the real find.** Two deliberate mutations to
`readiness.ts` — dropping the `f.enabled` guard from the stale filter, and moving the window
to 70 days so staleness is never detected — both left the suite **34/34 green**. The suite
imports `apps/server/dist/services/readiness.js`, and it only ever refused when `dist` was
ABSENT. A stale one it imported happily. The build was a day old.

- **Six more suites had the same import**, and two of them cover security claims:
  `verify-ssrf` → `feedPoll`, `verify-webhooks` → `tokenCrypto` + `webhookEvents`,
  `verify-session` → `dashboardAuth`, `verify-offboard` → `readiness`,
  `verify-kb-authoring` → `kbNormalize`, `verify-reinstall` → `ghlClient` + `locationSync`.
  Every one was asserting about whatever was there at the last `npm run build:server`. Today
  that build predates six of this session's server changes and both new modules.
- **All seven now import the SOURCE under tsx** (`npx tsx scratchpad/<name>.js`, not `node`),
  and each is unchanged in count: 34, 24, 30, 13, 26, 27, 37.
- **The `dist/assets` reads elsewhere STAY**, and the distinction is the whole point:
  `verify-paste`, `verify-session` and `verify-bulk-enable` grep the SHIPPED browser bundle
  because that bundle is the artifact under test — `VITE_API_BASE_URL` is compiled in, so
  reading the source would answer a different question. Reading a compiled server module
  answers the same question worse.
- **A freshness check was the first fix and was thrown away.** Comparing `dist` mtime against
  `src` mtime fires correctly here — and also fires after any `cp` restore, which changes an
  mtime without changing a byte. A check that goes off on correct behaviour is the thing this
  file keeps recording as worse than absent. Reading the source removes the question instead
  of policing it.
- Confirmed both ways on `verify-readiness`: **34/34 green through `dist` under both
  mutations**, and **33/1 and 32/1 through the source**, each caught by the check written for
  it. The other six are the identical import pattern, changed by inspection and re-run.
- **And the "one problem, one line" check had never tested the guard.** Its fixture set
  `lastPolledAt: new Date()` in the same update that disabled the feed, so the feed was not
  stale by the clock either — removing `f.enabled` from the filter could not double-report
  it. Nine days now, so the guard is genuinely under test.

#### A harness fixture that outlives its run is a LIVE desk credential
Found 2026-08-26, from the desk sweep: two accounts sitting `active` on this database,
`reauth-ada-…@mosaic.test` and `reauth-bo-…@mosaic.test`, left by a run the tooling had
killed at a 120-second timeout.

`verify-desk-reauth` is one of the two desk suites that DOES arm its teardown on
SIGINT/SIGTERM/SIGHUP — and a **SIGKILL honours none of them**, so the handler that exists
is the handler that did not run. Nine suites create desk accounts; seven arm nothing at all.

- **The stakes are not a stray row.** Every desk account can read every agency's support
  conversations — that is the whole reason there is deliberately no signup — and each suite
  signs in with a password that is a **constant in this repository**. A leftover is a live
  credential to the entire support corpus, `active`, with a known password.
- **A per-run stamp is not the fix here.** `verify-kb-states` learned to stamp fixtures so a
  leftover cannot be matched by a later run, and that is right — but it makes leftovers inert
  to the SUITES and does nothing at all about them being usable accounts.
- **So readiness reports them, which is the durable half.** `harness-desk-accounts` names any
  ACTIVE account whose email domain ends `.test`, `.invalid` or `.example`. Those are
  RESERVED by RFC 6761 and 2606 — the same argument `env.ts` makes for `.localhost` — so this
  is a rule rather than a guess: nobody creates a real account there. It is exactly the
  charter: nothing throws, nothing in the request path can notice, and no screen in the
  product would ever mention it.
- **Disabling clears it, deleting clears it, and the fix line says both** — one of these on a
  dev box is `local-setup.js`'s deliberate login, and a finding that calls a deliberate thing
  a fault is one people learn to skim.
- Verified: `verify-readiness` 34 → **40 checks**, asserting the account is named BY NAME
  rather than that the finding fired — the neighbour's-data trap again, four checks after the
  feed one. It also asserts that **disabling** clears it. Confirmed to fail **4** under a
  mutation that stops the finding firing.
- The two stale accounts were deleted, and the finding is what surfaced them.

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
- **It probes the admin API with a FABRICATED agency id when `--agency` is omitted**, which
  is only a valid probe because the token is now checked before the agency is looked up —
  see the oracle note in Auth. Until 2026-08-20 a correctly protected deploy answered 404
  here and this gate called it broken.
- Pointed at localhost it fails exactly twice — unauthenticated admin API, unsigned
  webhooks accepted. Those are the two settings `env.ts` makes fatal in production and
  optional in dev, so that is the check demonstrating it discriminates, not a defect.

##### The verification suites lived in /tmp and were never committed (fixed 2026-08-17)
Every "verified live: N checks" claim in this file cites `scratchpad/<name>`, and until now
**not one of those files was in the repo**: `git ls-files scratchpad/` returned zero, and
`git log -- scratchpad/` was empty. They were being written to the session's temp directory
under `/private/tmp/…`, so the paths in this document were dangling references and the
whole evidence base — ~30 harnesses, several hundred checks — was one temp sweep from gone.

Nothing would have announced it. The suites are run by hand, so their absence surfaces only
when somebody goes looking for the regression protection this file promises, which is
exactly the moment it is needed and too late to recreate. `scratchpad/` was never in
`.gitignore`; it simply never got added.

- All 40 scripts are now in the repo, and the audits were re-run **from the new location**
  to prove they still work there rather than assuming a copy is a move.
- **Write new harnesses to the repo's `scratchpad/`, not the session temp directory.** The
  claim "verified live" is only worth writing down if the next person can re-run it.

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

###### …and three desk suites still read a 429 as a security regression
Found in the same sweep. CLAUDE.md's own note on this trap names four suites that went quiet
when the login bucket was exhausted — `verify-desk-session`, `verify-desk`, `verify-routing`,
`verify-delivery`. `verify-routing` was hardened, and the other three were not.

`verify-desk-session` is the worst of them, because it does not go quiet. Reproduced
deterministically by firing twelve logins first:

```
  FAIL  login succeeds                                              429
  FAIL    -> the session cookie is HttpOnly, so an XSS cannot read it
  FAIL    -> and SameSite is set, since desk and API are different origins
  FAIL  /me accepts the cookie                                      401
  FAIL  an admin can disable them            401 {"error":"Not signed in"}
  13 passed, 4 failed
```

Every one of those reads as a real defect — an httpOnly flag that stopped being set, an
authorisation check letting an admin through as unauthenticated — and all of it is one rate
limit. It now throws with the cause and the remedy instead, like `verify-session` and
`verify-offboard` already do. Confirmed by burning the bucket on purpose:

> `rate-limited by /desk/api/login (10/min per IP), not a product failure. Another desk
> suite ran in the same minute — wait one and re-run.`

`verify-delivery` already threw, but its message was `desk login failed: 429` — a status code
the reader has to interpret, which is the thing readiness's `fix` field rule exists to
prevent. It names the bucket now.

###### What the full sweep found, and what it did not
Twenty-eight suites run end to end on 2026-08-26, everything not needing a model:

```
verify-css-injection 29   verify-preset-apply 33   verify-bulk 40      verify-bulk-enable 12
verify-preview-truth 38   verify-themecss-cache 13 verify-favicon 7    verify-order 7
verify-fallback 4         verify-webhooks 37       verify-reinstall 13 verify-readiness 34
verify-ssrf 26            verify-bundle-config 14  verify-dashboard-shapes 21
verify-support-switch 21  verify-keepwarm 22       verify-crawl-guards 28
verify-icon-filter 15     verify-undo 14           verify-widget-poll 18
verify-paste 34           verify-embed-copy 25     verify-degraded-load 17
verify-kb-review 31       verify-kb-states 30      verify-feeds 24
verify-desk 38            verify-routing 53        verify-tickets 74   verify-delivery 23
verify-handoff-email 28   verify-staff 29          verify-stats 31
verify-desk-session 17    verify-desk-password 16  verify-desk-reauth 28
verify-history-restore 24
```

- **Two findings, both in the harnesses rather than the product**, which is the honest
  outcome and worth stating: the `dist` imports above, and the 429 blindness. The product
  itself came back clean everywhere it was asked.
- **The model-dependent suites are a separate story.** `verify-plan` reports 18/1 and
  `verify-dryrun` now throws by design, both because the OpenAI account is out of credits —
  see the dry-run note. Reading either as a product failure is exactly what that fix exists
  to prevent.
- **Space the desk suites about a minute apart.** Seven of them sign in, `/desk/api/login` is
  10/min per IP, and running them back to back is what produced the false security failures
  above.

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
  - **`scratchpad/check-live-dom.js` closes it in thirty seconds** (added 2026-08-18):
    paste it into the browser console on a live sub-account page. Nothing is sent
    anywhere — it reads the DOM and prints a table.
  - **It does not infer, it MEASURES.** Reading `display` would only tell you what the
    computed style says; the decisive check actually sets `order: 999` on the first nav
    link and asks whether the browser moved it. It also checks that the links are DIRECT
    children of the nav, because a flex nav that wraps each link in a `<div>` makes our
    per-link rules target grandchildren — the same no-op through a different door, and
    one a `display` reading would call fine.
  - **It now answers the CONTENT-AREA question too** (2026-08-27), by the same method:
    it paints `body` magenta and reports which ancestors are covering it up, finding the
    content as the largest block that is not the sidebar and not the header rather than by
    guessing a class. `CONTENT_SELECTOR` deliberately contains no invented GHL class name,
    so this is the one measurement that turns it from a safe default into a correct one —
    and in the failing case it NAMES the element to add. Verified against two fixtures, one
    of each verdict, because a diagnostic that cannot report the failure it exists to find
    is worse than none.
  - It answers the other best-effort claims in the same pass: `meta=`, `#sb_<key>`,
    `.nav-title`, how many different ways the icons are drawn (why `filter` is the only
    lever that reaches all of them), and that `.hl_header`'s two children each paint their
    own background. Plus whether a Mosaic `/theme-css/` sheet is loaded at all, which is
    the first thing to check when "the theme isn't applying".
  - **Verified against two fixtures rather than trusted**: the mock harness as-is (flex
    column → *"the browser reflowed it"*) and a copy with the nav switched to
    `display: block` (→ *"no movement — reordering is inert here"*). A diagnostic that
    cannot report the failure it exists to find is worse than none.
  - **NO speculative fallback was added.** Forcing `display: flex` on GHL's own nav from a
    render-blocking stylesheet could break the layout of every sub-account to fix a bug
    nobody has confirmed exists, and an unused option is its own smell — the same
    reasoning that got `authoredOnly` reverted. The measurement decides: if the answer is
    NO, the fix is one rule (make the nav a flex column, or target the wrapper the script
    names); if YES, this line becomes "confirmed" and the risk is closed.
  - **The local harness cannot answer this and says so.** `scratchpad/harness/.../index.html`
    hardcodes `display: flex; flex-direction: column` on `#sidebar-v2` — the very thing
    under test — and its own header states it "CANNOT prove our selectors match live GHL".
    A fixture that asserts the assumption it is meant to check will always agree with you.
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

### Version history showed a number and a timestamp, and nothing else
Found by rendering the History tab (2026-08-19). A real sub-account had **28 versions**,
several of them seconds apart, each row reading `Version 27 · 8/17/2026, 11:37:30 PM`. The
only way to tell them apart was to click **View** on each one in turn.

`GET …/theme/versions` returns the **whole theme row** — every colour, the logo, the brand
name — and always has. The list was throwing all of it away. Same shape as the other finds
this session: the data was there, nothing surfaced it.

- Rows now carry the primary/accent/top-bar **swatches** and the brand name at that version.
  Deliberately not a diff: that is a different feature, and this is the part that makes the
  list scannable.
- Costs no extra query — it is rendering fields already on the wire.
- A version with no colours set shows no swatches, honestly, rather than inventing a
  placeholder. Measured on the live list: 2 of 28 rows carry colours, 28 carry the name.

#### The editor's fallbacks were not the stylesheet's, and Save applied them
Found 2026-08-23, by comparing `MosaicPreview` against `renderRules` — the preview is a
SECOND definition of what a theme looks like, and this file already records that pair
drifting once (the preview sorted unlisted menu items LAST while the stylesheet put them
FIRST). It had drifted again, on the colour of the active menu item:

```
server (renderRules)   accentColor || primaryColor || "#4f46e5"
editor (lookFrom)      accentColor ?? "#f59e0b"
```

- **A sub-account branded teal with no accent chosen showed TEAL live and turned AMBER the
  moment anybody opened the editor and pressed Save** — for any reason at all, the logo, the
  brand name, anything. Nobody chose amber; it was `lookFrom`'s placeholder. Measured, for
  `{primaryColor: "#0f766e", accentColor: null}`: live `background: #0f766e`, saved
  `background: #f59e0b`.
- **That state is the ordinary outcome of "Brand from websites"**, which sets colours and
  nothing else, so it is exactly the sub-accounts an agency onboarded in bulk.
- **Zero of ten sub-accounts on this database were in that state**, because every themed one
  already carried a stored accent — which is not reassurance, it is the evidence that the
  editor had been materialising it all along.
- **`themeDefaults.ts` is extracted**, same reasoning as `bulkEnableLogic` and `slaTone`: it
  is a decision that changes what a client sees, and inline in `lookFrom` it could only be
  checked by opening the editor, saving, and then reading the generated stylesheet. It is
  dependency-free on purpose — importing `ThemeEditor.tsx` drags in `api.ts`, which reads
  `import.meta.env` at module load and cannot run outside Vite.
- Verified: **9 checks** (`scratchpad/verify-preview-truth.ts`), comparing the two
  implementations directly over synthetic themes — no browser, no writes. Confirmed to fail
  **5** under a mutation restoring the amber default. (**26** since the login half below.)
  - **ORDER is asserted, not just the endpoints.** `accentColor ?? primary` and
    `primary ?? accentColor` agree on three of the four cases and disagree on the one that
    actually happens, which is how the original survived: it was right whenever an accent
    had been stored, and every sub-account anybody had opened had one.
  - An empty string is asserted not to count as a colour — the editor stores `""` for a
    cleared field.

##### What a no-op Save writes, measured
Chasing the above turned up the wider shape, and it is worth stating even though it is a
design decision rather than a defect: `lookFrom` materialises a value for EVERY optional
field, while `renderRules` gates every one of them on the field being set. So a sub-account
whose stored theme is just a primary colour goes from **6 rules to 13** when somebody opens
the editor and saves — gaining white menu text, a white top bar with auto-contrasted tab
text, a `#4f46e5` primary button, an 8px radius on every button, card, input and modal, and
a scrollbar. The agency can see those values in the editor's own fields, so this is not
hidden; it is simply not chosen. Recorded so the next person reading `lookFrom` knows the
defaults are load-bearing rather than cosmetic.

#### The login preview invented branding the stylesheet never delivered
Found 2026-08-25, by comparing `LoginPreview` against `renderLoginRules` — the same pair as
`MosaicPreview`/`renderRules` one tab over, and this file already records that pair drifting
twice. The login half had drifted further, and in the worse direction: it did not merely
disagree about a colour, it **invented branding for fields the server emits nothing for.**

```
preview   base = bgColor || "#0f172a"      card = cardColor || "#ffffff"     btn = buttonColor || "#4f46e5"
server    a background rule only IF bgColor is set, and none at all otherwise
```

So an agency that had set nothing looked at a **dark-slate login screen with a white box and
an indigo Sign-in button**, and got GoHighLevel's own login page live. Measured on this
database: the dev agency has **all four login fields unset**, which is exactly that state.

- **The controls could neither express a blank nor show one, and the panel's own copy is
  built on blanks** — *"Leave a field blank to skip it."* An `<input type="color">` cannot be
  empty, so an unset background rendered as a `#0f172a` swatch, byte for byte what somebody
  who had CHOSEN dark slate sees, and there was no hex readout on these rows to say
  otherwise. **Reasoning written down and walked into for the seventh time**, and here the
  copy is the thing that was written down.
- **There was also no way back.** Picking the same colour again fires no change event, so an
  agency who touched the picker once could not undo it by agreeing with it — and every colour
  on this tab is one the stylesheet actually delivers.
- **The gradient conditions disagreed, and that one is a rule that vanishes rather than
  changes.** The server needs `gradientEnabled && gradientColor && loginBgColor` — all three.
  The preview needed two and substituted its own base, so a theme with the gradient on and no
  base colour painted a gradient on screen while the stylesheet emitted **no background rule
  at all**. Guarded in the UI (the toggle seeds a base) and now guarded from the other side
  too: clearing the base colour switches the gradient off, because a gradient nobody emits is
  worse than no gradient.
- **`null` is a real answer, not a colour** — the same rule `slaStatus` follows for a
  conversation nobody owes a reply to. `resolveLoginBackground` / `resolveLoginCard` /
  `resolveLoginButton` live in `themeDefaults.ts` beside `resolveAccentColor`, return null for
  "the stylesheet leaves this alone", and the preview draws those parts **hatched** rather
  than coloured — so "not chosen" cannot be mistaken for "chose grey", which is what a flat
  placeholder did — and names them underneath: *"Not branded yet: background, login box,
  button, logo."*
- Verified: `verify-preview-truth` grew from 9 to **26 checks**, comparing the two
  implementations directly over synthetic themes — no browser, no writes — including the
  gradient-with-no-base case and the fact that an unset part resolves to null. Confirmed to
  fail **5** under a mutation restoring the three `||` fallbacks.
- **And asserting the resolver proves nothing about the row**, which is the whole shape of the
  defect — the server was right the entire time. `shoot-dashboard.mjs` gained a Login-tab step
  that reads the DOM: every colour row must SAY whether it is set, and with nothing set the
  preview frame must be hatched and the note must name the background. It then drives the
  round trip, because "not set" is only honest if the agency can get back to it — pick
  `#112233` (the row reads the hex, the swatch stops rendering as a placeholder, Clear
  appears, the preview un-hatches and drops "background" from its note), then Clear (back to
  `not set`, hatched again).
- Its first draft threw `flat is not defined`: this driver's helper prelude defines only
  `byText`, unlike the other CDP suites here. Worth knowing before copying a snippet between
  them.

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
  Still-dead columns: `secondaryColor` (the editor writes it on every save as a copy of
  `primaryColor` and nothing at either end has ever read it) and `updatedByUserId` (audit
  metadata, never populated — and unpopulatable, since dashboard auth is an agency-level
  HMAC token that carries no user identity). **`contentBgColor` / `contentTextColor` /
  `darkMode` came off this list on 2026-08-27** — see "The content area" above, including
  the two holes that made the audit keep reporting them after they were built.
  - **…and the audit was hiding two more, one of them for the whole life of the column**
    (found 2026-08-19). `darkMode` is accepted by the PUT, stored on all three models,
    carried through presets, threaded into `Look` and the save payload — and read by **not
    one line** of `themeCssBundle`. It renders nothing, and there is no control for it
    anywhere in the dashboard: the words "dark mode" appear in the two React apps zero
    times. `secondaryColor` is the same shape with a different cause — the editor writes it
    on every save as a copy of `primaryColor`, and nothing at either end has ever read it.
    - **Two independent holes let them through, and both are recorded here already.**
      First, the report fired only when the API leg failed or when the CSS and UI legs
      failed TOGETHER — one failed leg too many for this model, since the stylesheet IS the
      product. That is the exact asymmetry `audit-support-fields.js` had to be taught,
      arriving from the other side, and this file's claim that *"`audit-fields.js` never had
      this hole"* was true only of its API leg. Second, `inUi` is satisfied by the word
      appearing in the editor — for `darkMode` that is a TYPE and a state default, never a
      control, which is precisely the trap already written down: *a declaration must not
      satisfy a UI leg*.
    - **Never-rendered is a finding on its own now**, and the render leg reads BOTH delivery
      paths. Checking only the stylesheet reported `brandName` and `faviconUrl` as dead on
      every run — the two columns this audit was written for, and the two that cannot be CSS
      — which is a standing false positive on its own best work. "Reaches the browser" is
      what that leg always meant; the stylesheet was just the only way it happened at the
      time.
    - **The UI leg is deliberately left loose.** Detecting a real control across
      `onChange({field: …})`, a named toggle handler and a drag reorder takes three
      heuristics, and two of them misfire on `hiddenFeatures` / `menuOrder`. The CSS leg is
      exact and was sufficient; a false positive would cost more than the extra coverage.
    - Confirmed by mutation, not by reading: adding a single `theme.darkMode` read to the
      bundle makes the finding disappear, and removing it brings it back.
    - **Neither column was ripped out**, and `darkMode` was BUILT on 2026-08-27 rather than
      left. The reasoning recorded here — that dark mode means recolouring GHL's content
      area, that we have no live-DOM selector for it, and that building it blind would put
      speculative rules in a render-blocking stylesheet on every sub-account — was right
      about GUESSING and wrong about not shipping. The reordering fallback it was compared
      to forces a LAYOUT property on EVERY sub-account whether or not anybody asked; these
      rules set colours only, from a selector list containing no invented class name, and
      emit nothing at all until an agency turns them on. See "The content area" above.
      `secondaryColor` genuinely is unbuilt and is reported every run, because an
      `EXPECTED` entry is for a column that fails a leg DELIBERATELY.
  - **A standing false positive destroys the report.** The audit flagged
    `customCssOverride` as unwritable on every run; the route does accept it, under the
    payload key `customCss`. One line that is always wrong teaches the reader to skim
    past the ones that aren't, so the alias is now known to the script.
  - `scratchpad/audit-support-fields.js` is the same idea over SupportConfig /
    Conversation / DeskUser / KbArticle / KbFeed — the larger half of the product, which
    had no equivalent check. It matches ES6 **shorthand** properties too:
    `{ contentHash, status }` has no colon, and missing that reported a column written on
    every single ingest as dead.
  - **AND IT HAD A HOLE THAT LET THROUGH EXACTLY WHAT IT WAS BUILT FOR** (found 2026-08-18).
    It reported a column only when **two** of its three legs failed — write, read, UI — on
    the reasoning that one failed leg is usually internal plumbing. True for `Conversation`
    and `DeskUser`, which are machinery. Precisely backwards for a settings model: the
    signature of this whole bug class is a column the server writes, the server reads, and
    **no screen can set** — one failed leg. `faviconUrl`, the agency-level `brandName`,
    `slaFirstResponseMins` and `planTiers` all score exactly 1, so the audit printed *"every
    support column is writable, read, and reachable"* over two live instances of the bug.
    Confirmed by running it against the pre-fix tree: clean.
  - `audit-fields.js` never had this hole — it reports *"API won't accept it"* on its own.
    The support twin generalised the shape into a symmetric count and lost the asymmetry
    that made the original work. **A generalisation that drops the special case is not the
    same check.**
  - Fixed with `FORM_MODELS`: for a model that is a FORM (`SupportConfig`), UI-unreachable
    is a finding **by itself**. And it is checked against the settings SCREENS, never
    `api.ts` — a type declaration would otherwise satisfy it while the column stayed exactly
    as unreachable, i.e. the audit would certify the bug. Same file list discipline as
    `audit-fields.js` reading `ThemeEditor.tsx` + `LookFields.tsx`.
  - Tightening it immediately surfaced `SupportConfig.planTiers`, which turned out to be the
    worse of the two (see the wipe above). Both are now built and the audit is clean —
    **and it was never silenced with an `EXPECTED` entry**, which was available and would
    have been the wrong answer: that list is for columns that fail a leg *deliberately*,
    and these two were simply unbuilt.
  - **The file list has to include every screen that really hosts a control**, so adding
    the Plan column to `App.tsx` meant adding `App.tsx`. Verified before doing so that of
    every `SupportConfig` column it matches only `agencyInstallId` (already EXPECTED) and
    `planTiers` itself — so the list widened without masking anything. Omitting a real
    screen would leave a standing false positive, which this file already says destroys a
    report.

#### The desk's whole ticket feature set shipped with NO CSS (`audit-styles.js`, 2026-08-18)
`NewTicket` — "Raise a ticket", the one way work enters the desk other than a client using
the widget — renders a full modal: `modal-backdrop`, `modal`, `modal-head`, `modal-body`,
`modal-actions`, a sub-account `picker`. **Not one of those rules existed.** With no
`position: fixed` backdrop a modal is not a modal: no layer, no panel, no dimming. The form
simply appended itself to the bottom of the page, below the fold. The same was true of the
snooze banner, the automation history, the plan/type/raised badges and the away banner —
every screen the ticket work added.

**Every server-side check passed the entire time**, because they drive the feature over
HTTP. That is the `verify-delivery` blind spot again, one layer out: that suite was 23/23
green while the widget never called the endpoint under test. *A screen is not covered by a
suite that never renders it.*

##### The compose box was WHITE, in a dark UI (found 2026-08-19, by rendering the ticket)
The single most-used control in the desk — the box an agent types every client reply into —
rendered as a **white box with default black text** against the dark theme around it.

`.compose textarea` existed and set width, resize and type metrics, so `audit-styles.js`
was green. The base rule was `input, select { … background; color }` with **no `textarea`
in it**, and `.modal-body textarea` sets its own — which is why both modals looked right
and this did not. That inconsistency is the proof of intent: the stylesheet means to own
the appearance of controls, and one path was missed.

No server-side check can see a colour, and the class-existence audit is green by
construction here. This is its documented limit reached from a new direction: a class being
DEFINED is not the same as its rule being **complete**.

- **`audit-styles.js` gained a second pass** for exactly this shape: for each control
  element a component renders, if the stylesheet colours that element **anywhere**, the
  bare-element rule must colour it too.
- **Narrow on purpose, because the obvious version is a standing false positive.** The
  agency dashboard is a light theme and colours no text control at all — relying on the
  browser default, which is correct there. Flagging it would put three permanent wrong lines
  in the report, and this file already records what that costs. So the trigger is
  *demonstrated intent*, not "is every control coloured".
- **Its own comment broke it.** The note above the pass contains
  `input, select { background; color }` as an example, and a brace-counting rule splitter
  read those braces as CSS — so the audit reported the very rule it was describing as
  missing. Comments are stripped before parsing now. Same family as a backtick in a
  template literal: prose is not inert to a parser.
- Confirmed to catch it: removing `textarea` from the base rule reports `<textarea>` and
  exits 1.

##### A dangling "from:" with no citation after it
Found in the same render. `Ticket.tsx` gated the citation row on `m.citations.length > 0`
and then rendered `.map(c => c.title).filter(Boolean).join(", ")` — so a row of citations
with no titles printed a bare **"from:"** and nothing else. The server maps every citation
to `{ title: c?.title ?? null }`, i.e. it already anticipates a missing title, so the state
is reachable rather than hypothetical. Now gated on the titles that survive the filter. A
dangling label reads as a truncated answer, and on this screen that makes an agent decide
whether the bot cited something they cannot see.

- `scratchpad/audit-styles.js` is the third audit in the family. `audit-fields.js` catches
  a column no UI can write; `audit-support-fields.js` catches a setting no screen can set;
  this catches markup no stylesheet paints. Run over both React apps, and it exits non-zero,
  so it can gate a release.
- **Crude in the safe direction, on purpose.** It reads literal `className="..."` strings
  and template literals with the `${...}` holes stripped — those holes are variable names
  (`waitClass`, `selectedId`), and reporting them would fill the report with noise, which
  is how a report earns the skim it then gets. A class assembled entirely by concatenation
  is invisible to it: a false negative, which is the direction that keeps every line real.
  Runtime prefixes like `msg-` (`msg-${role}`) are listed explicitly rather than inferred,
  so a genuinely dead class cannot hide behind a guess about how it is built.
- Confirmed to catch it: stripping the styles added this session reports all 18 classes
  across five components, and exits 1.
- **The fix uses ONE modal idiom**, not two. `ChangePassword` was first written with its
  own `modal-overlay` / `narrow` / `field-error` names before being moved onto NewTicket's
  — a second set of names for one shape is how the desk ends up with two modal systems and
  a stylesheet nobody can safely change.
- **And then the audit went green while the form still looked broken.** The audit proves a
  class is DEFINED. It cannot prove the rule is right, and the first render showed why:
  `.modal-body label` was written as a flex column, so NewTicket's
  `Their name <span class="muted">optional</span>` put **"optional" on its own line** under
  every optional field. Every class present, every check green, the form visibly wrong.
  Labels are `display: block` now, so the text and its hint flow on one line the way they
  were written. **Only rendering catches this class of thing** — which is the same lesson
  as the CSS gap itself, one level further in.
- **And the SAME class of defect turned up in the dashboard, after the audit went green
  there too.** The response-target rows are `<label className="sla-row">`, and
  `.field label` (specificity 0,1,1) beats a bare `.sla-row` (0,1,0) — so the rows were
  forced to `display: block` with the uppercase bold treatment meant for section headings,
  `.sla-name`'s fixed width was inert, and each input started wherever its label happened
  to end. Ragged, and every class defined. Fixed by matching `label.sla-row` and undoing
  the inherited heading styles. **A class being DEFINED is not the same as its rule TAKING
  EFFECT**, and no static check of class names can see the difference — which is the
  honest limit of `audit-styles.js`, now written in its header.
- **`scratchpad/shoot-dashboard.mjs` is the same tool for the agency dashboard**, and it
  records two traps that each produced a check passing for the WRONG REASON:
  - **`el.blur()` does nothing if the element was never focused.** No blur event fires, so
    an `onBlur` save never runs. The first pass at this reported the Plan column working
    while the database stayed empty. Proven both ways since: typing without focus leaves
    `planTiers` untouched; `focus()` then `blur()` writes it.
  - **The Plan input is UNCONTROLLED** (`defaultValue`), so reading `el.value` back returns
    what you just typed and says nothing about whether it saved. **Assert against the
    server**, never the input — the driver now re-reads `/admin/api/:agency/support`.
    - **That was a PRODUCT bug too, not only a driver trap** (2026-08-19). `handlePlanChange`
      rolls the config back when a save fails — the whole reason a failed save is safe — and
      with nothing remounting the input the rollback could never reach the DOM. A save that
      401'd, or was refused because the support config had not loaded, left the typed plan
      sitting in the cell looking stored while the client kept being told the feature "isn't
      part of your setup", months later, in their own chat. Fixed with a `key` built from the
      stored plan, which keeps the stated reason for being uncontrolled. Same defect as the
      desk's routing limit, in the other app — the two were found in one afternoon by
      grepping for `defaultValue`, which is worth doing again after any form change.
      Confirmed by driving it: typed 80 characters, stored 60, and the cell reads **60** —
      **80** with the key removed.
  - It also asserts the response-target inputs all share one x-coordinate, because "ragged"
    is precisely what the specificity bug looked like and a screenshot alone needs a human
    to notice.
  - **It types into a REAL agency's Plan column, and until 2026-08-19 it left what it typed
    there.** Every run overwrote whatever that agency had recorded with a value from a
    screenshot script — the sixth instance of a harness writing over the user's own data,
    arriving through a driver rather than a teardown, and `planTiers` is what turns "isn't
    part of your setup" into "isn't included on your Starter plan" in a client's chat. It
    snapshots the map first and PUTs it back at the end, whole-object like the Plan cell
    itself, and **prints what it restored** — a restore nobody can see is a claim, not a
    check.
- `scratchpad/shoot-desk.mjs` drives the desk in a real headless Chrome over CDP and
  screenshots it — **no Playwright install**, it talks to the `chrome-headless-shell`
  Playwright already cached, over Node's built-in WebSocket. Signing in is conditional,
  because the browser keeps its cookie between runs and a driver that assumes a login form
  only works the first time. Confirmed by eye: both modals render as real overlays
  (`position: fixed`, `z-index: 50`), the ticket form fits without clipping, and the
  password dialog shows its inline "These don't match" validation.

#### `scratchpad/audit-reach.js` — the fourth audit: code that EXISTS and nothing reaches
The three existing audits are each one instance of a single shape, and it is by far this
repo's most repeated bug: a complete, correct, well-reasoned mechanism with **nothing
feeding it**. The desk stored replies nothing delivered; the shared review queue could be
filled and never emptied; `createCannedReply` and `changePassword` were both finished from
every angle except trying to use them; `/portal/:slug` outlived its only caller by dozens
of commits and quietly became an oracle for the one secret the route beside it guards.
Every one was found by hand, months late.

Two legs, both matched on **identifiers rather than URLs**:
- **an `api.ts` export no screen calls** — the `createCannedReply` shape;
- **an exported server symbol nothing else references** — the `/portal` shape.

Each splits its output in two, because *"exported and used only inside its own file"* is a
surplus `export` keyword while *"referenced nowhere at all"* is a feature nobody can reach.
There are 20 of the former and a handful of the latter; collapsing them buries the ones
that matter. Harnesses count as callers — a symbol only a live check drives is still
reached, and several exist for exactly that.

- **Confirmed to catch the real thing:** with their callers removed, it names
  `changePassword` and `createCannedReply` precisely. That control is the only reason to
  trust a check that is currently clean.
- **There is deliberately NO route-path leg**, and this is the useful part. "A server route
  no client calls" reads like the obvious third one; it was built, measured and thrown
  away. URL construction here spans template literals
  (`${API_BASE}/admin/api/${a}/locations`), plain concatenation inside the generated widget
  (`base() + "/conversation/" + id + "/updates"`), and computed final segments
  (`users/${id}/${enabled ? "enable" : "disable"}`). Every idiom the matcher does not model
  reports a **live** route as dead — 12 findings, 10 of them false. And coarsened enough to
  avoid that, it stops seeing the bug: a dead POST beside a live GET on one path is exactly
  how `createCannedReply` hid. A standing false positive destroys a report, so the leg that
  cannot be made precise is absent rather than approximate.
- Three exemptions, each with its reason: `decryptUserContext` (kept uncalled on purpose),
  `HOUSE_STYLE_NOTE` (documentation as code) and `__brandMapCacheSize` (a test seam, and
  the underscores say so).
- **It found the wait-sentence bug above**, which is what an audit like this is for: a dead
  `formatWait` was the visible end of two screens disagreeing about one promise.
- Two genuinely surplus helpers were deleted rather than wired up: `isKnownTicketType`
  (superseded by `normalizeTicketType`, which every caller uses) and the dashboard's
  `isSessionExpiredError`. The second left its reason behind in the file — `App.tsx`
  compares the stored MESSAGE, because every catch stores `e.message` and `summariseBulk`
  composes a sentence, so at the one call site that matters there is no error object left
  to test. A predicate sitting there reads as the better branch and cannot be used for it.

##### A harness that INVENTS state is not restoring it
`verify-routing` flips the whole desk away and back three times with
`deskUser.updateMany({ where: { status: "active" } })` — real accounts included, because
that is what "the whole desk" means. Cleanup then set them **all** to `available`, with a
comment explaining why ("or the next suite runs against a desk with nobody on it"): right
about the problem, wrong about the fix.

An agent who was deliberately **away** — lunch, end of shift — came back marked on duty, so
the queue would route live tickets to somebody who is not there. That is precisely the
failure the `availability`-vs-`status` split exists to prevent, arriving through the test
harness. It now snapshots each user's availability first and restores it **per user**;
proven by marking a real account away, running the suite, and finding it still away while
the other stayed available.

###### …and NINE of them had switched off a real client's support widget
Found 2026-08-20, from readiness rather than from reading code: *"1 agency has support on
but no sub-account with it enabled — both switches are required, so the widget renders for
nobody."* All fourteen sub-accounts were off while the agency's master switch was on.

Eight suites plus one probe turn a REAL sub-account's `supportEnabled` **on** — they have
to, because both switches are required before the widget answers anything — and every one
of them "cleaned up" with a hardcoded `data: { supportEnabled: false }`. None of them so
much as SELECTED the column, so the prior value was never in hand to restore. Exactly the
availability bug above, one model over and worse: `false` is not merely an invented routing
state, it is the **off** position of the agency's own per-sub-account switch, so each run
withdrew the client-facing product from whichever sub-account `findFirst()` picked.

- **Attributable, not inferred.** `findFirst()` returns "AI Text Bot Testing", whose theme
  carries `brandName: "Harbour Suite"` — the sub-account this file records the widget being
  rendered against on 2026-08-19, which is only possible with the switch ON. It was last
  written 2026-08-19T20:31 and left off.
- **Silent from every side.** No screen says a suite touched it; the agency's own dashboard
  simply shows the Support column off, which is indistinguishable from never having turned
  it on. The one thing that noticed is `no-support-locations`, and readiness is a
  deploy-time log nobody reads on a dev box — the same argument that put the queue-reach
  alarm on the board instead of leaving it to readiness.
- All nine now select the column, snapshot it beside the `locationId` the teardown already
  keeps, and restore that value. Proven by arranging the switch ON, running `verify-plan`,
  and reading it back **still on** — then confirmed to come back **off** under a mutation
  restoring the hardcoded `false`.
- **`local-setup.js --undo` had the same asymmetry in the neighbouring model**, and it is
  the sharper half: setup **upserts** the `SupportConfig`, so on any agency that already had
  one it only ever edited somebody else's row — and `--undo` **deleted** it, taking the
  greeting, blocked terms, business hours, response targets and plan names with it. It now
  leaves the config alone and says why, which is the reasoning the very next line of that
  script already applied to theme versions.
- The switch is deliberately left **off**, where this session found it. Turning a
  client-facing widget on for a real sub-account is the agency's call, not a cleanup.

##### A browser driver that clicks the wrong thing does not FAIL — it describes another screen
Three traps in one session of driving the dashboard, all of which produced confident,
wrong output rather than an error:
- **A generic selector matched a different overlay.** The theme editor and the support modal
  both render `.modal-overlay`, so `document.querySelector(".modal-overlay")` returned
  whichever was on top — and the driver measured the support modal, printed it under the
  heading "editor", and reported tabs that belong to another component. Target a marker the
  screen alone has (`.modal-lg` here).
- **The footer button is not the same word on every tab** — "Cancel" while editing, "Close"
  on Activity. Matching one of them left the modal open, and the next step opened the editor
  *behind* it. The screenshot is what showed this; the log said everything worked.
- **The backtick trap reached the driver.** Browser code is passed as a template literal, so
  a backtick in ordinary comment prose inside that block ends the string and the rest becomes
  code — here `` `.modal-lg` `` produced `ReferenceError: lg is not defined`. Already
  documented for `supportWidgetScript.ts` and `kbSearch.ts`; it arrives anywhere a tagged or
  interpolated template carries prose.

##### Two tool traps that both reported success while doing nothing
- **BSD `sed` does not support `\b`.** `sed -i '' 's/\bfoo\b/bar/g'` matches nothing,
  exits **0**, and changes not one byte — so a negative control built on it "passes" while
  testing the unmutated code. It cost one wrong conclusion here (the audit appeared not to
  catch the bugs it was written for). Use `perl -pi -e` on this platform.
- **`\s` inside a TEMPLATE LITERAL collapses to `s`.** The CDP drivers pass browser code as
  a template literal, so a regex written `/\s+/g` arrives as `/s+/g` — which silently ate
  every "s" out of the sentence it was reporting (*"2 conver ation needed a per on"*), and
  read as the product rendering garbage. Double the backslash in any code being passed as a
  template literal. A driver that garbles what it reads is worse than one that fails.
- **`git stash` is an edit to the whole tree, and `npm run dev:server` is `tsx watch`.**
  This file already says not to edit source while a live suite runs; stashing is that at
  maximum blast radius. Worse, a conflicted `package.json` left by `stash pop` is
  unparseable, so the watcher **dies** and every subsequent suite reports `fetch failed` —
  which reads as a server bug. Stash only with nothing in flight, and check `git stash
  list` after a pop: an entry still there means it conflicted.

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
