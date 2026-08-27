/**
 * Bulk enable/disable across sub-accounts — the outcome the agency is told, and the
 * guards in front of the destructive direction.
 *
 * The bug: `bulkSetEnabled` used `Promise.all`, so the FIRST rejection skipped the local
 * state update entirely while every other request carried on committing. The table then
 * showed nothing changed and the database had changed most of them — and there was no
 * refetch to reconcile it. `handleBulkApply`, twenty lines below in the same file,
 * already refetched for exactly this reason.
 *
 * Two disclosure gaps rode along with it, both about blast radius:
 *   - "select all" spans every filtered PAGE, so on a 41-sub-account agency you can be
 *     looking at 25 rows with 41 selected. "Apply to N" said the number; "Disable
 *     selected" did not, and had no confirmation.
 *   - deleting a preset was a bare click on a small ×, with no prompt — the one action on
 *     that screen with no history to restore from, while a single sub-account's theme
 *     (which HAS a History tab) has always confirmed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { summariseBulk } from "/Users/shaheerbutt/GHL theme builder/apps/admin-dashboard/src/bulkEnableLogic";
import { SESSION_EXPIRED_MESSAGE } from "/Users/shaheerbutt/GHL theme builder/apps/admin-dashboard/src/sessionMessage";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`); }
}

const ok_ = () => ({ status: "fulfilled" as const });
const bad = (message: string) => ({ status: "rejected" as const, reason: { message } });

console.log("\n== what the agency is told after a partial failure ==");

const clean = summariseBulk([ok_(), ok_(), ok_()]);
check("all succeeded says nothing at all", clean.failed === 0 && clean.message === null, JSON.stringify(clean));

const partial = summariseBulk([...Array(38).fill(ok_()), bad("boom"), bad("boom"), bad("boom")]);
check("a partial failure is counted, not reduced to one error", partial.failed === 3, String(partial.failed));
check(
  "  ↳ and states the SUCCESSES, so nobody wonders whether the other 38 landed",
  /38 of 41 updated/.test(partial.message ?? ""),
  partial.message ?? "null"
);
check(
  "  ↳ and points at the table, which is now refetched from the server",
  /shows what actually changed/.test(partial.message ?? ""),
  partial.message ?? "null"
);

const allBad = summariseBulk([bad("nope"), bad("nope")]);
check("everything failing reads as 0 of 2", /0 of 2 updated/.test(allBad.message ?? ""), allBad.message ?? "null");

console.log("\n== an expired session keeps its own message, verbatim ==");
// App.tsx branches on this EXACT string to show the amber "click Mosaic in your sidebar"
// banner rather than a red error. Wrapping it in a count would turn the one failure with
// a remedy the reader can carry out into one without.
const expired = summariseBulk([ok_(), bad(SESSION_EXPIRED_MESSAGE)]);
check("passed through unchanged", expired.message === SESSION_EXPIRED_MESSAGE, expired.message ?? "null");
check("  ↳ not wrapped in a count", !/1 of 2/.test(expired.message ?? ""), expired.message ?? "null");

console.log("\n== and the shipped dashboard guards the destructive direction ==");
const dist = "/Users/shaheerbutt/GHL theme builder/apps/admin-dashboard/dist/assets";
const bundle = readdirSync(dist)
  .filter((f) => f.endsWith(".js"))
  .map((f) => readFileSync(join(dist, f), "utf8"))
  .join("");

check("turning branding OFF in bulk asks first", /Turn off branding for /.test(bundle));
check(
  "  ↳ saying what the client sees, and that nothing is deleted",
  /back to unbranded GoHighLevel on the next page load/.test(bundle) && /Nothing is deleted/.test(bundle)
);
check(
  "  ↳ and how many are on ANOTHER PAGE, which is the number nobody can check by looking",
  /are on another page/.test(bundle)
);
check(
  "deleting a preset asks first — it is the one thing here with no history",
  /Delete this preset\?/.test(bundle) && /presets have no history to restore from/.test(bundle)
);
check(
  "the bulk buttons carry the count, not just the word 'selected'",
  !/Disable selected/.test(bundle) && !/Enable selected/.test(bundle),
  "the old count-less labels are still in the bundle"
);
// NOT CHECKED HERE: that the bulk update uses `allSettled`. Grepping the bundle for it
// passes whatever this code does — App.tsx's initial four-resource load has used
// `Promise.allSettled` since long before this change, so the check could never fail. The
// substance of that fix is `summariseBulk`, which is exercised directly above; a bundle
// grep that is always green would only teach the reader to skim the ones that aren't.

console.log(`\n${"-".repeat(52)}\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
