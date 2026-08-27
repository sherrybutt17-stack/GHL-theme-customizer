// Import FIRST: npm workspaces run this with cwd=apps/server, but .env lives at the repo
// root. See services/loadEnv.ts — `import "dotenv/config"` alone crashes on boot.
import "../services/loadEnv";
import { prisma } from "../services/prisma";
import { checkReadiness, formatReadiness } from "../services/readiness";

/**
 * Is this deployment actually able to do its job?
 *
 * npm run readiness --workspace @ghl-theme-builder/server
 *
 * The same check the server logs at boot, runnable on demand — which is when you want it:
 * after a deploy, after seeding the knowledge base, after creating the first desk account.
 * Exits non-zero on a blocker so it can gate a release rather than merely inform one.
 *
 * Every finding here describes a state that boots clean and serves 200s. That is the
 * whole point: the failures worth a script are the ones nothing else reports.
 */
(async () => {
  const readiness = await checkReadiness();
  console.log(formatReadiness(readiness));

  const blockers = readiness.findings.filter((f) => f.severity === "blocker").length;
  await prisma.$disconnect();
  process.exit(blockers > 0 ? 1 : 0);
})().catch(async (e) => {
  console.error(`readiness check failed: ${e?.message ?? e}`);
  await prisma.$disconnect().catch(() => {});
  process.exit(2);
});
