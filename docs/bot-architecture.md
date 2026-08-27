# The support bot: where it lives, how it's configured, how it improves

Design notes for Steps 2–4 of the support build. Answers four questions: where the bot
runs, how it's "trained" per client, how each widget gets its own configuration, and
what "ever-learning" actually means here.

---

## 1. Where the bot lives

**In the existing Express server**, as `services/supportBot.ts` — not a separate service.

```
apps/server/src/services/
  kbIngest.ts      crawl → placeholder-normalize → KbArticle
  kbSearch.ts      Postgres tsvector retrieval
  brandTerms.ts    resolve the per-sub-account brand map
  supportBot.ts    assemble prompt → call Claude → return a draft answer
  answerGuard.ts   the three gates (blocklist / link strip / verbatim overlap)
apps/server/src/routes/
  support.ts       public widget API (conversation, message, feedback)
```

**Why not a separate AI service.** Every input the bot needs already lives in this
process's database: `ThemeConfig.brandName`, `menuLabelOverrides`, `hiddenFeatures`,
`SupportConfig`. Splitting the bot out would mean either replicating that data or
calling back for it on every message — new failure modes, new latency, for nothing.
The knowledge that makes this bot good is *theme* knowledge, and it lives here.

**Dependency:** the official Anthropic SDK (`@anthropic-ai/sdk`). Model
`claude-opus-5` to start — correctness matters more than cost while the gates are being
proven, and leak rate should be A/B'd before dropping to `claude-haiku-4-5`.

---

## 2. How the bot is "trained" for each client

### We do not train it. There is no per-client model.

This is worth being blunt about, because "train a bot for each client" is the intuitive
mental model and it's the wrong architecture here. Fine-tuning a model per agency would
be:

- **Slow to update** — an agency renames a menu item and you'd retrain. Unacceptable
  when renames are a core feature of the product.
- **Unauditable** — knowledge baked into weights can't be inspected, filtered, or
  removed. That directly conflicts with the white-label requirement, which depends on
  being able to *guarantee* what the model can and cannot see.
- **Expensive and brittle** — one fine-tune per agency, redone on every content change.

### What actually happens: retrieval + configuration, assembled per request

Everything is one shared model and one shared knowledge base. The per-client behaviour
comes from what gets put in front of it at request time:

```
REQUEST: (agencyInstallId, locationId, question)
   │
   ├─ 1. Resolve brand map          brandTerms.ts
   │     ThemeConfig.brandName      → {{PLATFORM}}  = "Acme Portal"
   │     menuLabelOverrides         → {{FEATURE:opportunities}} = "Leads"
   │     hiddenFeatures             → chunks to DROP
   │     SupportConfig              → voice, boundary, forbidden terms, user noun
   │
   ├─ 2. Retrieve                   kbSearch.ts
   │     tsvector search over placeholdered text
   │     filter out anything tagged with a hidden feature
   │     rank the agency's OWN articles above GHL-derived ones
   │
   ├─ 3. Render                     substitute placeholders using the brand map
   │
   ├─ 4. Ask Claude                 supportBot.ts
   │     ┌ global system prompt ────────────── identical for every agency
   │     │   identity, tone rules, "no vendor exists", escalation criteria
   │     ├ CACHE BREAKPOINT ─────────────────  ~100% hit rate, reads cost ~0.1×
   │     └ per-agency glossary + rendered chunks + conversation
   │
   └─ 5. Gate                       answerGuard.ts → client
```

**The consequence that matters:** an agency changes their brand name in the dashboard
and **the very next answer uses it**. No retraining, no reindexing, no delay. Because
the knowledge base stores `{{PLATFORM}}` rather than any brand name, one canonical copy
serves every agency, and personalization is a substitution at render time.

### What each agency actually configures

Not training data — six required fields (see the plan, §2b). Brand name, support
boundary, escalation contact, business hours, extra forbidden terms, allowed link
domains. Plus optional voice/tone and their own articles. **Every field has a fallback
that fails safe**: an agency that configures nothing gets a vague bot, never a leaky one.

---

## 3. Making each widget use the right configuration

### Identity comes from the request, never from the widget

