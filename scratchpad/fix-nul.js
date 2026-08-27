/**
 * Replace the raw NUL byte in kbIngest.ts's hash separator with the `\0` escape.
 *
 * The byte itself is correct and deliberate: a NUL between title and body stops
 * ("ab","c") hashing the same as ("a","bc"). Writing it as a LITERAL byte is what
 * costs — `file` reports the source as binary, so grep, ripgrep and GitHub code
 * search all silently skip the entire file. Searching for `contentHash` in the module
 * that enforces the knowledge base's brand-safety guarantee returns nothing, which
 * reads as "that code doesn't exist" rather than "your tool gave up".
 *
 * The escape produces the identical string at runtime, so every stored contentHash
 * stays valid — checked below before anything is written, because getting this wrong
 * would make the next seed run treat all 253 articles as changed.
 */
const fs = require("fs");
const crypto = require("crypto");
const path = "/Users/shaheerbutt/GHL theme builder/apps/server/src/services/kbIngest.ts";

const NUL = String.fromCharCode(0);
const title = "Some Title";
const body = "Some body";

const withByte = `${title}${NUL}${body}`;
const withEscape = `${title}\0${body}`;
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");

if (withByte !== withEscape || hash(withByte) !== hash(withEscape)) {
  console.error("REFUSING: the escape does not produce the same string. Stored hashes would all invalidate.");
  process.exit(1);
}
console.log("verified: `\\0` and a literal NUL byte hash identically");

const source = fs.readFileSync(path, "utf8");
const count = source.split(NUL).length - 1;
if (count === 0) {
  console.log("nothing to do — no literal NUL byte present");
  process.exit(0);
}
if (count > 1) {
  console.error(`REFUSING: ${count} NUL bytes found; expected exactly 1. Look at them by hand.`);
  process.exit(1);
}

const fixed = source.split(NUL).join("\\0");
fs.writeFileSync(path, fixed, "utf8");
console.log(`replaced ${count} literal NUL byte with the \\0 escape`);
console.log("file is now plain text:", !fs.readFileSync(path).includes(0));
