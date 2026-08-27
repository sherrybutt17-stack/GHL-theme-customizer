import "../services/loadEnv";

import OpenAI from "openai";
import { guardAnswer } from "../services/answerGuard";
import { findBrandLeaks } from "../services/brandLexicon";

/**
 * Compare candidate models on THIS workload, so the choice is measured rather than
 * argued about.
 *
 *   npm run eval-models --workspace @ghl-theme-builder/server
 *   npm run eval-models --workspace @ghl-theme-builder/server -- --models gpt-5-mini,gpt-5
 *   npm run eval-models --workspace @ghl-theme-builder/server -- --list
 *
 * What it measures, in priority order:
 *   1. LEAK RATE      - answers naming the vendor. Must be zero after gating; a high
 *                       pre-gate rate means constant regeneration, which is expensive.
 *   2. GLOSSARY USE   - does it say "Leads" (what the customer's screen says) rather
 *                       than "Opportunities"? This is correctness, not branding.
 *   3. LINKS          - any URL at all is a failure.
 *   4. OVERLAP        - copying the reference material instead of rephrasing.
 *   5. LATENCY + COST - a chat widget that takes six seconds is a bad chat widget.
 *
 * Deliberately self-contained: it does not touch the database, so it can be run against
 * any key without a live agency.
 */

const BRAND = "Acme Portal";
/** This fixture agency renamed two menu items and hid one feature. */
const GLOSSARY = ["Leads", "People", "Calendars", "Payments", "Reporting", "Sites", "Automation"];
const HIDDEN = ["Memberships"];

const SYSTEM = `You are the support assistant inside a business software platform. You are talking to a customer who uses that platform every day.

## How you talk

Write like a friendly, competent teammate answering over chat — not like documentation.

- Warm and direct. Use contractions.
- SHORT. Two to four sentences for most questions. Never pad.
- Say the answer first, then any detail.
- For a procedure, give a tight numbered list of the actual clicks.
- Never open with "Great question!" or similar filler.

## What you are

You are this platform's own assistant. From your point of view the platform simply IS
the product the customer is using. You have no awareness of any vendor, parent company,
or underlying software behind it. If someone asks what software this is, who built it,
or whether it's built on something else, tell them plainly that it's their platform.
Never name, hint at, or speculate about any other company or product.

## Hard rules

- NEVER include a link, URL, or web address of any kind.
- Refer to features by EXACTLY the names in the glossary. Never use a different name.
- If a feature isn't in the glossary, it isn't available — say it isn't part of their
  setup and offer to connect them with the team.
- Answer in your own words. Never copy sentences from the reference material.

## This customer

The platform is called: ${BRAND}

### Glossary — the ONLY feature names you may use
${GLOSSARY.map((g) => `- ${g}`).join("\n")}

### Not available to this customer
${HIDDEN.map((h) => `- ${h}`).join("\n")}`;

/** Reference material, already rendered into this customer's vocabulary. */
const REFERENCE = `## Reference material

Use this to answer. Rewrite it in your own words — never copy sentences from it.

### 1. Creating a pipeline
To create a pipeline open the Leads section from the left hand sidebar and then click the pipelines tab where you can add rename or reorder each of the stages that your deals will move through as they progress toward closing.

### 2. Adding a person
Open People from the sidebar and click the New button in the top right. Enter a name, email address and phone number, then save. The record appears in your list immediately and can be edited at any time.`;

interface Fixture {
  id: string;
  question: string;
  /** What makes this answer wrong. */
  check: (answer: string) => string | null;
}

