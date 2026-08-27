import "../services/loadEnv";
import { prisma } from "../services/prisma";
import { syncLocationsForAgency } from "../services/locationSync";
import { ensureAgencyAdminMenuLink } from "../services/customMenuLink";

async function main() {
  // Reconcile EVERY active agency, not just the first. Running this once after a
  // deploy repoints each agency's Custom Menu Link to the current URL - which is how
  // existing installs pick up the new secret-carrying `?k=<slug>` URL (the slug is
  // reused from the DB, so the link just gets repointed, not regenerated).
  const appUrl = process.env.APP_PUBLIC_URL as string;
  const agencies = await prisma.agencyInstall.findMany({ where: { status: "active" } });
  console.log(`Reconciling ${agencies.length} active agenc${agencies.length === 1 ? "y" : "ies"}...`);

  for (const agency of agencies) {
    try {
      const count = await syncLocationsForAgency(agency.id);
      await ensureAgencyAdminMenuLink(agency.id, appUrl);
      console.log(`  ✓ ${agency.companyName ?? agency.id}: synced ${count} locations, menu link repointed`);
    } catch (e) {
      console.error(`  ✗ ${agency.companyName ?? agency.id}: ${(e as Error).message}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
