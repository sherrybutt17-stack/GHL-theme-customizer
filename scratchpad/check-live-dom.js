/**
 * PASTE THIS INTO THE BROWSER CONSOLE ON A LIVE GHL SUB-ACCOUNT PAGE.
 *
 * It answers, from the real DOM, the questions this repo has been carrying as
 * assumptions — the ones no local harness can settle, because a mock only ever proves
 * that the CSS we generate does what we think it does against markup we wrote ourselves.
 * `scratchpad/harness/.../index.html` says so in its own header, and hardcodes the flex
 * column it is supposed to be testing.
 *
 * The headline question is roadmap item 2. Sidebar reordering is delivered as CSS
 * `order`, which only affects FLEX or GRID children. If GHL's nav is neither, every
 * reorder rule we emit is inert: the dashboard's live preview shows the new order, the
 * agency saves it, and the real sidebar never changes. Silent, and reported as working
 * from every screen — the exact failure shape this product keeps finding.
 *
 * IT ANSWERS THREE ASSUMPTIONS, and which ones depend on the page you paste it into:
 *   - on a SUB-ACCOUNT page: the flex/order question above, plus whether a content-area
 *     colour can reach the page (see section 4 — `CONTENT_SELECTOR` contains no invented
 *     GHL class name, so this is the measurement that makes it correct rather than merely
 *     safe);
 *   - on the LOGIN page, signed OUT: whether GHL applies the agency's Custom CSS there at
 *     all, and whether `renderLoginRules`' selectors match that markup. Those two fail
 *     differently and need opposite fixes, so they are reported separately.
 *
 * Nothing is sent anywhere. It reads the page and prints a verdict.
 */
