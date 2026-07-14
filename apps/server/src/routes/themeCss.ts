import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";
import { generateThemeCssBundle } from "../services/themeCssBundle";

export const themeCssRouter = Router();

themeCssRouter.get("/theme-css/:agencyInstallId", async (req: Request, res: Response) => {
  const agency = await prisma.agencyInstall.findUnique({ where: { id: req.params.agencyInstallId } });
  if (!agency) {
    return res.status(404).send("/* Unknown agency install */");
  }
  // Stop branding an agency that has removed the app. The @import line lives in GHL's
  // Custom CSS field and keeps hitting us after UninstallCompany; serve nothing so we
  // don't keep theming for an org that uninstalled us.
  if (agency.status === "uninstalled") {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return res.type("text/css").send("/* This Mosaic install has been removed. */");
  }
  const css = await generateThemeCssBundle(agency.id);
  // Never cache: the whole point of the @import approach is that theme edits apply
  // live. A cached copy would silently serve stale CSS (and mask logo/theme updates
  // during development), so force a re-fetch every load.
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.type("text/css").send(css);
});
