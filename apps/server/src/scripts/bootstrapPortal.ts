import "dotenv/config";
import { prisma } from "../services/prisma";
import { syncLocationsForAgency } from "../services/locationSync";
import { ensureAgencyAdminMenuLink } from "../services/customMenuLink";

async function main() {
  const agency = await prisma.agencyInstall.findFirstOrThrow();
  console.log("Syncing locations for agency", agency.id);
  const count = await syncLocationsForAgency(agency.id);
  console.log("Synced", count, "locations");

  console.log("Ensuring agency-level admin menu link...");
  const menuLink = await ensureAgencyAdminMenuLink(agency.id, process.env.APP_PUBLIC_URL as string);
  console.log("Menu link:", JSON.stringify(menuLink, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
