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

  // preferredTokenType is required here: searchLocations accepts both Agency-Access and
  // Location-Access, and the SDK's token-resolution has a bug where, absent an explicit
  // preference, it incorrectly tries the (empty) location token instead of falling back
  // to the agency token. See https://github.com/GoHighLevel/highlevel-api-sdk (extractResourceId).
  const res = await ghl.locations.searchLocations(
    { companyId: agency.ghlCompanyId },
    { preferredTokenType: "company" }
  );
  const locations = res.locations ?? [];

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

/**
 * Pushes a location's ThemeConfig (brand name, logo) to GHL's own business-profile
 * fields via PUT /locations/:id. `logoUrl` is missing from the SDK's UpdateLocationDto
 * type but the live API accepts and round-trips it fine (verified manually against a
 * real location) - same "SDK types are incomplete" pattern as the other quirks found
 * in customMenuLink.ts/locationSync.ts's searchLocations call.
 */
export async function pushBusinessProfileToGhl(locationInstallId: string) {
  const location = await prisma.locationInstall.findUniqueOrThrow({
    where: { id: locationInstallId },
    include: {
      agencyInstall: true,
      themeConfigs: { orderBy: { version: "desc" }, take: 1 },
    },
  });
  const theme = location.themeConfigs[0];
  if (!theme) return null;

  const opts = {
    preferredTokenType: "company" as const,
    headers: { companyId: location.agencyInstall.ghlCompanyId },
  };

  return ghl.locations.putLocation(
    { locationId: location.ghlLocationId },
    {
      companyId: location.agencyInstall.ghlCompanyId,
      name: theme.brandName ?? undefined,
      logoUrl: theme.logoUrl ?? undefined,
    } as any,
    opts
  );
}
