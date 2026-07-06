import { randomBytes } from "node:crypto";
import { ghl } from "./ghlClient";
import { prisma } from "./prisma";

/**
 * GHL's Custom Menu Link API is company-scoped: one menu link entry targets a list
 * of locationIds (CreateCustomMenuDTO.locations), not one entry per location. So we
 * keep exactly one CustomMenuLinkRegistration per agency, and re-point its `locations`
 * array whenever the set of active sub-accounts changes. Which location is actually
 * being viewed is resolved at runtime inside the portal page via the SSO handshake.
 */
export async function ensureMenuLinkForAgency(agencyInstallId: string, appBaseUrl: string) {
  const agency = await prisma.agencyInstall.findUniqueOrThrow({
    where: { id: agencyInstallId },
    include: { menuLink: true },
  });

  const activeLocations = await prisma.locationInstall.findMany({
    where: { agencyInstallId: agency.id, status: "active", enabled: true },
    select: { ghlLocationId: true },
  });
  const locationIds = activeLocations.map((l) => l.ghlLocationId);

  // createCustomMenu/updateCustomMenu's request body has no companyId field, and only
  // declare Agency-Access (not Location-Access), so the resourceId must come from a
  // header - passed explicitly here, same underlying token-resolution quirk as
  // locationSync.ts's preferredTokenType fix.
  const companyHeader = { headers: { companyId: agency.ghlCompanyId } };

  if (agency.menuLink) {
    await ghl.customMenus.updateCustomMenu(
      { customMenuId: agency.menuLink.ghlMenuLinkId },
      { locations: locationIds, showToAllLocations: false },
      companyHeader
    );
    await prisma.customMenuLinkRegistration.update({
      where: { id: agency.menuLink.id },
      data: { targetLocationIds: locationIds },
    });
    return agency.menuLink;
  }

  const slug = randomBytes(16).toString("hex");
  const url = `${appBaseUrl}/portal/${slug}`;

  const created = await ghl.customMenus.createCustomMenu(
    {
      title: "Mosaic",
      url,
      icon: { name: "grid", fontFamily: "fas" },
      showOnCompany: false,
      showOnLocation: true,
      showToAllLocations: false,
      openMode: "iframe",
      locations: locationIds,
      userRole: "all",
      // Marked optional in the SDK's types, but the live API 422s without them.
      allowCamera: false,
      allowMicrophone: false,
    },
    companyHeader
  );

  // The SDK's response type claims { customMenu: {...} }, but the live API actually
  // returns the menu object directly at the top level - handle both defensively.
  const ghlMenuLinkId = (created as any).id ?? (created.customMenu as any)?.id;
  if (!ghlMenuLinkId) {
    throw new Error("Custom menu creation did not return an id: " + JSON.stringify(created));
  }

  return prisma.customMenuLinkRegistration.create({
    data: {
      agencyInstallId: agency.id,
      ghlMenuLinkId,
      slug,
      url,
      targetLocationIds: locationIds,
    },
  });
}
