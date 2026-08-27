/**
 * Classes a component renders that NO stylesheet defines.
 *
 * The third audit in this family, and it exists for the same reason as the other two: a
 * feature can be correct from every angle a test can reach and still be unusable on
 * screen. `audit-fields.js` catches a column no UI can write; `audit-support-fields.js`
 * catches a setting no screen can set; this catches markup no stylesheet paints.
 *
 * WHAT IT FOUND ON ITS FIRST RUN. The desk's whole ticket feature set — "Raise a ticket",
 * the snooze banner, the automation history, the plan/type/raised badges, the away banner —
 * shipped with **not one CSS rule**. `NewTicket` renders a full modal (`modal-backdrop`,
 * `modal`, `modal-head`, `modal-body`, `modal-actions`), and with none of those defined a
 * modal is not a modal: no fixed backdrop, no panel, no layer. The form simply appended
 * itself to the bottom of the page, below the fold.
 *
 * Every server-side check of that feature passed the entire time, because they drove it
 * over HTTP — the same blind spot that let `verify-delivery` go 23/23 green while the
 * widget never called the endpoint under test. A screen is not covered by a suite that
 * never renders it.
 *
 * WHAT IT CANNOT TELL YOU: whether the rule TAKES EFFECT. It answers "is this class
 * defined somewhere", which is not the same question. Both defects found by rendering
 * after this audit was green were of that kind — a label forced to `display: block` by a
 * flex column in the desk, and `.sla-row` (0,1,0) losing outright to `.field label`
 * (0,1,1) in the dashboard, which forced the response-target rows to block and made
 * `.sla-name`'s fixed width inert. Defined is not effective. Only rendering shows it,
 * which is what `shoot-desk.mjs` is for.
 *
 * DELIBERATELY CRUDE, in the direction that keeps it honest: it only reads literal
 * `className="..."` strings and template literals with the `${...}` holes removed, because
 * those holes are variable names (`waitClass`, `selectedId`) and reporting them as missing
 * classes is how a report earns the skim it then gets. A class built entirely by
 * concatenation is invisible to this, which is a false NEGATIVE — the safe direction.
 */
const fs = require("fs");
const path = require("path");
const ROOT = "/Users/shaheerbutt/GHL theme builder";

const APPS = [
  { name: "support-desk", dir: "apps/support-desk/src" },
  { name: "admin-dashboard", dir: "apps/admin-dashboard/src" },
];

/**
 * Selectors a stylesheet defines. Read from every .css in the app, since which file a
 * rule lives in is not the question being asked.
 */
function definedClasses(dir) {
  const out = new Set();
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith(".css")) {
        for (const m of fs.readFileSync(path.join(ROOT, rel), "utf8").matchAll(/\.([a-zA-Z][\w-]*)/g)) {
          out.add(m[1]);
        }
      }
    }
  };
  walk(dir);
  return out;
}