(() => {
  const out = [];
  const verdict = (label, ok, detail) => out.push({ check: label, result: ok === null ? "?" : ok ? "YES" : "NO", detail });

  const nav = document.querySelector("#sidebar-v2");
  if (!nav) {
    /*
      THE LOGIN PAGE, which is the other assumption this repo has been carrying and the one
      no sub-account page can settle. CLAUDE.md: "Its delivery is UNCONFIRMED, like the
      sidebar-reordering flex assumption … `check-live-dom.js` cannot close it either: that
      script runs on a sub-account page, and this one needs a browser that is signed OUT."

      It does now. Same script, two pages: sign out (or open a private window), load the
      login page, and paste this. Two separate questions get answered, and they fail
      differently — the rules can be absent because GHL does not apply the agency's Custom
      CSS there at all, or present and aimed at markup that does not exist.
    */
    const loginish = document.querySelector(".hl_login, form input[type='password']");
    if (!loginish) {
      console.log("%cNo #sidebar-v2 and no login form on this page.", "font-weight:bold");
      console.log("Open a SUB-ACCOUNT page, or sign out and open the LOGIN page, then run it again.");
      return;
    }

    console.log("%cMosaic — live DOM check (LOGIN PAGE)", "font-weight:bold;font-size:14px");

    // 1. Does the agency's Custom CSS reach this page AT ALL? Everything else is moot if not,
    //    and this is the half no amount of selector work can fix.
    const sheets = [...document.styleSheets];
    const ours = sheets.filter((x) => (x.href ?? "").includes("/theme-css/"));
    verdict(
      "our stylesheet is loaded on the LOGIN page  <-- decides whether login branding works AT ALL",
      ours.length > 0,
      ours.length
        ? ours.map((x) => x.href).join(", ")
        : "GHL does not apply the agency's Custom CSS here — every login* column is dead weight in a render-blocking sheet"
    );

    // 2. And do the selectors it ships match this markup? Reported separately, because
    //    "not applied" and "applied but aimed at nothing" need opposite fixes.
    const loginSelectors = {
      ".hl_login  (background)": ".hl_login",
      ".hl_login--header": ".hl_login--header",
      ".hl_login--body": ".hl_login--body",
      ".sidebar-v2-agency": ".sidebar-v2-agency",
      ".hl_login .card  (the box)": ".hl_login .card, .hl_login .card-body",
      "the submit button": ".hl_login .card-body button, .hl_login button[type='submit'], .hl_login .btn, .hl_login .n-button--primary-type",
    };
    for (const [label, sel] of Object.entries(loginSelectors)) {
      const n = document.querySelectorAll(sel).length;
      verdict(`  ${label}`, n > 0, n ? `${n} match(es)` : "no match — this rule is inert");
    }

    // The decisive one, same method as everywhere else in this script: don't read a
    // computed style and infer, CHANGE something and see whether the browser obeys.
    const card = document.querySelector(".hl_login .card, .hl_login .card-body");
    let obeys = null;
    if (card) {
      const prev = card.style.outline;
      card.style.outline = "3px solid magenta";
      obeys = getComputedStyle(card).outlineColor === "rgb(255, 0, 255)";
      card.style.outline = prev;
    }
    verdict("  ...and the login box is reachable by CSS at all", obeys,
      obeys === null ? "no .card to test — the box is some other element" : obeys ? "yes" : "something is overriding us");

    console.table(out);
    const applied = out.find((o) => /loaded on the LOGIN page/.test(o.check));
    if (applied && applied.result === "NO") {
      console.log("%cLOGIN BRANDING IS NOT DELIVERED HERE.", "color:#b91c1c;font-weight:bold");
      console.log("GHL does not apply Settings -> Company -> Custom CSS to the login page.");
      console.log("The eight login* columns cannot work by this route, whatever the selectors say.");
    } else {
      const misses = out.filter((o) => o.result === "NO" && /^  /.test(o.check)).map((o) => o.check.trim());
      if (misses.length) {
        console.log("%cThe sheet is applied, but some selectors match nothing:", "color:#b45309;font-weight:bold");
        console.log(misses.join("\n"));
        console.log("Fix: retarget those in renderLoginRules (themeCssBundle.ts). The columns, the");
        console.log("editor tab and the preview are all already built.");
      } else {
        console.log("%cLogin branding reaches this page.", "color:#15803d;font-weight:bold");
      }
    }
    return out;
  }

  // ---- 1. The reordering assumption -------------------------------------------------
  const navStyle = getComputedStyle(nav);
  const isFlexish = /flex|grid/.test(navStyle.display);
  verdict(
    "sidebar nav is a flex/grid container  <-- decides whether reordering works AT ALL",
    isFlexish,
    `display: ${navStyle.display}${isFlexish ? `, flex-direction: ${navStyle.flexDirection}` : ""}`
  );

  // `order` applies to a DIRECT child only. A nav that is flex but wraps each link in a
  // div means our per-link rules target grandchildren and do nothing — the same no-op
  // through a different door, so it is checked separately.
  const links = [...nav.querySelectorAll("a[meta], a[id^='sb_']")];
  const directChildren = links.filter((a) => a.parentElement === nav);
  verdict(
    "  ...and the nav links are DIRECT children of it",
    links.length > 0 && directChildren.length === links.length,
    `${directChildren.length} of ${links.length} links sit directly under the nav` +
      (links.length && directChildren.length !== links.length
        ? ` — wrapped in <${links.find((a) => a.parentElement !== nav)?.parentElement?.tagName.toLowerCase()}>, so 'order' must target the wrapper`
        : "")
  );

  // Live proof rather than inference: actually set `order` and see whether the browser
  // moves the element. This is the only answer that cannot be argued with.
  let moved = null;
  if (links.length >= 2) {
    const first = directChildren[0] ?? links[0];
    const beforeTop = first.getBoundingClientRect().top;
    const prev = first.style.order;
    first.style.order = "999";
    const afterTop = first.getBoundingClientRect().top;
    first.style.order = prev;
    moved = Math.abs(afterTop - beforeTop) > 1;
  }
  verdict(
    "  ...and setting order:999 on the first item ACTUALLY moves it",
    moved,
    moved === null ? "not enough nav links to test" : moved ? "the browser reflowed it" : "no movement — reordering is inert here"
  );

  // ---- 2. Selectors this repo calls best-effort -------------------------------------
  verdict("nav links carry meta= (what rename/hide/order rules target)", nav.querySelectorAll("a[meta]").length > 0,
    `${nav.querySelectorAll("a[meta]").length} links with meta=`);
  verdict("nav links carry #sb_<key> ids", nav.querySelectorAll("a[id^='sb_']").length > 0,
    `${nav.querySelectorAll("a[id^='sb_']").length} links with an sb_ id`);
  verdict("labels sit in .nav-title (what renaming rewrites)", nav.querySelectorAll(".nav-title").length > 0,
    `${nav.querySelectorAll(".nav-title").length} .nav-title elements`);

  // How icons are drawn decides why `filter` is the only lever that can recolour them.
  const icons = { img: nav.querySelectorAll("img").length, svg: nav.querySelectorAll("svg").length,
                  i: nav.querySelectorAll("i").length, spanBg: 0 };
  for (const s of nav.querySelectorAll("span")) {
    const bg = getComputedStyle(s).backgroundImage;
    if (bg && bg !== "none") icons.spanBg++;
  }
  verdict("icons are drawn several different ways (why `filter`, not `color`)",
    [icons.img, icons.svg, icons.i, icons.spanBg].filter(Boolean).length > 1,
    `img: ${icons.img}, inline svg: ${icons.svg}, <i>: ${icons.i}, span w/ background-image: ${icons.spanBg}`);

  // ---- 3. The top bar's three painted layers ---------------------------------------
  const header = document.querySelector(".hl_header");
  verdict(".hl_header exists", !!header, header ? "" : "top-bar colouring has nothing to target on this page");
  if (header) {
    const kids = [".container-fluid", ".topmenu-nav"];
    for (const sel of kids) {
      const el = header.querySelector(sel);
      verdict(`  ${sel} paints its own background (so it must be coloured too)`, !!el,
        el ? `background: ${getComputedStyle(el).backgroundColor}` : "not present");
    }
  }

  // ---- 4. The content area: which ancestors actually PAINT? -------------------------
  /*
    The content theme (`contentBgColor` / `contentTextColor` / `darkMode`) is the one
    part of the stylesheet whose selector is neither confirmed against live DOM nor a
    guess at a GHL class name. Nothing in the repository knows what GHL calls its
    content container, so `CONTENT_SELECTOR` is deliberately built only from things that
    CANNOT be wrong about which element they hit — `body`, the unique id `#app`, `main`
    and `[role=main]`.

    That makes it safe (the worst case is a visible no-op) and leaves it unmeasured.
    This closes it, the same way the reordering check does: not by reading a computed
    style and inferring, but by painting `body` an absurd colour and asking which
    ancestors are covering it up. Whatever this names is what the constant should say.
  */
  const contentBases = ["body", "#app", "main", "[role='main']"];
  for (const sel of contentBases) {
    const el = document.querySelector(sel);
    verdict(
      `content base ${sel} exists`,
      !!el,
      el ? `background: ${getComputedStyle(el).backgroundColor}` : "not on this page"
    );
  }

  /*
    The decisive part. Paint body magenta, then walk up from a piece of real content and
    report every ancestor that is still painting an opaque background over it. Those are
    the elements a content colour has to name, and they are the ONLY thing standing
    between this feature working and being a no-op.

    Content is found as "the largest block that is not the sidebar and not the header",
    rather than by guessing a class — the same discipline as the constant itself.
  */
  const prevBodyBg = document.body.style.backgroundColor;
  document.body.style.backgroundColor = "magenta";
  let content = null;
  let biggest = 0;
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest("#sidebar-v2, .hl_header, .hl_nav")) continue;
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > biggest && r.width > 400 && r.height > 300) { biggest = area; content = el; }
  }
  const painters = [];
  if (content) {
    for (let el = content; el && el !== document.documentElement; el = el.parentElement) {
      const bg = getComputedStyle(el).backgroundColor;
      const opaque = bg && bg !== "transparent" && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg);
      if (!opaque || el === document.body) continue;
      const id = el.id ? `#${el.id}` : "";
      const cls = (el.className && typeof el.className === "string")
        ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
        : "";
      painters.push(`${el.tagName.toLowerCase()}${id}${cls}  [${bg}]`);
    }
  }
  document.body.style.backgroundColor = prevBodyBg;

  const covered = painters.filter((p) => !contentBases.some((b) =>
    p.startsWith(b.replace(/[\[\]']/g, "")) || (b === "#app" && p.includes("#app"))
  ));
  verdict(
    "content colouring reaches the page  <-- decides whether the content theme works AT ALL",
    painters.length === 0 || covered.length === 0,
    painters.length === 0
      ? "nothing paints over body — a background on `body` is enough"
      : `these paint over it, in order outwards:\n    ${painters.join("\n    ")}`
  );

  // ---- 5. Is our stylesheet even applied here? -------------------------------------
  const imported = [...document.styleSheets].some((s) => (s.href ?? "").includes("/theme-css/"));
  verdict("a Mosaic /theme-css/ stylesheet is loaded on this page", imported,
    imported ? "" : "the @import may be missing, or blocked, or this tab predates it");

  console.log("%cMosaic — live DOM check", "font-weight:bold;font-size:14px");
  console.table(out);
  const blocker = out.find((o) => /flex\/grid container/.test(o.check) && o.result === "NO");
  const inert = out.find((o) => /ACTUALLY moves it/.test(o.check) && o.result === "NO");
  if (blocker || inert) {
    console.log(
      "%cSIDEBAR REORDERING WILL NOT WORK HERE.",
      "color:#b91c1c;font-weight:bold"
    );
    console.log("The order rules are inert, so the dashboard preview will disagree with the real sidebar.");
    console.log("Fix: make the nav a flex column in the generated stylesheet, or target the wrapper element named above.");
  } else if (moved) {
    console.log("%cSidebar reordering works on this page.", "color:#15803d;font-weight:bold");
  }

  const canvas = out.find((o) => /content colouring reaches the page/.test(o.check));
  if (canvas && canvas.result === "NO") {
    console.log("%cTHE CONTENT THEME WILL BE A NO-OP HERE.", "color:#b91c1c;font-weight:bold");
    console.log("Something paints over `body` and we do not name it. The elements are listed above.");
    console.log("Fix: add whichever of those is the outermost content container to CONTENT_SELECTOR");
    console.log("in apps/server/src/services/themeCssBundle.ts. Nothing else has to change —");
    console.log("the rules, the resolver, the preview and the controls are all already built.");
  } else if (canvas) {
    console.log("%cContent theming reaches this page.", "color:#15803d;font-weight:bold");
  }
  return out;
})();
