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

  // Per-agency secret baked into the menu-link URL as ?k=. GHL only ever renders this
  // link to THIS agency's signed-in users, so the secret is never exposed publicly
  // (unlike the agency id, which appears in the pasted @import CSS). /admin-embed
  // requires it before minting a dashboard token - this is what stops anyone who
  // scrapes the agency id from taking over the agency's admin API. Reuse the existing
  // slug when there is one so the secret stays stable across reconciles.
  const slug = agency.menuLink?.slug ?? randomBytes(16).toString("hex");
  const url = `${appBaseUrl}/admin-embed/${agency.id}?k=${slug}`;

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

  // No DB record yet (e.g. a fresh database after a host migration). GHL may still
  // hold a "Mosaic" menu link from a prior install pointing at a now-dead URL.
  // Adopt and repoint it rather than creating a duplicate: match by our title or
  // our /admin-embed/ URL pattern. This self-heals the exact stale-link problem
  // seen when moving hosts.
  const existing = await ghl.customMenus
    .getCustomMenus({ showOnCompany: true, limit: 100 }, companyHeader)
    .then((r) =>
      // Match OUR link specifically (the agency id is baked into the URL) so we can't
      // accidentally adopt/repoint an unrelated menu that merely happens to be titled
      // "Mosaic". The agency id (a stable cuid) survives host migrations.
      (r.customMenus ?? []).find((m) => (m.url ?? "").includes(`/admin-embed/${agency.id}`))
    )
    .catch(() => undefined);

  if (existing?.id) {
    await ghl.customMenus.updateCustomMenu(
      { customMenuId: existing.id },
      { url, showOnCompany: true, showOnLocation: false, showToAllLocations: false, locations: [] },
      companyHeader
    );
    return prisma.customMenuLinkRegistration.create({
      data: {
        agencyInstallId: agency.id,
        ghlMenuLinkId: existing.id,
        slug,
        url,
        targetLocationIds: [],
      },
    });
  }

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
  const agency = await prisma.agencyInstall.findUnique({
    where: { id: agencyInstallId },
    include: { menuLink: true },
  });
  if (!agency?.menuLink) return;

  // Best-effort GHL delete: by the time an uninstall webhook fires, GHL has usually
  // already revoked our token (so this 401s) and often removes the app's menu links
  // itself. Either way we must still drop our own DB record, so swallow the GHL error.
  try {
    await ghl.customMenus.deleteCustomMenu(
      { customMenuId: agency.menuLink.ghlMenuLinkId },
      { headers: { companyId: agency.ghlCompanyId } }
    );
  } catch (e) {
    console.warn(`Menu-link delete via GHL failed for agency ${agencyInstallId} (continuing):`, e);
  }
  // deleteMany (not delete): a concurrent UninstallCompany delivery may have already
  // removed the row, and delete() would throw P2025 on the missing record.
  await prisma.customMenuLinkRegistration.deleteMany({ where: { id: agency.menuLink.id } });
}
