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
  // through with skip/limit until an empty page comes back (the response carries no total).
  //
  // We advance `skip` by the number of rows ACTUALLY returned, not by the requested
  // PAGE_SIZE: GHL can cap a list endpoint's page size below what we ask for (several GHL
  // endpoints cap at 20), and stepping by the larger requested size would skip right over
  // the un-returned rows - silently dropping sub-accounts, the exact bug this fixes. We
  // also dedupe by id and stop if a page yields nothing new, so an endpoint that ignores
  // `skip` can't spin forever.
  //
  // preferredTokenType is required here: searchLocations accepts both Agency-Access and
  // Location-Access, and the SDK's token-resolution has a bug where, absent an explicit
  // preference, it incorrectly tries the (empty) location token instead of falling back
  // to the agency token. See https://github.com/GoHighLevel/highlevel-api-sdk (extractResourceId).
  const PAGE_SIZE = 100;
  const locations: NonNullable<Awaited<ReturnType<typeof ghl.locations.searchLocations>>["locations"]> = [];
  const seenIds = new Set<string>();
  for (let skip = 0; ; ) {
    const res = await ghl.locations.searchLocations(
      { companyId: agency.ghlCompanyId, skip: String(skip), limit: String(PAGE_SIZE) },
      { preferredTokenType: "company" }
    );
    const page = res.locations ?? [];
    if (page.length === 0) break;
    let added = 0;
    for (const loc of page) {
      // Rows without an id can't be deduped or upserted; keep them out of the set
      // but still count them so `skip` advances past them.
      if (loc.id) {
        if (seenIds.has(loc.id)) continue;
        seenIds.add(loc.id);
      }
      locations.push(loc);
      added++;
    }
    skip += page.length;
    // A page that contributed nothing new means we've either seen everything or the
    // endpoint is ignoring `skip` - either way, stop.
    if (added === 0) break;
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
