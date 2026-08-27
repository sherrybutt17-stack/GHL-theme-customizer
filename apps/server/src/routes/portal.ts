import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";

export const portalRouter = Router();

/**
 * PHASE-1 LEGACY. This was the original Custom Menu Link target: a branded splash page
 * that authenticated the viewer through GHL's SSO postMessage handshake. It was
 * superseded by `/admin-embed/:agencyInstallId?k=<slug>` in the third commit, and
 * `ensureAgencyAdminMenuLink` has written only `/admin-embed` URLs ever since.
 *
 * It stayed mounted, and that was the problem. What it had become was an
 * unauthenticated ORACLE FOR THE SLUG — the per-agency secret that is the only thing
 * standing between a scraped agency id (which is public; it is in the pasted `@import`)
 * and a valid admin token. `/admin-embed` is careful about exactly this: it returns a
 * deliberately generic 403 so it reveals nothing about whether the key was right. The
 * forgotten route beside it answered 200 for a valid slug and 404 for a bad one — a
 * clean yes/no — and did it under its OWN rate-limit bucket of 60/min, double the 30
 * that `/admin-embed` is held to *because* it gates that secret. So the tightest limit
 * in the app was undermined by a route nothing had pointed at since commit three.
 *
 * It also carried an unmaintained `window.addEventListener("message")` with no
 * `event.origin` check and a `postMessage(…, "*")`, inside a page rendered in a
 * customer's CRM.
 *
 * Kept as a REDIRECT rather than deleted, because a fresh database cannot repoint a
 * menu link it has no row for: `ensureAgencyAdminMenuLink` adopts an existing GHL menu
 * only when its URL already contains `/admin-embed/<agency id>`, so a phase-1 link
 * would be orphaned in the agency's nav rather than updated. One line here means such
 * an agency lands in the real dashboard instead of on a dead page — and the whole SSO
 * surface goes away regardless.
 *
 * `/portal` now shares `/admin-embed`'s rate-limit bucket (see index.ts), so probing it
 * spends the same 30/min rather than granting a second budget.
 */
portalRouter.get("/portal/:slug", async (req: Request, res: Response) => {
  const registration = await prisma.customMenuLinkRegistration.findUnique({
    where: { slug: req.params.slug },
    select: { agencyInstallId: true, slug: true },
  });
  if (!registration) {
    // Same generic wording as /admin-embed's 403: no hint about which part was wrong.
    return res.status(403).send("Forbidden");
  }
  return res.redirect(
    `/admin-embed/${registration.agencyInstallId}?k=${encodeURIComponent(registration.slug)}`
  );
});
