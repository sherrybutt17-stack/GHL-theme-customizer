import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";
import { decryptUserContext } from "../services/ssoDecrypt";

export const portalRouter = Router();

portalRouter.get("/portal/:slug", async (req: Request, res: Response) => {
  const registration = await prisma.customMenuLinkRegistration.findUnique({
    where: { slug: req.params.slug },
  });
  if (!registration) {
    return res.status(404).send("Unknown portal");
  }

  res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Mosaic Portal</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 40px; }
    #status { color: #666; }
    #brand { display: none; text-align: center; padding: 60px 20px; }
    #brand img { max-width: 160px; max-height: 160px; margin-bottom: 20px; }
    #brand h1 { margin: 0; }
  </style>
</head>
<body>
  <p id="status">Loading your branded portal&hellip;</p>
  <div id="brand">
    <img id="brand-logo" src="" alt="" style="display:none">
    <h1 id="brand-name"></h1>
  </div>
  <script>
    const slug = ${JSON.stringify(req.params.slug)};

    window.addEventListener('message', async (event) => {
      if (!event.data || event.data.message !== 'REQUEST_USER_DATA_RESPONSE') return;
      try {
        const res = await fetch('/portal/' + slug + '/context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload: event.data.payload }),
        });
        if (!res.ok) throw new Error('context request failed: ' + res.status);
        const theme = await res.json();

        document.getElementById('status').style.display = 'none';
        const brand = document.getElementById('brand');
        brand.style.display = 'block';
        if (theme.primaryColor) document.body.style.background = theme.primaryColor + '11';
        if (theme.logoUrl) {
          const img = document.getElementById('brand-logo');
          img.src = theme.logoUrl;
          img.style.display = 'inline-block';
        }
        document.getElementById('brand-name').textContent = theme.brandName || 'Welcome';
      } catch (err) {
        document.getElementById('status').textContent = 'Could not load portal: ' + err.message;
      }
    });

    window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*');
  </script>
</body>
</html>`);
});

portalRouter.post("/portal/:slug/context", async (req: Request, res: Response) => {
  const registration = await prisma.customMenuLinkRegistration.findUnique({
    where: { slug: req.params.slug },
  });
  if (!registration) {
    return res.status(404).json({ error: "Unknown portal" });
  }

  const { payload } = req.body ?? {};
  if (!payload) {
    return res.status(400).json({ error: "Missing payload" });
  }

  let context;
  try {
    context = decryptUserContext(payload);
  } catch (error) {
    console.error("SSO decrypt failed:", error);
    return res.status(400).json({ error: "Invalid SSO payload" });
  }

  const location = await prisma.locationInstall.findFirst({
    where: {
      agencyInstallId: registration.agencyInstallId,
      ghlLocationId: context.activeLocation,
      status: "active",
    },
    include: { themeConfigs: { orderBy: { version: "desc" }, take: 1 } },
  });

  if (!location) {
    console.warn(
      `Portal context mismatch: activeLocation ${context.activeLocation} is not an active location under agency install ${registration.agencyInstallId}`
    );
    return res.status(403).json({ error: "Location not recognized for this install" });
  }

  const theme = location.themeConfigs[0];
  res.json({
    brandName: theme?.brandName ?? location.locationName,
    logoUrl: theme?.logoUrl ?? null,
    primaryColor: theme?.primaryColor ?? null,
    secondaryColor: theme?.secondaryColor ?? null,
    accentColor: theme?.accentColor ?? null,
  });
});
