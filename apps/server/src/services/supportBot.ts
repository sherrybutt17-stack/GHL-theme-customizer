import OpenAI from "openai";
import { prisma } from "./prisma";
import { resolveBrandMap, BrandMap } from "./brandTerms";
import { searchKb, SearchHit } from "./kbSearch";
import { renderForBrand } from "./kbNormalize";
import { guardAnswer, GateFinding } from "./answerGuard";
import { describeError } from "./security";
import type { SupportConfig } from "@prisma/client";

/**
 * The support bot: retrieve → render in this client's words → ask the model → gate.
 *
 * There is no per-client model and no fine-tuning. One shared model and one shared,
 * brand-neutral knowledge base; everything client-specific is assembled into the prompt
 * at request time. That is what lets an agency rename a menu item and have the very
 * next answer use the new name.
 *
 * Answers are BUFFERED, never streamed to a client. A leak caught mid-stream has
 * already been rendered on their screen. Answers are short, so correctness beats a
 * typing animation.
 */

/**
 * Model is an ENV VAR, not a constant, on purpose: model ids and prices move faster
 * than this code will, and the right tier for this workload is an empirical question.
 *
 * A support bot answering from retrieved context is not doing hard reasoning - the
 * knowledge is already in the prompt. The usual reason to fear a small model is
 * instruction-following, and the one instruction that actually matters here ("never
 * name the vendor") is enforced deterministically by answerGuard rather than trusted to
 * the model. So start mid-tier, measure leak rate with the compliance fixtures, and
 * drop to a mini tier if it holds - that is roughly a 20x cost difference.
 */
const MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5-mini";
/** Answers should be a few sentences. A long answer is usually a wrong answer here. */
/**
 * Reasoning models spend this budget on hidden reasoning tokens BEFORE writing a word,
 * so it is not an answer-length cap. Measured: at 700, gpt-5-mini and gpt-5-nano hit the
 * ceiling mid-thought on a multi-step question and returned an EMPTY message - which the
 * gates happily pass (nothing in "" is a leak) and the widget renders as a blank bubble.
 * The empty-answer guard below is the real fix; this just stops it happening routinely.
 */
const MAX_TOKENS = 1500;
const MAX_QUESTION_CHARS = 2000;
const MAX_HISTORY_TURNS = 12;
const RETRIEVE_CHUNKS = 5;

/**
 * Strip markdown emphasis so the widget doesn't render literal asterisks.
 *
 * The widget writes messages with `textContent`, never `innerHTML` - deliberately, since
 * that text is model output inside a customer's CRM. So "open **Leads**" reaches the
 * client as `open **Leads**`. The system prompt asks for plain text, but a prompt is a
 * request; this is the guarantee. Measured: 4-6 of 11 answers used bold on every model
 * tested except gpt-5-mini.
 *
 * Markdown LINKS are not handled here - answerGuard's link gate owns those, and it must
 * see them intact to count the leak.
 */
