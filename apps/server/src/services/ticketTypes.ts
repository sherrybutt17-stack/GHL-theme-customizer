/**
 * What kind of problem a ticket is.
 *
 * A FIXED LIST, not free text, and that is the whole point of the file. Free text turns
 * into forty spellings of "billing" and answers no question at all — and this column
 * exists precisely to answer one: what do clients actually contact us about?
 *
 * Nothing else in the product can answer it. The topic breakdown in `supportStats` is
 * built from the `featureTags` of CITED articles, which is honest about what it measures
 * (see CLAUDE.md) but structurally blind: a question that retrieved nothing contributes
 * no topic, so the questions we answer WORST are the ones missing from the report. A
 * type chosen by the agent who worked the ticket has no such blind spot.
 *
 * Keys are stored; labels are display only. Renaming a label is free, renaming a key
 * orphans every row that already used it — so treat the keys as permanent.
 */

export interface TicketTypeOption {
  key: string;
  label: string;
  /** Shown under the label when picking, so two adjacent types can't be confused. */
  hint: string;
}

export const TICKET_TYPES: TicketTypeOption[] = [
  {
    key: "how_to",
    label: "How do I…",
    hint: "They want to do something and can't find how.",
  },
  {
    key: "not_working",
    label: "Something's broken",
    hint: "It used to work, or it plainly doesn't.",
  },
  {
    key: "setup",
    label: "Setup or onboarding",
    hint: "Getting started, connecting something, first-time configuration.",
  },
  {
    key: "billing",
    label: "Billing or plan",
    hint: "Their invoice, plan or payment. Belongs with the agency, not us.",
  },
  {
    key: "feature_request",
    label: "Can it do…?",
    hint: "Asking for something that may not exist. Commercially interesting.",
  },
  {
    key: "bug_report",
    label: "Suspected bug",
    hint: "Reproducible and wrong, as opposed to confusing.",
  },
  {
    key: "account",
    label: "Account or access",
    hint: "Logins, permissions, users, who can see what.",
  },
  {
    key: "other",
    label: "Something else",
    hint: "Use sparingly — a full 'other' column tells you nothing.",
  },
];

const KEYS = new Set(TICKET_TYPES.map((t) => t.key));

/**
 * Normalise a submitted type, or null.
 *
 * Returns null for BOTH "not supplied" and "not recognised", deliberately. A ticket type
 * is a label on work, never a permission or a route — so an unknown one costs a missing
 * facet in a report, and rejecting the whole ticket over it would lose the actual support
 * request somebody was trying to record.
 */
export function normalizeTicketType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return KEYS.has(trimmed) ? trimmed : null;
}

export function ticketTypeLabel(key: string | null): string | null {
  if (!key) return null;
  return TICKET_TYPES.find((t) => t.key === key)?.label ?? key;
}
