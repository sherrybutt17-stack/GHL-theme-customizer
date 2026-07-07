import { prisma } from "./prisma";

/**
 * CSS-only per-location theming, using the modern :has() selector against the
 * location id embedded directly in every sidebar nav link's href
 * (/v2/location/{id}/...) - confirmed present via live DOM inspection. This
 * sidesteps Custom JavaScript entirely, which was empirically confirmed to not
 * execute at all in this account's Custom JS field (document.getElementById
 * kept returning null across multiple script versions), while a hand-written
 * Custom CSS rule targeting #sidebar-v2/.hl_sidebar was confirmed working.
 *
 * Trade-off vs the JS approach: this is a static snapshot, not live-fetched -
 * the agency needs to re-copy/re-paste this whenever a theme changes. Good
 * enough to prove real per-location visual differentiation works at all;
 * a small "Copy CSS" affordance in the admin dashboard keeps the re-paste
 * step low-friction.
 */
export async function generateThemeCssBundle(agencyInstallId: string): Promise<string> {
  const locations = await prisma.locationInstall.findMany({
    where: { agencyInstallId, status: "active", enabled: true },
    include: { themeConfigs: { orderBy: { version: "desc" }, take: 1 } },
  });

  const blocks: string[] = [];
  for (const loc of locations) {
    const theme = loc.themeConfigs[0];
    if (!theme) continue;

    const primary = theme.primaryColor || "#4f46e5";
    const accent = theme.accentColor || primary;
    // Two base selectors (id + class variant of the sidebar) - every compound
    // selector below must repeat BOTH alternatives in full; CSS commas don't
    // distribute the way Sass/LESS nesting would (`a, b c` != `(a, b) c`).
    const bases = [
      `#sidebar-v2:has(a[href*="/location/${loc.ghlLocationId}/"])`,
      `.hl_sidebar:has(a[href*="/location/${loc.ghlLocationId}/"])`,
    ];

    blocks.push(
      `/* ${loc.locationName ?? loc.ghlLocationId} */\n` +
        `${bases.join(", ")} { background: ${primary} !important; }\n` +
        `${bases.map((b) => `${b} a.active`).join(", ")}, ${bases.map((b) => `${b} .active`).join(", ")} { background: ${accent} !important; color: #fff !important; }\n` +
        `${bases.map((b) => `${b} a i`).join(", ")} { color: ${accent} !important; }`
    );
  }

  if (blocks.length === 0) {
    return "/* No sub-account themes configured yet - set one in the Mosaic admin dashboard first. */";
  }

  return blocks.join("\n\n");
}