The widget knows two things: the `agencyInstallId` baked into its pasted snippet, and
the `locationId` read from the page
([themeBundleScript.ts:69-77](../apps/server/src/services/themeBundleScript.ts#L69-L77)
already solves this, including SPA route changes).

**The widget never sends its own brand configuration.** It sends only *who it is*; the
server looks up what that means. This is a security property, not a style preference —
if the widget declared its own brand name and forbidden-terms list, anyone could forge a
request with an empty list and read unfiltered answers.

```
widget  ──POST /support/api/message──►  { agencyInstallId, locationId, text }
                                         │
server                                   ├─ verify the location belongs to that agency
                                         ├─ verify support is enabled for it
                                         └─ resolve config SERVER-SIDE
```

### Three-level config cascade

```
SupportConfig (location override)   ← this one sub-account differs
      ↓ falls back to
SupportConfig (agency)              ← the normal case
      ↓ falls back to
safe defaults                       ← "your dashboard", strip all links,
                                       how-to questions only
```

### Appearance and behaviour ride the endpoint that already exists

`GET /theme-bundle/:agency/config/:loc` already returns per-location branding. It gains
a `support: { enabled, greeting, quickActions[], businessHours }` block. So the widget
renders in the agency's colours with their logo using data it already fetches — one
request, no new public surface.

### Caching

The resolved brand map is **derived, not stored** — computed per (agency, location) and
cached in-process with a short TTL, invalidated when a theme saves. Storing it would
create a second source of truth for data that already has one, and stale brand data is
exactly the failure that breaks the white label.

---

## 4. "Ever-learning" — what that can and cannot mean

### The honest part first

**An LLM does not learn from conversations.** Claude's weights are fixed; nothing a
client types on Tuesday changes what the model knows on Wednesday. Any product claiming
its bot "learns from every chat" is describing one of the loops below, not the model.

That's fine — because the loops below are where the improvement actually comes from, and
unlike weight updates they're inspectable, reversible, and cheap.

### What genuinely improves, and how

**A. The knowledge base grows from your team's own work — the most valuable loop.**

When a Mosaic agent answers a ticket the bot couldn't, that answer is *the missing
article*. Rather than letting it evaporate into a closed ticket:

```
agent sends reply → offered "save this as a knowledge article?"
                  → placeholdered ({{PLATFORM}}, {{FEATURE:x}}) automatically
                  → reviewed → becomes a KbArticle, ranked above crawled content
```

Your team's effort compounds instead of being spent once. This is also what makes the
bot get *specifically* better at the questions your agencies actually ask.

**B. The gap queue turns failure into a content backlog.**

Every thumbs-down, every escalation, every low-confidence retrieval is logged with the
question and what was retrieved. Aggregated and ranked by frequency, that list *is* the
list of articles to write next — ordered by how much human time each would save.

**C. Scheduled recrawl with change detection.**

Hash each source article. On recrawl, changed articles are re-normalized and flagged for
review. GHL ships UI changes constantly and has a rolling design-system migration
running through 2026 — documentation drift is guaranteed, and a bot confidently giving
last year's instructions is worse than one that says it doesn't know.

**D. Retrieval tuning from real queries.**

Log `query → chunks retrieved → was it resolved`. When FTS misses because a client said
"pipeline" and the article says "opportunities", that's a synonym-map entry. This is
where measurable accuracy gains come from long before a model upgrade would.

**E. The guard metrics tune the prompt.**

`brandLeakHits` and `overlapRejects` per agency point at exactly which prompt wording or
blocklist entry needs work. Rising leak rate is a regression signal.

### The deliberate limit: a human approves before anything enters the KB

Auto-ingesting unreviewed answers into a white-label knowledge base is how you get a bot
that is confidently wrong **in the agency's own voice**. The approval step stays. It's
cheap — one click on a reply an agent already wrote — and it's the difference between a
system that compounds quality and one that compounds errors.

### What "the best version of itself" actually looks like

Not a smarter model. A knowledge base that is mostly *yours*: agency-specific processes,
your team's proven answers, and only a thin crawled layer underneath. That version
answers questions GHL's docs never could, carries no crawl-legality risk, and is
something no competitor can copy — because it's built from work only you have done.

---

## Build implications

| Step | What this section adds |
|---|---|
| 2 — KB pipeline | `contentHash` on `KbArticle` for change detection; `source` ranking (agency > ghl) |
| 3 — White-label layer | Brand map resolution is derived + TTL-cached, never stored |
| 4 — Bot + widget | Cache breakpoint placement; config resolved server-side from (agency, location), never trusted from the client |
| 5 — Desk | "Save as knowledge article" on agent replies, with automatic placeholdering + review |
| Throughout | Gap queue table; query/retrieval logging; recrawl schedule |
