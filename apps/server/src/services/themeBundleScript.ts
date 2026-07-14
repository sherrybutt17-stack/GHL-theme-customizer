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

    function applyTheme(theme) {
      var styleId = 'mosaic-theme-style';
      var style = document.getElementById(styleId);
      if (!style) {
        style = document.createElement('style');
        style.id = styleId;
        document.head.appendChild(style);
      }
      if (!theme) {
        style.textContent = '';
        return;
      }
      var primary = theme.primaryColor || '#4f46e5';
      var accent = theme.accentColor || primary;
      var css = '';
      css += '#sidebar-v2, .hl_sidebar { background: ' + primary + ' !important; }';
      css += '#sidebar-v2 a.active, .hl_sidebar a.active, .sidebar-v2 .active { background: ' + accent + ' !important; color: #fff !important; }';
      css += '#sidebar-v2 a i, .hl_sidebar a i { color: ' + accent + ' !important; }';
      style.textContent = css;
      if (theme.brandName) {
        document.title = theme.brandName;
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
