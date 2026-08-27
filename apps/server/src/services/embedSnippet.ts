import { generateThemeBundleScript } from "./themeBundleScript";
import { generateSupportWidgetScript } from "./supportWidgetScript";

/**
 * THE JavaScript an agency pastes into GHL's Custom JavaScript field. One definition,
 * because there are two places that hand it over and they had already drifted.
 *
 * `/admin/api/:agency/embed` (the dashboard's "Get the code") returned both halves.
 * `/onboarding/:agency` — the page the OAuth redirect lands on, i.e. the FIRST and most
 * likely moment an agency ever pastes anything — returned the theme bundle alone, under
 * a heading offering to "brand the browser-tab title".
 *
 * That is exactly the trap the concatenation exists to prevent, arriving through the
 * other door: an agency who pastes at onboarding has no support widget. They switch
 * support on months later, nothing appears, and there is nothing on any screen to
 * suggest a re-paste was the missing step — the dashboard's copy of the snippet is
 * correct, but nobody goes back to a page they have already finished with.
 *
 * So the rule is not "both routes should remember to include the widget", it is that
 * there is only one snippet to include. The widget ships whether or not support is on
 * today: it self-gates, its config endpoint 404s unless BOTH switches are on, and it
 * then builds nothing. The cost to an agency not using support is one small async fetch
 * per page load that never blocks rendering.
 */
export function buildEmbedJsSnippet(agencyInstallId: string, publicUrl: string): string {
  return [
    generateThemeBundleScript(agencyInstallId, publicUrl),
    generateSupportWidgetScript(agencyInstallId, publicUrl),
  ].join("\n\n");
}
