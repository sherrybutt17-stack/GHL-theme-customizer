/**
 * Generates the raw JS to be pasted directly into Settings -> Company -> Custom
 * JavaScript. Only ever fetches JSON *data* at runtime, never a remote *script*
 * file, staying clear of GHL's "no remote script loading" restriction.
 *
 * Wrapped in a DOM-ready guard: the very first version of this script had zero
 * visible effect (confirmed via document.getElementById returning null in the
 * live console) while a hand-pasted Custom CSS rule targeting #sidebar-v2/
 * .hl_sidebar worked fine - the leading theory is that Custom JS executes before
 * <body> exists yet, so any direct document.body.appendChild() call throws
 * immediately and silently kills the whole script. CSS doesn't have this
 * problem since stylesheets apply regardless of DOM readiness. Deferring all
 * DOM work to DOMContentLoaded (or immediately if body already exists) avoids
 * this entirely.
 *
 * Also now targets the real, confirmed-working sidebar selectors
 * (#sidebar-v2, .hl_sidebar, a.active, a i) instead of a placeholder top bar,
 * since those were verified reachable via a real, working hand-written
 * Custom CSS rule on this exact account.
 *
 * DIAGNOSTIC MODE: still renders a small debug badge (bottom-right) alongside
 * the real theming, showing which step of the pipeline succeeded. Remove once
 * fully confirmed working end to end.
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

    function debugBadge(lines) {
      var id = 'mosaic-debug-badge';
      var el = document.getElementById(id);
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:999999;' +
          'background:#111;color:#0f0;font:11px monospace;padding:8px 10px;' +
          'border-radius:6px;max-width:340px;line-height:1.5;white-space:pre-wrap;' +
          'box-shadow:0 2px 8px rgba(0,0,0,.4)';
        document.body.appendChild(el);
      }
      el.textContent = 'Mosaic debug\\n' + lines.join('\\n');
    }

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
      // Confirmed-reachable selectors (verified via a hand-written Custom CSS rule
      // on this account before this script existed).
      css += '#sidebar-v2, .hl_sidebar { background: ' + primary + ' !important; }';
      css += '#sidebar-v2 a.active, .hl_sidebar a.active, .sidebar-v2 .active { background: ' + accent + ' !important; color: #fff !important; }';
      css += '#sidebar-v2 a i, .hl_sidebar a i { color: ' + accent + ' !important; }';
      style.textContent = css;
      if (theme.brandName) {
        document.title = theme.brandName;
      }
    }

    function fetchAndApply(locationId) {
      if (!locationId) {
        debugBadge(['script: running', 'location id: NOT FOUND']);
        return;
      }
      if (cache.hasOwnProperty(locationId)) {
        applyTheme(cache[locationId]);
        debugBadge(['script: running', 'location id: ' + locationId, 'theme: ' + (cache[locationId] ? 'found (cached)' : 'none for this location')]);
        return;
      }
      debugBadge(['script: running', 'location id: ' + locationId, 'theme: fetching\\u2026']);
      fetch(API_BASE + '/theme-bundle/' + AGENCY_ID + '/config/' + locationId)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (theme) {
          cache[locationId] = theme;
          applyTheme(theme);
          debugBadge(['script: running', 'location id: ' + locationId, 'theme: ' + (theme ? 'found' : 'none for this location')]);
        })
        .catch(function (err) {
          debugBadge(['script: running', 'location id: ' + locationId, 'theme fetch FAILED: ' + err.message]);
        });
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

    debugBadge(['script: running', 'waiting for first tick\\u2026']);
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
