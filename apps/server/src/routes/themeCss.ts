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
  res.type("text/css").send(css);
});