export function flattenMarkdown(text: string): string {
  return text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")           // headings
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2") // **bold** / __bold__
    .replace(/(?<![*\w])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, "$1") // *italic*, not a bare *
    .replace(/(?<![_\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1")   // _italic_, not snake_case
    .replace(/`{1,3}([^`\n]+)`{1,3}/g, "$1")      // `code`
    .replace(/^\s{0,3}>\s?/gm, "");               // blockquote markers
}

let client: OpenAI | null = null;
function openai(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set; the support bot cannot answer.");
    client = new OpenAI({ apiKey });
  }
  return client;
}

/**
 * The GLOBAL system prompt - byte-identical for every agency, and placed FIRST so the
 * provider's automatic prefix caching can hit it on essentially every request.
 * Everything agency-specific goes after it.
 *
 * Two things it is doing at once:
 *
 *  1. IDENTITY. The retrieved context contains no vendor name (kbNormalize strips it at
 *     ingest), but any frontier model knows what GoHighLevel is FROM TRAINING and can
 *     name it unprompted from a spotless context. This instruction is the first line of
 *     defence; answerGuard is the one that actually guarantees it. That split is why
 *     the provider choice is a cost/quality decision rather than a safety one.
 *
 *  2. VOICE. The knowledge base is documentation prose. Read back verbatim it sounds
 *     like a manual, which is exactly what a support widget must not sound like - and
 *     copying it is also republication rather than rephrasing (gate 3 enforces that
 *     mechanically). So the tone rules below are not decoration; they are load-bearing.
 */
const GLOBAL_SYSTEM_PROMPT = `You are the support assistant inside a business software platform. You are talking to a customer who uses that platform every day.

## How you talk

Write like a friendly, competent teammate answering over chat — not like documentation.

- Warm and direct. Use contractions. It's fine to start with "Sure —" or "Yep —".
- SHORT. Two to four sentences for most questions. Never pad.
- Say the answer first, then any detail. Don't build up to it.
- TALK, don't publish. Default to flowing sentences: "Open Deals in the sidebar, switch
  to the pipelines tab, then hit create and name it." Only reach for a numbered list when
  there are genuinely more than about four steps and order really matters — a two-step
  answer formatted as a list reads like a manual, not a person.
- If they say hello, say hello back and ask what they're working on. Don't recite a menu
  of everything you can do, and never hand a greeting off to a human.
- End a procedure with a light offer to keep going ("want me to walk through the next
  bit?") rather than a formal sign-off — but only when it's actually useful.
- Never say "please refer to the documentation", "as per the article", or "the system".
- One follow-up question at most, and only if you genuinely can't answer without it.
- Never open with "Great question!" or similar filler.
- PLAIN TEXT ONLY. No markdown: no **bold**, no headings, no backticks. The widget
  renders your answer as literal text, so an asterisk shows up as an asterisk.

## What you are

You are this platform's own assistant. From your point of view the platform simply IS
the product the customer is using — the one whose name appears at the top of this
conversation. You have no awareness of any vendor, parent company, or underlying
software behind it, because from where you sit there isn't one. If someone asks what
software this is, who built it, or whether it's built on something else, tell them
plainly that it's their platform and offer to help with what they were trying to do.
Never name, hint at, or speculate about any other company or product.

## Hard rules

- NEVER include a link, URL, or web address of any kind. Not even a domain name.
- Refer to menu items and features by EXACTLY the names given in the glossary below.
  Those are what the customer sees on their screen. Never use a different name for them.
- If a feature isn't in the glossary, it isn't available to this customer — don't
  explain how to use it. Say it isn't part of their setup and offer to connect them
  with the team.
- Answer in your own words. Never copy sentences from the reference material.
- If the reference material doesn't cover it, say so briefly and offer a human. Never
  guess at product behaviour.
- Stay inside the support boundary given below. Anything about billing, contracts,
  refunds, or cancelling goes to a human — you must not make commitments on those.`;

export interface BotMessage {
  role: "user" | "assistant";
  content: string;
}

export interface BotAnswer {
  text: string;
  /**
   * A real hand-off: the route marks the conversation escalated, it enters the desk
   * queue and the desk is emailed. NOT the same as offering a human — see `offerHuman`.
   */
  shouldEscalate: boolean;
  /**
   * Softer: "here's my answer, and I can get you a person if you want one." No ticket,
   * no email, and it does NOT count against the deflection rate.
   *
   * Keeping this separate matters because the two were briefly one flag, and a
   * thin-retrieval answer — including the identity question, which the bot answers
   * perfectly and by design without any reference material — then filed a ticket every
   * time and recorded itself as a support failure. A hand-off is always also an offer;
   * an offer is not a hand-off.
   */
  offerHuman?: boolean;
  escalationReason?: string;
  /** INTERNAL provenance. Never sent to a client. */
  citations: { id: string; title: string; sourceUrl: string | null }[];
  /** Gate findings across all attempts, for per-agency leak metrics. */
  findings: GateFinding[];
  /** How many generations it took. >1 means a gate fired. */
  attempts: number;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
}

function boundaryText(config: SupportConfig | null): string {
  switch (config?.supportBoundary) {
    case "how_to_and_account":
      return "You may answer how-to questions and questions about account settings. Anything about billing, contracts, refunds, cancelling, or pricing must go to a human.";
    case "custom":
      return config.boundaryNotes?.trim() || "Answer how-to questions only; send anything else to a human.";
    default:
      return "Answer product how-to questions only. Anything about billing, payments, contracts, refunds, cancelling, pricing, or changing the account must go to a human — do not answer those yourself.";
  }
}

/**
 * The per-agency block, placed after the invariant global prompt so it never breaks the
 * cacheable prefix.
 *
 * The glossary is the important part: it is the complete list of what this customer's
 * screen actually says. Feeding the model the customer's own vocabulary is what makes
 * "click Leads" correct rather than merely on-brand - the sidebar really does say Leads.
 */
function agencyPrompt(brand: BrandMap, config: SupportConfig | null): string {
  const visible = Object.entries(brand.featureLabels)
    .filter(([key]) => !brand.hiddenFeatures.includes(key))
    .map(([, label]) => label);

  const lines = [
    `## This customer`,
    ``,
    `The platform is called: ${brand.brandName}`,
    `Refer to it by that name when you need to name it at all (usually you don't).`,
    ``,
    `### Glossary — what this customer's screen says`,
    ``,
    `These are the ONLY feature names you may use:`,
    visible.map((l) => `- ${l}`).join("\n"),
  ];

  if (brand.hiddenFeatures.length > 0) {
    const hiddenLabels = brand.hiddenFeatures.map((k) => brand.featureLabels[k]).filter(Boolean);
    lines.push(
      ``,
      `### Not available to this customer`,
      ``,
      `These are switched off for them and do not exist as far as they're concerned. ` +
        `Never explain how to use one. Say plainly that it isn't part of their setup, then ` +
        `say you're passing them to someone from the team who can talk it through - a real ` +
        `person picks these up, so say it as a fact, not as an offer they have to accept:`,
      hiddenLabels.map((l) => `- ${l}`).join("\n")
    );
    // Only name the plan when the agency has actually told us what this client bought.
    // Saying "not on your plan" off the back of hiddenFeatures alone would be asserting a
    // commercial fact we don't have - and one the client could reasonably dispute.
    if (brand.planName) {
      lines.push(
        ``,
        `This customer is on the "${brand.planName}" plan. When something above comes up, ` +
          `you may say it isn't included on their ${brand.planName} plan and offer to connect ` +
          `them with the team. Never quote a price or promise an upgrade yourself.`
      );
    }
  }

  if (config?.userNoun?.trim()) {
    lines.push(``, `Call their own customers "${config.userNoun.trim()}".`);
  }
  if (config?.voiceTone?.trim()) {
    lines.push(``, `Tone preference: ${config.voiceTone.trim()}`);
  }
  if (config?.forbiddenTerms?.length) {
    lines.push(``, `Never mention: ${config.forbiddenTerms.join(", ")}.`);
  }

  lines.push(``, `### Support boundary`, ``, boundaryText(config ?? null));
  return lines.join("\n");
}

/** Reference material block, already rendered into this customer's vocabulary. */
function referenceBlock(chunks: { title: string; body: string }[]): string {
  if (chunks.length === 0) {
    return `## Reference material\n\nNothing relevant was found for this question. Say you're not sure and offer to connect them with the team — do not guess.`;
  }
  return [
    `## Reference material`,
    ``,
    `Use this to answer. Rewrite it in your own words — never copy sentences from it.`,
    ``,
    ...chunks.map((c, i) => `### ${i + 1}. ${c.title}\n\n${c.body}`),
  ].join("\n");
}

/**
 * The answer said a person is coming.
 *
 * Matched against the bot's OWN output, after the gates, to keep the promise honest — see
 * the `promisedHuman` block in `answerQuestion`. Phrasings are taken from what the prompt
 * actually asks for plus what models reach for unprompted; it is deliberately broad,
 * because a false positive files a ticket nobody strictly needed while a false negative
 * leaves a client waiting for somebody who was never told.
 */
const HANDOFF_VERB_RE =
  /\b(?:pass(?:ing|ed)?|hand(?:ing|ed)?|connect(?:ing)?|refer(?:ring|red)?|escalat(?:e|ing|ed)|get(?:ting)?|ask(?:ing)?|loop(?:ing)?|bring(?:ing)?|put(?:ting)?)\b/i;

const HUMAN_NOUN_RE =
  /\b(?:someone|somebody|the team|our team|a colleague|a specialist|an? agent|a human|a real person|team member|one of (?:us|our))\b/i;

/** Unconditional promises of contact — a bot saying these has committed to a follow-up. */
const CONTACT_PROMISE_RE =
  /\b(?:be in touch|get back to you|come back to you|reach out to you|follow up with you|will contact you|will call you)\b/i;

/**
 * A reference to OUR side specifically, as opposed to anybody the client might know.
 *
 * The distinction carries real weight: "someone from the team will look at this" is a
 * commitment we have to honour, while "someone with settings access can change this" is a
 * description of their own staff's permissions. Both contain "someone".
 */
const OUR_TEAM_RE =
  /\b(?:(?:someone|somebody|a member|a colleague|a specialist) from (?:the|our) team|(?:the|our) team|one of (?:us|our))\b/i;

/** A forward commitment rather than a description of what is possible. */
const FUTURE_ACTION_RE = /\b(?:will|shall|going to|shortly|as soon as)\b/i;

/**
 * Conditional framing — the difference between committing and offering.
 *
 * "I'm passing this to someone from the team" is a promise somebody has to keep.
 * "…or I can connect you with the team if you like" is an offer, and treating it as a
 * hand-off files a ticket for a question the bot answered perfectly. Measured: one
 * generation in four of "can you send me a link" volunteers the offer, so this is the
 * difference between a clean deflection and a desk queue full of solved questions.
 */
const CONDITIONAL_RE =
  /\b(?:if you|if that|if it|if i can|if needed|if necessary|if there|would you like|want me to|happy to|let me know|otherwise|or i can|or i could|or connect|or get someone|or pass|or hand)\b/i;

/** Split into sentences so the conditional test applies to the CLAUSE that offers. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** committed = a person is coming. offered = a person is available if they want one. */
export type HumanPromise = "committed" | "offered" | null;

/**
 * Did the answer promise the client a person?
 *
 * Matched against the bot's OWN output, after the gates, to keep the promise honest — see
 * the `promisedHuman` block in `answerQuestion`.
 *
 * Three ways to count, because the promise arrives in three shapes:
 *
 *  1. An outright promise of contact — "we'll be in touch" needs no verb, it IS the
 *     commitment.
 *  2. A hand-off verb AND a human noun — "I'm passing this to someone". Neither alone is
 *     enough: "you can pass it to your accountant" is ordinary advice, and "someone with
 *     settings access can change this" is a description of permissions. Escalating on
 *     either would file tickets for perfectly good answers.
 *  3. OUR team plus a forward commitment — "someone from the team will take a look". No
 *     hand-off verb appears, and it is still a promise somebody has to keep. Scoped to
 *     our side so "the team calendar shows everybody's availability" stays a description.
 *
 * Then the clause is graded. A COMMITTED promise files the ticket; an OFFER only shows
 * the "talk to a person" button. Collapsing those two was already a real bug once in this
 * codebase (`shouldEscalate` vs `offerHuman`) and it is the same distinction here: a
 * hand-off files a ticket, emails the desk and counts against the deflection rate, while
 * an offer costs nothing and leaves the client one click from a person.
 */
export function promisesHuman(text: string): HumanPromise {
  let found: HumanPromise = null;
  for (const sentence of sentences(text)) {
    const mentions =
      CONTACT_PROMISE_RE.test(sentence) ||
      (HANDOFF_VERB_RE.test(sentence) && HUMAN_NOUN_RE.test(sentence)) ||
      (OUR_TEAM_RE.test(sentence) && FUTURE_ACTION_RE.test(sentence));
    if (!mentions) continue;
    // A commitment anywhere in the answer outranks an offer elsewhere in it.
    if (!CONDITIONAL_RE.test(sentence)) return "committed";
    found = "offered";
  }
  return found;
}

/** Heuristics for offering a human before the model even runs. */
const FRUSTRATION_RE = /\b(?:this is ridiculous|useless|stupid bot|not helping|talk to (?:a )?(?:human|person|agent)|real person|speak to someone|customer service)\b/i;
const MONEY_RE = /\b(?:refund|invoice|billing|billed|charge[ds]?|payment|price|pricing|cancel|subscription|contract|upgrade my plan)\b/i;

/**
 * The money questions that must ALWAYS reach a human: the commercial relationship
 * between this client and the agency. Their bill, their plan, their contract, what they
 * are paying, a refund from the agency. No how-to phrasing exempts these — "how do I
 * cancel my subscription" is still a question about their account, not about the
 * software.
 */
const OWN_ACCOUNT_MONEY_RE =
  /\b(?:my|our)\s+(?:bill|billing|invoice|subscription|plan|contract|payment|card|account|package)\b|\b(?:charge[ds]?|bill(?:ed)?)\s+me\b|\bi\s+(?:was|got|am being)\s+(?:charged|billed)\b|\brefund\s+(?:me|my|us|our)\b|\bcancel\s+(?:my|our)\b|\bhow much (?:do|does|did|will|is)\b|\bwhat (?:do|am) i pay(?:ing)?\b|\byour (?:price|prices|pricing|rates|fees|cost|plans)\b|\bupgrade\b/i;

/**
 * A how-to about OPERATING the product, which commits the agency to nothing.
 *
 * Why this exists: `MONEY_RE` matches the bare words "charge", "invoice", "payment" and
 * "subscription", so it fired on "can I charge a deposit before someone books?" and
 * handed it to a human before the model ran. That is not a commercial question — it is
 * somebody asking how a feature works, and it made the whole payments half of the
 * knowledge base unreachable no matter how well it was written. Caught by running real
 * questions through the widget, not by reading the regex.
 *
 * The guard it relaxes is deliberately narrow: the exemption applies only when the
 * question is phrased as a how-to AND says nothing about the asker's own account, and
 * the prompt still forbids quoting a price or promising an upgrade.
 */
const PRODUCT_HOW_TO_RE =
  /\b(?:how (?:do|can|would|should) (?:i|we|you)|how to|where (?:do|can|would) (?:i|we)|can i|could i|is (?:there|it possible) (?:a way )?to|what(?:'s| is) the best way to|do i need to)\b/i;

/**
 * Should this question skip the model and go straight to a human on money grounds?
 *
 * Exported so the boundary is testable directly — it is the rule most likely to be
 * tuned, and the one where a mistake is either a leaked commitment or a silently
 * unusable third of the corpus.
 */
export function isOwnAccountMoneyQuestion(question: string): boolean {
  if (OWN_ACCOUNT_MONEY_RE.test(question)) return true;
  return MONEY_RE.test(question) && !PRODUCT_HOW_TO_RE.test(question);
}

/**
 * Questions the prompt answers completely on its own, with NO reference material.
 *
 * Retrieving nothing normally means "I couldn't help", which is why it hands off. But
 * these two classes retrieve nothing by design and are answered perfectly anyway: the
 * identity question is the one the whole product exists to hold the line on, and "send
 * me a link" is refused on purpose. Filing a ticket for either buries the desk queue in
 * questions the bot got RIGHT, and records each one against the deflection rate.
 *
 * Deliberately narrow, because the failure direction matters: a question wrongly listed
 * here still gets its answer and still gets the "talk to a person" button — it just
 * doesn't auto-file. A question wrongly left OUT merely creates a ticket nobody needed.
 */
export const ANSWERED_WITHOUT_KB_RE =
  /\b(?:what (?:software|platform|crm|system) (?:is|are)|who (?:made|built|owns|develops)|built on|based on|white[ -]?label|powered by|rebrand(?:ed)?|send (?:me )?(?:a |the )?link|link to (?:the )?(?:docs|documentation|help)|documentation)\b/i;

/**
 * Small talk and "what can you do?" — answered from the prompt, never from the KB.
 *
 * Found by using the widget rather than testing it: the very first message anyone sends
 * is "hello", which retrieves nothing, so the thin-retrieval rule filed a ticket and the
 * client was told "someone from the team is picking this up" before they had asked
 * anything. Every conversation began by escalating itself.
 *
 * Anchored to the START of the message and length-capped, so "hi" matches a greeting but
 * not "hide the Hi-Res export", and a long message that merely opens with "hey" is still
 * treated as the real question it is.
 */
const SMALL_TALK_RE =
  /^\s*(?:hi|hey|hello|yo|hiya|howdy|good (?:morning|afternoon|evening)|thanks|thank you|ty|ok(?:ay)?|got it|cool|nice|great|sounds good|bye|goodbye|cheers)\b/i;
const CAPABILITY_RE =
  /\b(?:what can you (?:do|help)|how can you help|what do you do|who are you|are you (?:a )?(?:bot|human|real|ai)|can you help)\b/i;

/** Does this message need reference material at all? */
function needsNoReferenceMaterial(question: string): boolean {
  const isShort = question.length <= 60;
  return (
    ANSWERED_WITHOUT_KB_RE.test(question) ||
    CAPABILITY_RE.test(question) ||
    (isShort && SMALL_TALK_RE.test(question))
  );
}

export async function answerQuestion(input: {
  ghlLocationId: string;
  question: string;
  history?: BotMessage[];
  /**
   * Skip the "hand straight to a human" shortcuts. Set ONLY by `draftAgentReply`: a
   * human is already reading, so "let me get someone from the team" is not an answer.
   * Never set this on the client-facing path — the money/contract shortcut is what
   * stops the bot committing the agency to something.
   */
  skipEscalationShortcuts?: boolean;
}): Promise<BotAnswer> {
  const question = input.question.trim().slice(0, MAX_QUESTION_CHARS);
  const empty: BotAnswer = { text: "", shouldEscalate: true, citations: [], findings: [], attempts: 0 };

  if (!question) return { ...empty, escalationReason: "empty question" };

  const brand = await resolveBrandMap(input.ghlLocationId);
  if (!brand) return { ...empty, escalationReason: "unknown or inactive sub-account" };

  const config = await prisma.supportConfig.findUnique({ where: { agencyInstallId: brand.agencyInstallId } });

  // Escalate early, not late. Never make someone fight a bot to reach a human - that is
  // the single thing that makes embedded support widgets hated.
  if (!input.skipEscalationShortcuts && FRUSTRATION_RE.test(question)) {
    return {
      ...empty,
      text: `Of course — let me get someone from the team to help you with this.`,
      escalationReason: "user asked for a human",
    };
  }
  // The client's own billing and contracts are the agency's business, not ours to speak
  // for. Checked BEFORE the model runs so it can't talk itself into a commitment — but
  // scoped to questions about THEIR account, so "how do I send an invoice" is answered
  // rather than filed as a ticket (see isOwnAccountMoneyQuestion).
  if (!input.skipEscalationShortcuts && config?.supportBoundary !== "custom" && isOwnAccountMoneyQuestion(question)) {
    return {
      ...empty,
      text: `That one's best handled by the team directly — I'll pass this over so someone can take a proper look.`,
      escalationReason: "outside support boundary (billing/contract)",
    };
  }

  /**
   * Did they just ask about something they don't have?
   *
   * They can't have clicked a menu item that isn't there, so a question like this came
   * from OUTSIDE the platform - a friend, a video, the agency's own sales page. That
   * makes it the single most commercially interesting message the widget ever receives,
   * and the one thing it must not do is answer "no" and stop.
   *
   * So it hands off to a real person: the conversation is marked for the desk, a Mosaic
   * agent picks it up, and the agency hears about the interest. An unanswered upsell is
   * worse than an unanswered how-to.
   *
   * Detected by RETRIEVAL, not by matching the menu label against the question.
   *
   * The label match reads well and barely works. Nobody types the nav label: the real
   * message is "a friend said I can build a course area for my members", which shares
   * not one word with "Memberships". Searching the excluded articles asks the question
   * that actually matters — would this have been answered by something we hid? — and it
   * is indifferent to phrasing, synonyms and the agency's rename.
   *
   * Nothing retrieved here goes near the model; only the fact that it matched is used.
   */
  /**
   * Don't retrieve at all for the questions the prompt answers by itself — "what
   * software is this?", "send me a link", "hello", "what can you do?".
   *
   * These are answered from the system prompt by design, and reference material can only
   * add noise to the one answer the entire product exists to get right. Retrieval is not
   * merely unhelpful here, it is actively misleading: the loose pass matches on any two
   * query terms, so "what software is this built on" shares "software" and "built" with
   * half the corpus.
   *
   * Restricting it to the strict pass was not enough — "can you send me a link to the
   * documentation" stems to `send & link & document`, and an article about what not to
   * put in a message legitimately contains all three. That match is real by the search's
   * own rules and still completely irrelevant to the question, so the fix is to skip the
   * lookup rather than to keep tightening it.
   *
   * Safe because `escalate` already exempts these from the thin-retrieval hand-off
   * (`needsNoReferenceMaterial`), while `offerHuman` still shows the "talk to a person"
   * button. The client gets the right answer AND the escape hatch; the desk gets no
   * ticket it did not need.
   */
  const answeredFromPromptAlone = needsNoReferenceMaterial(question);

  const [hits, hiddenHits] = await Promise.all([
    // Retrieve, then render each chunk into THIS customer's vocabulary before the model
    // ever sees it. The model works from text that already says "Leads", not
    // "Opportunities" - so it cannot get the name wrong by paraphrasing.
    answeredFromPromptAlone
      ? Promise.resolve([] as SearchHit[])
      : searchKb({
          query: question,
          hiddenFeatures: brand.hiddenFeatures,
          agencyInstallId: brand.agencyInstallId,
          limit: RETRIEVE_CHUNKS,
        }),
    brand.hiddenFeatures.length
      ? searchKb({
          query: question,
          onlyFeatures: brand.hiddenFeatures,
          agencyInstallId: brand.agencyInstallId,
          limit: 1,
        })
      : Promise.resolve([]),
  ]);

  const askedAboutHidden =
    hiddenHits[0]?.featureTags.find((tag) => brand.hiddenFeatures.includes(tag)) ??
    // Belt and braces for the case retrieval can't see: a feature nobody has written an
    // article about is still one they can ask for by name.
    brand.hiddenFeatures.find((key) => {
      const labels = [brand.featureLabels[key], key].filter(Boolean) as string[];
      return labels.some((label) => {
        const clean = label.trim();
        if (clean.length < 4) return false; // too short to match without false positives
        return new RegExp(`\\b${clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(question);
      });
    });

  const chunks = hits.map((h: SearchHit) => ({
    title: renderForBrand(h.titleNormalized, brand.brandName, brand.featureLabels),
    body: renderForBrand(h.bodyNormalized, brand.brandName, brand.featureLabels),
  }));
  const citations = hits.map((h) => ({ id: h.id, title: h.titleNormalized, sourceUrl: h.sourceUrl }));
  const sourceBodies = chunks.map((c) => c.body);

  const history = (input.history ?? []).slice(-MAX_HISTORY_TURNS);
  const allFindings: GateFinding[] = [];
  let usage: BotAnswer["usage"];
  // Why attempt 1 failed, so the retry gets an accurate correction and the escalation
  // reason names the real cause instead of blaming the gates for an empty response.
  let lastFailure: "gates" | "empty" | null = null;

  // Up to two attempts. If a gate fires we regenerate ONCE with an explicit correction;
  // if it fires again we hand to a human rather than trying to patch model output.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const correction =
      attempt === 1
        ? ""
        : lastFailure === "empty"
          ? `\n\n## Correction\n\nYour previous response contained no text at all. Answer the question directly and briefly, in plain prose, without spending effort on planning.`
          : `\n\n## Correction\n\nYour previous answer was rejected: ${allFindings
              .map((f) => (f.gate === "brand" ? "it named or hinted at an outside company" : f.gate === "overlap" ? "it copied sentences from the reference material" : "it contained a link"))
              .join("; ")}. Rewrite it completely in your own words, using only the names in the glossary, with no links and no mention of any other company.`;

    let raw: string;
    try {
      // ORDER IS DELIBERATE: the global block goes FIRST and is byte-identical for
      // every agency and every request. OpenAI caches long shared prefixes
      // automatically, so keeping the invariant text at the front is what makes most of
      // the input cost a cache read. Anything agency-specific must come after it.
      const system =
        `${GLOBAL_SYSTEM_PROMPT}\n\n${agencyPrompt(brand, config)}\n\n${referenceBlock(chunks)}${correction}`;

      const response = await openai().chat.completions.create({
        model: MODEL,
        // max_completion_tokens, not the deprecated max_tokens: newer models reject the
        // old parameter outright.
        max_completion_tokens: MAX_TOKENS,
        messages: [
          { role: "system", content: system },
          ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          { role: "user" as const, content: question },
        ],
        // Temperature is deliberately NOT set: several current models only accept the
        // default and return a 400 for anything else.
      });

      raw = flattenMarkdown((response.choices[0]?.message?.content ?? "").trim());

      // An empty answer passes every gate - there is nothing in "" to leak, link or
      // copy - so without this check the client gets a blank chat bubble. Treat it
      // exactly like a gate failure: retry once, then hand to a human.
      if (!raw) {
        const why = response.choices[0]?.finish_reason ?? "unknown";
        console.warn(
          `[bot] attempt ${attempt} returned an empty answer (finish_reason=${why}, model=${MODEL}). ` +
            (why === "length" ? "The token budget was spent on reasoning before any text was written." : "")
        );
        lastFailure = "empty";
        continue;
      }

      usage = {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        cacheReadTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      };
    } catch (e) {
      console.error(`[bot] generation failed: ${describeError(e)}`);
      return {
        ...empty,
        text: `Sorry — I'm having trouble right now. Let me get someone from the team to help.`,
        escalationReason: "model call failed",
        attempts: attempt,
      };
    }

    const guarded = guardAnswer(raw, {
      allowedLinkDomains: config?.allowedLinkDomains ?? [],
      forbiddenTerms: config?.forbiddenTerms ?? [],
      sourceChunks: sourceBodies,
    });
    allFindings.push(...guarded.findings);

    if (guarded.ok) {
      // No retrieval AND a confident-sounding answer is the classic hallucination shape.
      // It also catches what the label match cannot: a client asking for a feature we
      // hid AND have no article for retrieves nothing at all, and "a course area for my
      // members" shares no words with "Memberships". So thin retrieval stays a hand-off
      // - except for the questions answered from the prompt by design.
      const thin = chunks.length === 0;
      /**
       * If the ANSWER promises a human, file the ticket — whatever the flags say.
       *
       * Found live: asked how to get a contract signed, the bot replied "that isn't part
       * of your setup. I'm passing this to someone from the team" while `shouldEscalate`
       * and `offerHuman` were BOTH false. Retrieval had succeeded, so `thin` was false;
       * the feature was not hidden, so `askedAboutHidden` was false — the model decided on
       * its own to hand over, and nothing downstream knew. No ticket, no email to the
       * desk, and not even a button. The client is told somebody is coming and nobody is.
       *
       * That is strictly worse than either honest outcome, and it is the one failure the
       * client experiences as being lied to. The prompt cannot prevent it: telling a model
       * "only offer a human when the system says so" is a request, and this is a
       * guarantee — the same reason `answerGuard` exists rather than a politely worded
       * instruction about vendor names.
       *
       * Direction is deliberately one-way. Promising and escalating is safe; escalating
       * without promising is already normal (the widget states it). Only the broken
       * promise is repaired.
       */
      const promise = promisesHuman(guarded.text);
      const escalate =
        !!askedAboutHidden || promise === "committed" || (thin && !needsNoReferenceMaterial(question));
      const label = askedAboutHidden ? brand.featureLabels[askedAboutHidden] ?? askedAboutHidden : "";
      return {
        text: guarded.text,
        shouldEscalate: escalate,
        // The button is offered whenever the answer had nothing behind it, even when no
        // ticket is filed - the client should always be one click from a person. An answer
        // that merely OFFERED a person gets the button too, so the offer is real.
        offerHuman: thin || escalate || promise === "offered",
        escalationReason: askedAboutHidden
          ? `asked about ${label}, which isn't part of their setup${brand.planName ? ` (on the ${brand.planName} plan)` : ""}`
          : promise === "committed"
            ? "the answer promised a person, so one is actually coming"
            : thin
              ? "no reference material matched"
              : undefined,
        citations,
        findings: allFindings,
        attempts: attempt,
        usage,
      };
    }

    lastFailure = "gates";
    console.warn(
      `[bot] attempt ${attempt} rejected for agency ${brand.agencyInstallId}: ` +
        guarded.findings.map((f) => `${f.gate}:${f.detail}`).join(", ")
    );
  }

  // Two attempts, no usable answer. Never ship a rejected (or blank) one - hand to a human.
  return {
    text: `I want to make sure you get this right — let me bring in someone from the team.`,
    shouldEscalate: true,
    escalationReason:
      lastFailure === "empty" ? "the model returned no answer twice" : "answer failed the safety gates twice",
    citations,
    findings: allFindings,
    attempts: 2,
    usage,
  };
}

/**
 * Draft a reply for a HUMAN agent to edit and send, in that ticket's brand voice.
 *
 * Same pipeline as a client-facing answer - same retrieval, same substitution, same
 * three gates - which is the whole point. On the desk a human is the primary leak risk
 * (they know the vendor, they switch brands all afternoon, they type fast), so handing
 * them a draft that is already brand-correct turns authoring into editing.
 *
 * Two deliberate differences from `answerQuestion`:
 *  - the pre-model escalation shortcuts are SKIPPED. "I want a human" is already
 *    satisfied - they're reading this - and a money question still needs the agent to
 *    see a draft they can rewrite or hand to the agency.
 *  - a draft that fails the gates twice returns EMPTY rather than the escalation
 *    sentence, so the compose box stays blank instead of quietly inviting the agent to
 *    send a bot apology under their own name.
 */
export async function draftAgentReply(input: {
  ghlLocationId: string;
  question: string;
  history?: BotMessage[];
}): Promise<BotAnswer> {
  const answer = await answerQuestion({ ...input, skipEscalationShortcuts: true });
  if (answer.findings.some((f) => f.gate === "brand" || f.gate === "overlap") && !answer.text) {
    return { ...answer, text: "" };
  }
  // The escalation fallbacks are written to be READ BY A CLIENT ("let me get someone
  // from the team"). An agent must never be handed one of those as their own draft.
  if (answer.shouldEscalate && answer.citations.length === 0) return { ...answer, text: "" };
  return answer;
}

/** Whether the widget should appear for this sub-account at all. */
export async function isSupportEnabled(ghlLocationId: string): Promise<boolean> {
  const loc = await prisma.locationInstall.findUnique({
    where: { ghlLocationId },
    select: {
      supportEnabled: true,
      status: true,
      agencyInstall: { select: { status: true, supportConfig: { select: { enabled: true } } } },
    },
  });
  if (!loc || loc.status === "removed") return false;
  if (loc.agencyInstall.status === "uninstalled") return false;
  // Both switches must be on: the agency's master switch and this sub-account's toggle.
  return loc.supportEnabled && (loc.agencyInstall.supportConfig?.enabled ?? false);
}
