const ROOT = "/Users/shaheerbutt/GHL theme builder";
require(`${ROOT}/node_modules/dotenv`).config({ path: `${ROOT}/.env` });
const { PrismaClient } = require(`${ROOT}/node_modules/@prisma/client`);
const p = new PrismaClient();
(async () => {
  const ag = await p.agencyInstall.findFirst({ select: { id: true } });
  await p.agencyDefaultTheme.upsert({
    where: { agencyInstallId: ag.id },
    update: { primaryColor: "#0a7d55" },
    create: { agencyInstallId: ag.id, primaryColor: "#0a7d55" },
  });
  const css = await (await fetch(`http://localhost:3210/theme-css/${ag.id}?v=${Date.now()}`)).text();
  console.log(css.slice(0, 700));
  console.log("\n... total", css.length, "bytes");
  await p.agencyDefaultTheme.delete({ where: { agencyInstallId: ag.id } }).catch(() => {});
  await p.$disconnect();
})();
