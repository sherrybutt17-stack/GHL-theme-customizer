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
  document title) needs the OPTIONAL JS bundle (`services/themeBundleScript.ts`),
  which the agency pastes separately into GHL's *Custom JavaScript* field. The JS
  bundle only *fetches JSON* (`/theme-bundle/:agency/config/:loc`), never a remote
  script (GHL blocks remote scripts).
- **Selectors are best-effort**, confirmed against live GHL DOM. GHL nav links carry
  `#sb_<key>` / `meta="<key>"`; the Settings sidebar is targeted by `/settings/<slug>`
  href fragments (see `services/ghlSidebarFeatures.ts`).
- Color/URL values are sanitized (`cssColor`/`cssUrl`) before entering the stylesheet;
  feature keys are whitelisted (`isKnownFeatureKey`) so they can't break out of a selector.

### Auth
Dashboard is reached only via the agency Custom Menu Link, whose URL carries a
per-agency secret: `/admin-embed/<agencyInstallId>?k=<slug>`. `/admin-embed` verifies
the slug (constant-time), then mints an HMAC dashboard token and redirects to the
dashboard with `?t=<token>`. The dashboard sends it as `x-mosaic-token`; the admin API
requires it when `DASHBOARD_AUTH_ENABLED=true` (mandatory in production).
NOTE: the `agencyInstallId` is NOT secret (it's in the public @import CSS); the `?k=`
slug is what gates access.

### Data model (Prisma)
- `AgencyInstall` — one per GHL agency (keyed by `ghlCompanyId`; id is a cuid).
- `LocationInstall` — one per sub-account.
- `ThemeConfig` — per-location theme, **versioned** (new row per save, `version++`).
- `AgencyDefaultTheme` — one per agency (single row, upserted; NOT versioned).
- `ThemePreset` — reusable looks.
- `CustomMenuLinkRegistration` — the GHL menu link + its secret `slug`.
- `WebhookEvent` — audit + idempotency for GHL lifecycle webhooks.

Shared visual fields live on ThemeConfig / AgencyDefaultTheme / ThemePreset. To add a
new theme field, thread it through: schema (3 models) + migration → `themeCssBundle.ts`
(`VisualTheme` + a render rule) → `admin.ts` (`visualFields` / `presetLookFields` /
preset-apply) → `api.ts` types → `LookFields.tsx` (`Look` + a `ColorRow`) →
`ThemeEditor.tsx` (`lookFrom` default + `applyPreset` + save payload). Mirror an
existing field like `scrollbarColor` / `sidebarTextColor`.

## Commands
- Build: `npm run build:server` · `npm run build --workspace apps/admin-dashboard`
- Dev: `npm run dev:server` · `npm run dev --workspace apps/admin-dashboard`
- Prisma: `npx prisma generate` (in apps/server after schema edits); migrations run on
  deploy via the build command's `prisma migrate deploy`.
- Reconcile all agencies / repoint menu links: `npm run sync-locations --workspace apps/server`

## Deploy (Render)
Manual deploy (not blueprint). Migrations run in the build command. Required prod env:
`DATABASE_URL, GHL_APP_CLIENT_ID, GHL_APP_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY,
APP_PUBLIC_URL (https), ADMIN_DASHBOARD_URL, DASHBOARD_AUTH_ENABLED=true`
(+ `WEBHOOK_SIGNATURE_PUBLIC_KEY`, `GHL_APP_SHARED_SECRET`, `DASHBOARD_TOKEN_SECRET`).
Free Postgres expires 90 days — migrate to a non-expiring DB (e.g. Neon) before that.

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
