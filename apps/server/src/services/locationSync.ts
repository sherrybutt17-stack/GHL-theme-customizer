import { ghl } from "./ghlClient";
import { prisma } from "./prisma";

/**
 * Pulls the agency's current sub-accounts from GHL and upserts LocationInstall rows.
 * Locations aren't individually "installed" the way the agency is (distribution is
 * Agency-only in practice for our use case) - they become `active` here directly
 * rather than sitting in `pending` waiting for a separate per-location OAuth step.
 */
export async function syncLocationsForAgency(agencyInstallId: string) {
  const agency = await prisma.agencyInstall.findUniqueOrThrow({ where: { id: agencyInstallId } });

  // searchLocations is paginated: without an explicit limit GHL returns only its small
  // default page, so agencies with many sub-accounts would silently lose the rest. Page
  // through with skip/limit until a short page comes back (the response carries no total).
  //
  // preferredTokenType is required here: searchLocations accepts both Agency-Access and
  // Location-Access, and the SDK's token-resolution has a bug where, absent an explicit
  // preference, it incorrectly tries the (empty) location token instead of falling back
  // to the agency token. See https://github.com/GoHighLevel/highlevel-api-sdk (extractResourceId).
  const PAGE_SIZE = 100;
  const locations: NonNullable<Awaited<ReturnType<typeof ghl.locations.searchLocations>>["locations"]> = [];
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const res = await ghl.locations.searchLocations(
      { companyId: agency.ghlCompanyId, skip: String(skip), limit: String(PAGE_SIZE) },
      { preferredTokenType: "company" }
    );
    const page = res.locations ?? [];
    locations.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  for (const loc of locations) {
    if (!loc.id) continue;
    await prisma.locationInstall.upsert({
      where: { ghlLocationId: loc.id },
      update: { locationName: loc.name, status: "active" },
      create: {
        agencyInstallId: agency.id,
        ghlLocationId: loc.id,
        locationName: loc.name,
        status: "active",
        enabled: true,
        installedAt: new Date(),
        activatedAt: new Date(),
      },
    });
  }

  return locations.length;
}
