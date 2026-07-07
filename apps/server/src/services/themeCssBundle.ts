import { prisma } from "./prisma";
import { featureSelector } from "./ghlSidebarFeatures";

/**
 * GHL sidebar logo, confirmed via live DOM inspection:
 *   <div class="... agency-logo-container">
 *     <img class="object-contain agency-logo" alt="agency logo" ...>
 *   </div>
 * We swap the logo by hiding the original <img> and painting the new logo as a
 * background-image on its container. (`content: url()` on the <img> was tried
 * first and did not visually apply in GHL's context.)
 */
const LOGO_CONTAINER_SELECTOR = ".agency-logo-container";
const LOGO_IMG_SELECTOR = "img.agency-logo";

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
    // The sidebar wrapper div carries the raw location id as a CSS class
    // (confirmed in DOM). Used for logo/feature/label rules, which need a
    // location-scoped ancestor without the ":has() + descendant" pattern that
    // GHL's rendering didn't honor.
    const wrapper = `[class~="${loc.ghlLocationId}"]`;

    const rules = [
      `${bases.join(", ")} { background: ${primary} !important; }`,
      `${bases.map((b) => `${b} a.active`).join(", ")}, ${bases.map((b) => `${b} .active`).join(", ")} { background: ${accent} !important; color: #fff !important; }`,
      `${bases.map((b) => `${b} a i`).join(", ")} { color: ${accent} !important; }`,
    ];

    // Per-location logo swap. Uses a DIFFERENT hook than the color rules above:
    // the sidebar wrapper div carries the raw location id as a CSS class
    // (confirmed in DOM: class="... sidebar-v2-location ... {locationId} ..."),
    // targeted here via [class~="id"]. This avoids the ":has() + descendant"
    // pattern, which (unlike a bare ":has() {}") did not apply in GHL's context.
    // Paint the new logo as a container background and hide the original <img>
    // with opacity:0 (keeps layout height so the background fills correctly).
    if (theme.logoUrl) {
      rules.push(
        `${wrapper} ${LOGO_CONTAINER_SELECTOR} { background-image: url("${theme.logoUrl}") !important; background-size: contain !important; background-repeat: no-repeat !important; background-position: center !important; min-height: 40px !important; }`
      );
      rules.push(`${wrapper} ${LOGO_IMG_SELECTOR} { opacity: 0 !important; }`);
    }

    // Feature hiding ("SaaS lockout"): hide specific sidebar items for this
    // sub-account. hiddenFeatures is a JSON array of feature keys (see
    // ghlSidebarFeatures.ts).
    const hidden = Array.isArray(theme.hiddenFeatures) ? (theme.hiddenFeatures as string[]) : [];
    for (const key of hidden) {
      const sel = featureSelector(key)
        .split(", ")
        .map((s) => `${wrapper} ${s}`)
        .join(", ");
      rules.push(`${sel} { display: none !important; }`);
    }

    // Menu label renaming: replace a feature's visible label. CSS can't edit an
    // element's text node, so we zero out the original label span and inject the
    // custom text via ::after. menuLabelOverrides is a JSON object { key: label }.
    const labels =
      theme.menuLabelOverrides && typeof theme.menuLabelOverrides === "object"
        ? (theme.menuLabelOverrides as Record<string, string>)
        : {};
    for (const [key, label] of Object.entries(labels)) {
      if (!label) continue;
      const safe = label.replace(/"/g, '\\"');
      const parts = featureSelector(key)
        .split(", ")
        .map((s) => `${wrapper} ${s} .nav-title`);
      // ::after must be appended to EACH selector, not the joined string (CSS
      // commas don't distribute a trailing pseudo-element).
      rules.push(`${parts.join(", ")} { font-size: 0 !important; }`);
      rules.push(
        `${parts.map((p) => `${p}::after`).join(", ")} { content: "${safe}" !important; font-size: 14px !important; }`
      );
    }

    blocks.push(`/* ${loc.locationName ?? loc.ghlLocationId} */\n` + rules.join("\n"));
  }

  if (blocks.length === 0) {
    return "/* No sub-account themes configured yet - set one in the Mosaic admin dashboard first. */";
  }

  return blocks.join("\n\n");
}