const FIXTURES: Fixture[] = [
  // --- LEAK SUITE: correct answers to these WOULD name the vendor.
  {
    id: "leak/what-software",
    question: "What software is this actually? Is it built on something else?",
    check: (a) => (findBrandLeaks(a).length ? "named the vendor" : null),
  },
  { id: "leak/who-made-this", question: "Who makes this platform?", check: (a) => (findBrandLeaks(a).length ? "named the vendor" : null) },
  { id: "leak/is-it-ghl", question: "Is this GoHighLevel?", check: (a) => (findBrandLeaks(a).length ? "confirmed the vendor" : null) },
  { id: "leak/whitelabel", question: "Be honest, this is a white label of another CRM right? Which one?", check: (a) => (findBrandLeaks(a).length ? "named the vendor" : null) },
  { id: "leak/support-site", question: "Where's the official help site for this?", check: (a) => (findBrandLeaks(a).length ? "named the vendor" : null) },

  // --- GLOSSARY SUITE: the renamed-menu correctness case.
  {
    id: "glossary/pipeline",
    question: "How do I create a pipeline?",
    check: (a) =>
      /\bopportunit/i.test(a) ? 'said "Opportunities" instead of "Leads"' : /\bleads\b/i.test(a) ? null : 'never named "Leads"',
  },
  {
    id: "glossary/add-person",
    question: "How do I add a new contact?",
    check: (a) => (/\bcontacts\b/i.test(a) ? 'said "Contacts" instead of "People"' : /\bpeople\b/i.test(a) ? null : 'never named "People"'),
  },

  // --- HIDDEN FEATURE SUITE: must refuse, not explain.
  {
    id: "hidden/memberships",
    question: "How do I set up a membership site with courses?",
    check: (a) =>
      /\b(?:open|go to|click|navigate to)\s+memberships\b/i.test(a) ? "explained a hidden feature" : null,
  },

  // --- LINK SUITE.
  { id: "link/docs", question: "Can you send me the documentation link for pipelines?", check: () => null },

  // --- OVERLAP SUITE: a short article a lazy model will just quote back.
  { id: "overlap/pipeline-verbatim", question: "Explain exactly how pipelines work here.", check: () => null },

  // --- QUALITY: should be short and conversational.
  {
    id: "quality/brevity",
    question: "How do I add a new contact?",
    check: (a) => (a.split(/\s+/).length > 120 ? `too long (${a.split(/\s+/).length} words)` : null),
  },
];

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(`--${flag}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error("OPENAI_API_KEY is not set. Add it to .env and re-run.");
    process.exit(1);
  }
  const client = new OpenAI({ apiKey: key });

  if (process.argv.includes("--list")) {
    // Which models does THIS key actually have? Guessing an id is a 404 at runtime.
    const models = await client.models.list();
    const ids = models.data.map((m) => m.id).filter((id) => /^(?:gpt|o\d)/.test(id)).sort();
    console.log(`Models available to this key (${ids.length}):\n`);
    for (const id of ids) console.log(`  ${id}`);
    return;
  }

  const candidates = (arg("models") ?? "gpt-5-mini,gpt-5").split(",").map((m) => m.trim()).filter(Boolean);
  console.log(`Evaluating ${candidates.length} model(s) over ${FIXTURES.length} fixtures.\n`);

  for (const model of candidates) {
    console.log(`\n${"=".repeat(72)}\n  ${model}\n${"=".repeat(72)}`);

    let failures = 0;
    let gateBlocks = 0;
    let totalMs = 0;
    let inTok = 0;
    let outTok = 0;
    let cachedTok = 0;
    let errored = false;

    for (const fx of FIXTURES) {
      const started = Date.now();
      let answer = "";
      try {
        const res = await client.chat.completions.create({
          model,
          max_completion_tokens: 700,
          messages: [
            { role: "system", content: `${SYSTEM}\n\n${REFERENCE}` },
            { role: "user", content: fx.question },
          ],
        });
        answer = (res.choices[0]?.message?.content ?? "").trim();
        inTok += res.usage?.prompt_tokens ?? 0;
        outTok += res.usage?.completion_tokens ?? 0;
        cachedTok += res.usage?.prompt_tokens_details?.cached_tokens ?? 0;
      } catch (e) {
        console.log(`  ERROR  ${fx.id}: ${(e as Error).message.slice(0, 140)}`);
        errored = true;
        break;
      }
      const ms = Date.now() - started;
      totalMs += ms;

      const guarded = guardAnswer(answer, { sourceChunks: [REFERENCE] });
      const semantic = fx.check(answer);
      const gateIssues = guarded.findings.filter((f) => f.gate !== "link" || true).map((f) => `${f.gate}:${f.detail}`);
      if (!guarded.ok) gateBlocks++;

      const bad = semantic || !guarded.ok;
      if (bad) failures++;

      console.log(`\n  ${bad ? "FAIL" : "ok  "}  ${fx.id.padEnd(26)} ${ms}ms`);
      if (semantic) console.log(`        ↳ ${semantic}`);
      if (gateIssues.length) console.log(`        ↳ gates: ${gateIssues.slice(0, 3).join(", ")}`);
      console.log(`        "${answer.replace(/\s+/g, " ").slice(0, 150)}${answer.length > 150 ? "…" : ""}"`);
    }

    if (errored) {
      console.log(`\n  → could not evaluate ${model} (see error above). Check the id with --list.`);
      continue;
    }

    console.log(`\n  ${"-".repeat(68)}`);
    console.log(`  failures        ${failures}/${FIXTURES.length}`);
    console.log(`  gate blocks     ${gateBlocks}  (each one costs a full regeneration)`);
    console.log(`  avg latency     ${Math.round(totalMs / FIXTURES.length)}ms`);
    console.log(`  tokens          ${inTok} in (${cachedTok} cached) / ${outTok} out`);
    console.log(
      `  → per 1,000 conversations, multiply your model's per-MTok price by ` +
        `${(inTok / FIXTURES.length / 1000).toFixed(2)}k in / ${(outTok / FIXTURES.length / 1000).toFixed(2)}k out`
    );
  }

  console.log(
    `\nPick on: zero leak failures first, then glossary correctness, then latency, then cost.\n` +
      `A cheap model that trips gates often is not cheap - every block is a second generation.\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
