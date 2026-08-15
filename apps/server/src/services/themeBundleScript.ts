/**
 * Generates the raw JS for GHL's Custom JavaScript field. Only ever fetches JSON
 * *data* at runtime, never a remote *script* file, staying clear of GHL's "no
 * remote script loading" restriction.
 *
 * NOTE: the primary, recommended path is the one-line @import CSS (see
 * routes/onboarding.ts and routes/themeCss.ts) - a stylesheet GHL fetches live,
 * which needs no CORS and no JS. This script is retained for reference / future
 * contexts where a real <script> is valid (e.g. a Custom Page).
 *
 * Wrapped in a DOM-ready guard: Custom JS can execute before <body> exists, so a
 * direct document.body.appendChild() would throw and silently kill the script.
 * Deferring DOM work to DOMContentLoaded (or running immediately if body exists)
 * avoids that. CSS doesn't have this problem, which is another reason the @import
 * path is preferred.
 */
export function generateThemeBundleScript(agencyId: string, apiBase: string): string {
  return `(function () {
  function ready(fn) {
    if (document.body) {
      fn();
    } else {
      document.addEventListener('DOMContentLoaded', fn);
    }
  }

  ready(function () {
    var AGENCY_ID = ${JSON.stringify(agencyId)};
    var API_BASE = ${JSON.stringify(apiBase)};
    var cache = {};
    var lastLocationId = undefined;

    /**
     * This bundle does ONLY what CSS cannot: the browser-tab title and the favicon.
     *
     * It used to also inject its own sidebar CSS, which was both redundant and actively
     * harmful. Redundant because /theme-css already paints the sidebar from the full
     * theme; harmful because this <style> lands in <head> AFTER GHL's Custom CSS, so at
     * equal specificity and equal !important it WON — meaning an agency who pasted the
     * optional JS silently had their gradient or background image flattened to a solid
     * primaryColor. It also recoloured icons with the CSS 'color' property, which cannot
     * work on GHL's sidebar at all (see CLAUDE.md: only 'filter' reaches them).
     *
     * The rule this encodes: anything CSS can express belongs in the stylesheet, where
     * it is versioned, sanitised and testable. The JS bundle never duplicates it.
     */
    function applyTheme(theme) {
      if (!theme) return;
      if (theme.brandName) {
        document.title = theme.brandName;
      }
      applyFavicon(theme.faviconUrl);
    }

    /**
     * The favicon is the whole reason this bundle is worth pasting: CSS cannot set it,
     * so without this the client's browser tab still shows the vendor's icon next to the
     * agency's own brand name — on every tab, all day.
     *
     * Rewrites EVERY existing icon link rather than adding one. GHL ships several
     * (icon, shortcut icon, apple-touch-icon) and browsers are free to pick any of them,
     * so leaving one behind means the old icon reappears at random.
     */
    function applyFavicon(url) {
      var links = document.querySelectorAll("link[rel*='icon']");
      if (!url) {
        // Switching a favicon OFF must restore GHL's, not leave a broken tab icon:
        // ours are tagged, so only ours are removed.
        for (var i = 0; i < links.length; i++) {
          if (links[i].getAttribute('data-mosaic') === '1') links[i].remove();
        }
        return;
      }
      var found = false;
      for (var j = 0; j < links.length; j++) {
        links[j].setAttribute('href', url);
        links[j].setAttribute('data-mosaic', '1');
        found = true;
      }
      if (!found) {
        var link = document.createElement('link');
        link.setAttribute('rel', 'icon');
        link.setAttribute('data-mosaic', '1');
        link.setAttribute('href', url);
        document.head.appendChild(link);
      }
    }

    function fetchAndApply(locationId) {
      if (!locationId) return;
      if (cache.hasOwnProperty(locationId)) {
        applyTheme(cache[locationId]);
        return;
      }
      fetch(API_BASE + '/theme-bundle/' + AGENCY_ID + '/config/' + locationId)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (theme) { cache[locationId] = theme; applyTheme(theme); })
        .catch(function () {});
    }

    function currentLocationId() {
      try {
        var loc = window.AppUtils && window.AppUtils.Utilities && window.AppUtils.Utilities.getCurrentLocation();
        var id = loc && (loc.id || loc._id);
        if (id) return id;
      } catch (e) {}
      var match = window.location.pathname.match(/\\/location\\/([A-Za-z0-9]+)/);
      return (match && match[1]) || null;
    }

    function tick() {
      var id = currentLocationId();
      if (id !== lastLocationId) {
        lastLocationId = id;
        fetchAndApply(id);
      }
    }

    tick();
    try {
      if (window.AppUtils && window.AppUtils.RouteHelper && typeof window.AppUtils.RouteHelper.onRouteChange === 'function') {
        window.AppUtils.RouteHelper.onRouteChange(tick);
      }
    } catch (e) {}
    setInterval(tick, 2000);
  });
})();`;
}
