# Mosaic — GHL Marketplace Submission & Go-Live Checklist

This is the path from "works on my machine against my own agency" to "other
agencies can install and pay for it." Items marked **[you]** need your decisions
or accounts; **[build]** are engineering tasks I can do.

## 1. Host the server for real (replaces the laptop + free tunnel) **[you decision → build]**

Everything currently runs on your laptop, exposed via an ephemeral
`trycloudflare` URL that changes on every restart. That's fine for building, but
a real product needs a stable, always-on URL. Options (you deferred this — pick
when ready):

- **Render / Railway** (recommended first step): free tier, permanent URL,
  deploys from the repo. Postgres add-on included. ~1 hr to set up.
- **Fly.io / a VPS**: more control, slightly more setup.

Once hosted:
- Set all `.env` values as host environment variables (never commit real secrets).
- `APP_PUBLIC_URL` becomes the permanent host URL.
- Re-point the app's Redirect URL, Webhook URL (dev portal) and the agency menu
  link to that URL — **one time**, then it never churns again.
- The `@import` line agencies paste uses that stable URL, so it stops breaking.

## 2. Data-model / robustness before real customers **[build]**

- **Encrypt `.env` secrets are per-tenant already** — but confirm `TOKEN_ENCRYPTION_KEY`
  is a strong, host-managed secret, not the dev value.
- **Webhook signature verification**: obtain the Ed25519 public key from GHL and
  set `WEBHOOK_SIGNATURE_PUBLIC_KEY` so install/uninstall webhooks are verified
  (currently skipped — logged as "no supported webhook signature header").
- **Multi-agency**: the code is already tenant-scoped (verified via IDOR test),
  so a second agency installing just works — but this hasn't been exercised with
  two real agencies yet. Worth a test install from a second account.
- **Admin dashboard auth**: today the dashboard trusts the `agencyInstallId` in
  the URL (fine while it's only reachable via the SSO-gated menu link). Before
  wide release, add a real check that the viewer belongs to that agency.

## 3. GHL Marketplace listing **[you]**

App is currently **Private** (installable by direct link, skips review). To let
other agencies discover/install it:

- **Profile details**: finish the listing copy, screenshots, category, support
  contact, privacy policy URL (the dev portal "Mandatory steps" panel tracks
  these — Basic info is done; Profile/Support/Pricing/Publish remain).
- **Pricing**: decide the model (flat monthly, per-sub-account, tiered). GHL has
  a built-in app-pricing/billing flow.
- **Onboarding copy**: the listing must clearly state the one manual step —
  pasting the `@import` line into Settings → Company → Custom CSS — since that's
  required once per installing agency.
- **Submit for Public review**: ~10 business days; covers security, billing,
  support. UI-modifying apps get extra scrutiny — our approach only writes to the
  agency's *own* Custom CSS field (no GHL-side code injection), which is the same
  mechanism existing competitors use, so this should be defensible.

## 4. Nice-to-haves / future **[build]**

- Favicon swap per sub-account (schema already has `faviconUrl`).
- More theme surfaces (top bar, buttons, login page) — needs a bit more DOM
  inspection to target reliably.
- A "preview" that renders the themed sidebar inside the admin dashboard so the
  agency sees changes without switching into each sub-account.
- Versioned theme history / rollback (schema already versions ThemeConfig).

## Current status (working, verified live on a real agency)

- OAuth install, encrypted token storage, proactive refresh ✔
- Agency-level admin dashboard embedded via Custom Menu Link ✔
- Per-sub-account: colors, accent, logo, feature hiding, menu renaming ✔
- One-line `@import` embed, live-updating (paste once) ✔
