import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";
import { generateThemeCssBundle } from "../services/themeCssBundle";

export const themeCssRouter = Router();

themeCssRouter.get("/theme-css/:agencyInstallId", async (req: Request, res: Response) => {
  const agency = await prisma.agencyInstall.findUnique({ where: { id: req.params.agencyInstallId } });
  if (!agency) {
    return res.status(404).send("/* Unknown agency install */");
  }
  const css = await generateThemeCssBundle(agency.id);
  // Never cache: the whole point of the @import approach is that theme edits apply
  // live. A cached copy would silently serve stale CSS (and mask logo/theme updates
  // during development), so force a re-fetch every load.
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.type("text/css").send(css);
});