function usedClasses(dir) {
  const used = new Map();
  const add = (c, file) => {
    if (c && !used.has(c)) used.set(c, file);
  };
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx$/.test(e.name)) {
        const s = fs.readFileSync(path.join(ROOT, rel), "utf8");
        for (const m of s.matchAll(/className=["]([^"]+)["]/g)) {
          for (const c of m[1].split(/\s+/)) add(c, rel);
        }
        for (const m of s.matchAll(/className=\{`([^`]*)`\}/g)) {
          // Drop the ${...} holes: they are expressions, not class names.
          for (const c of m[1].replace(/\$\{[^}]*\}/g, " ").match(/[a-zA-Z][\w-]*/g) ?? []) add(c, rel);
        }
      }
    }
  };
  walk(dir);
  return used;
}

/**
 * Prefixes completed at runtime — `msg-${role}` renders `.msg-agent`, and the prefix
 * itself is never a class. Listed rather than inferred, so a genuinely dead class cannot
 * hide behind a guess about how it is built.
 */
const RUNTIME_PREFIXES = new Set(["msg-"]);

let findings = 0;
for (const app of APPS) {
  const defined = definedClasses(app.dir);
  const used = usedClasses(app.dir);
  const missing = [...used].filter(([c]) => !defined.has(c) && !RUNTIME_PREFIXES.has(c));
  console.log(`\n${app.name}: ${used.size} classes rendered, ${defined.size} defined in CSS`);
  if (!missing.length) {
    console.log("  every class a component renders is styled.");
    continue;
  }
  findings += missing.length;
  const byFile = {};
  for (const [c, f] of missing) (byFile[f] ||= []).push(c);
  for (const f of Object.keys(byFile).sort()) {
    console.log(`  ${f}`);
    console.log(`      ${byFile[f].join(", ")}`);
  }
}
/**
 * SECOND PASS: form controls the stylesheet never colours.
 *
 * `audit-styles` proves a class is DEFINED; it cannot prove the rule is COMPLETE, and that
 * gap shipped the desk's compose box — the most-used control in the product — as a white
 * box with default black text in a dark UI. `.compose textarea` existed (so this file was
 * green) and set only width, resize and type metrics, while the base
 * `input, select { background; color }` rule had no `textarea` in it. `.modal-body
 * textarea` set its own, which is why the two modals looked right and this did not.
 *
 * Narrow on purpose. It does not attempt "is every rule correct" — it asks the one
 * question with an unambiguous answer: for each control element a component actually
 * renders, does ANY rule give it a background and a colour? On a dark theme the default is
 * white, so an uncovered control is not a subtle difference, it is the wrong colour scheme.
 */
const CONTROLS = ["input", "select", "textarea"];
for (const app of APPS) {
  const css = fs.readFileSync(path.join(ROOT, app.dir, "index.css"), "utf8");
  const markup = (function collect(dir, out = []) {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (e.isDirectory()) collect(path.join(dir, e.name), out);
      else if (/\.tsx$/.test(e.name)) out.push(fs.readFileSync(path.join(ROOT, dir, e.name), "utf8"));
    }
    return out;
  })(app.dir).join("\n");

  /*
   * Strip comments BEFORE splitting into rules. Prose inside a comment is not inert to a
   * brace-counting parser: the note above this pass contains "input, select { background;
   * color }" as an example, and that pair of braces alone made the audit report the very
   * rule it was describing as missing. Same family as a backtick in a template literal.
   */
  const rules = [...css.replace(/\/\*[^]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, sel, body]) => ({ sel, body }));
  const paints = (r) => /(^|[;\s])background(-color)?\s*:/.test(r.body) && /(^|[;\s])color\s*:/.test(r.body);

  const uncoloured = [];
  for (const tag of CONTROLS) {
    if (!new RegExp(`<${tag}[\\s/>]`).test(markup)) continue;
    /**
     * Only where the stylesheet SHOWS INTENT.
     *
     * A light-themed app that colours no control at all is relying on the browser default,
     * which is correct there — the agency dashboard does exactly that, and a check that
     * flagged it would be a standing false positive on three lines, which this repo's own
     * history says teaches the reader to skim the report. The bug being caught is narrower
     * and unambiguous: the stylesheet colours this control SOMEWHERE, so it means to own
     * the appearance, and the bare-element rule was missed — leaving every use outside that
     * one scope on the browser default. On a dark theme that is a white box.
     */
    const anywhere = rules.some((r) => new RegExp(`(^|[\\s,>+~])${tag}([\\s,:.\\[]|$)`).test(r.sel) && paints(r));
    if (!anywhere) continue;
    const atBase = rules.some((r) => r.sel.split(",").map((x) => x.trim()).includes(tag) && paints(r));
    if (!atBase) uncoloured.push(tag);
  }

  if (uncoloured.length) {
    findings += uncoloured.length;
    console.log(`\n  ${app.name}: coloured in one scope and nowhere else — every other use gets the browser default:`);
    for (const t of uncoloured) console.log(`      <${t}>  add it to the base control rule in index.css`);
  } else {
    console.log(`  ${app.name}: no form control is left on the browser default by accident.`);
  }
}

console.log();
process.exit(findings ? 1 : 0);
