import { randomBytes } from "node:crypto";
import { ghl } from "./ghlClient";
import { prisma } from "./prisma";

/**
 * One agency-level Custom Menu Link per agency (showOnCompany: true, showOnLocation:
 * false) - appears once in the agency's own nav, not duplicated per sub-account.
 * The URL bakes in this agency's id directly (/admin-embed/:agencyInstallId) rather
 * than resolving it at runtime via the SSO handshake - unlike the per-location
 * portal (one link genuinely shared across many locations), we create exactly one
 * menu link per agency, so there's no ambiguity to resolve at runtime. This also
 * sidesteps a real bug: GHL's own SSO-context handler errors out when responding
 * to the handshake from an agency-level (no-location) page.
 */
export async function ensureAgencyAdminMenuLink(agencyInstallId: string, appBaseUrl: string) {
  const agency = await prisma.agencyInstall.findUniqueOrThrow({
    where: { id: agencyInstallId },
    include: { menuLink: true },
  });

  // createCustomMenu/updateCustomMenu's request body has no companyId field, and only
  // declare Agency-Access (not Location-Access), so the resourceId must come from a
  // header - passed explicitly here, same underlying token-resolution quirk as
  // locationSync.ts's preferredTokenType fix.
  const companyHeader = { headers: { companyId: agency.ghlCompanyId } };
  const url = `${appBaseUrl}/admin-embed/${agency.id}`;

  if (agency.menuLink) {
    await ghl.customMenus.updateCustomMenu(
      { customMenuId: agency.menuLink.ghlMenuLinkId },
      { url, showOnCompany: true, showOnLocation: false, showToAllLocations: false, locations: [] },
      companyHeader
    );
    return prisma.customMenuLinkRegistration.update({
      where: { id: agency.menuLink.id },
      data: { url, targetLocationIds: [] },
    });
  }

  const slug = randomBytes(16).toString("hex");

  const created = await ghl.customMenus.createCustomMenu(
    {
      title: "Mosaic",
      url,
      icon: { name: "grid", fontFamily: "fas" },
      showOnCompany: true,
      showOnLocation: false,
      showToAllLocations: false,
      openMode: "iframe",
      locations: [],
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
      targetLocationIds: [],
    },
  });
}

export async function deleteMenuLinkForAgency(agencyInstallId: string) {
  const agency = await prisma.agencyInstall.findUniqueOrThrow({
    where: { id: agencyInstallId },
    include: { menuLink: true },
  });
  if (!agency.menuLink) return;

  await ghl.customMenus.deleteCustomMenu(
    { customMenuId: agency.menuLink.ghlMenuLinkId },
    { headers: { companyId: agency.ghlCompanyId } }
  );
  await prisma.customMenuLinkRegistration.delete({ where: { id: agency.menuLink.id } });
}
