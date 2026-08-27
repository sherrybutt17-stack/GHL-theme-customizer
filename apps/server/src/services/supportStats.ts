import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { ticketTypeLabel } from "./ticketTypes";
import {
  GHL_SIDEBAR_FEATURES,
  GHL_AGENCY_SIDEBAR_FEATURES,
  GHL_SETTINGS_SIDEBAR_FEATURES,
} from "./ghlSidebarFeatures";

/**
 * Support analytics for ONE agency, for their own dashboard.
 *
 * Why this is a product surface and not a vanity chart: under the Mosaic-staffed model
 * every question the bot handles is a human-minute nobody pays for, so the deflection
 * rate is a direct cost lever. It is also the one reason an agency logs into Mosaic that
 * has nothing to do with theming - "your clients asked about invoicing 40 times this
 * month" is business intelligence they cannot get anywhere else.
 *
 * Scoping is the whole security story here: every query filters on agencyInstallId, and
 * the caller has already been checked by requireAgency. Nothing internal leaks - topic
 * counts come from article TAGS, never titles or source URLs.
 */

const FEATURE_LABELS: Record<string, string> = Object.fromEntries(
  [...GHL_SIDEBAR_FEATURES, ...GHL_AGENCY_SIDEBAR_FEATURES, ...GHL_SETTINGS_SIDEBAR_FEATURES].map((f) => [
    f.key,
    f.label.replace(/\s*\(.*\)$/, "").trim(),
  ])
);

export interface SupportStats {
  days: number;
  totals: {
    conversations: number;
    deflected: number;
    escalated: number;
    handedToAgency: number;
    clientMessages: number;
  };
  /** Share of finished conversations the bot resolved alone. Null when there is no data. */
  deflectionRate: number | null;
  csat: { positive: number; negative: number; rate: number | null };
  /**
   * How long a client waited for a person once the bot handed over.
   *
   * Measured from `queuedAt` — the hand-off — and NOT from `startedAt`. This used to
   * measure from the start of the conversation, which silently included every minute
   * the client spent happily chatting to the bot first: a client who asked three
   * questions over twenty minutes and then got a human reply two minutes after being
   * handed over was reported to their agency as a **22-minute** wait. The number that
   * describes Mosaic's coverage was inflated by the bot being useful. There was no
   * escalation timestamp to measure from until routing added one.
   *
   * `sampleCount` is reported alongside so the dashboard can decline to state a median
   * built on two hand-offs rather than presenting it as a fact.
   */
  firstReply: {
    medianMinutes: number | null;
    p90Minutes: number | null;
    sampleCount: number;
  };
  byLocation: {
    locationInstallId: string;
    locationName: string | null;
    conversations: number;
    deflected: number;
    escalated: number;
  }[];
  /** What clients actually ask about, from the tags of articles the bot cited. */
  topTopics: { key: string; label: string; count: number }[];
  /**
   * What the things that NEEDED A PERSON were about — the complement to `topTopics`, and
   * the reason it exists.
   *
   * `topTopics` is built from the tags of articles the bot CITED, so it can only ever
   * describe questions the knowledge base already answered. The questions that beat the
   * bot are exactly the ones where retrieval found nothing, so they contribute no tags and
   * are INVISIBLE there — the blind spot is documented on that function and this is the
   * only thing in the product that can see past it. It is the agency's most actionable
   * number for the same reason: these are the conversations that cost a human.
   *
   * `untyped` is reported rather than hidden. Types are set by hand on the desk, so a
   * breakdown of only the categorised ones would quietly describe a subset while looking
   * like the whole — the same reasoning as `firstReply.sampleCount`.
   */
  handoffTypes: {
    /** Conversations that reached the human queue at all, in this window. */
    total: number;
    /** Of those, how many nobody categorised. */
    untyped: number;
    types: { key: string; label: string; count: number }[];
  };
  daily: { date: string; conversations: number; deflected: number }[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** The slow tail, where the complaints come from. */
function p90(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1)];
}

export async function supportStats(agencyInstallId: string, days = 30): Promise<SupportStats> {
  const since = new Date(Date.now() - days * 86_400_000);
  const where = { agencyInstallId, startedAt: { gte: since } };

  const conversations = await prisma.conversation.findMany({
    where,
    select: {
      id: true,
      locationInstallId: true,
      status: true,
      deflected: true,
      csat: true,
      ticketType: true,
      startedAt: true,
      queuedAt: true,
      firstAgentReplyAt: true,
      handedToAgencyAt: true,
      locationInstall: { select: { locationName: true } },
    },
  });

  /**
   * What needed a person, by kind.
   *
   * Counted over conversations that reached the human queue at all — `queuedAt` set,
   * which is true for a client escalation AND for a ticket an agent raised from the desk.
   * NOT `status === "escalated"`: that is where a conversation is NOW, so counting it
   * would drop every ticket the desk has since resolved, i.e. exactly the work that got
   * done. The question is what needed a human in this window, not what still does.
   *
   * Computed from rows this function already loaded, so it costs no extra query.
   */
  const handedOff = conversations.filter((c) => c.queuedAt !== null);
  const typeCounts = new Map<string, number>();
  let untyped = 0;
  for (const c of handedOff) {
    if (!c.ticketType) { untyped++; continue; }
    typeCounts.set(c.ticketType, (typeCounts.get(c.ticketType) ?? 0) + 1);
  }
  const handoffTypes: SupportStats["handoffTypes"] = {
    total: handedOff.length,
    untyped,
    types: [...typeCounts.entries()]
      .map(([key, count]) => ({ key, label: ticketTypeLabel(key) ?? key, count }))
      .sort((a, b) => b.count - a.count),
  };

  const escalated = conversations.filter((c) => c.status === "escalated").length;
  const deflected = conversations.filter((c) => c.deflected).length;
  const handedToAgency = conversations.filter((c) => c.handedToAgencyAt).length;

  // Deflection is measured over conversations that actually FINISHED one way or the
  // other. Counting an open conversation as "not deflected" would make the rate look
  // worse every time someone is mid-chat, which is noise, not signal.
  const settled = conversations.filter((c) => c.deflected || c.status === "escalated" || c.status === "resolved");
  const deflectionRate = settled.length ? deflected / settled.length : null;

  const positive = conversations.filter((c) => c.csat === 1).length;
  const negative = conversations.filter((c) => c.csat === 0).length;

  // Only conversations that actually reached the human queue AND got a reply. A
  // conversation with a reply but no `queuedAt` was never handed over — there is no
  // wait to measure, and counting it as an instant response would flatter the number.
  const replyMinutes = conversations
    .filter((c) => c.firstAgentReplyAt && c.queuedAt)
    .map((c) => (c.firstAgentReplyAt!.getTime() - c.queuedAt!.getTime()) / 60000)
    .filter((m) => m >= 0);

  // Per sub-account, so an agency can see WHICH client generates the load.
  const byLocationMap = new Map<string, SupportStats["byLocation"][number]>();
  for (const c of conversations) {
    const row =
      byLocationMap.get(c.locationInstallId) ??
      {
        locationInstallId: c.locationInstallId,
        locationName: c.locationInstall.locationName,
        conversations: 0,
        deflected: 0,
        escalated: 0,
      };
    row.conversations++;
    if (c.deflected) row.deflected++;
    if (c.status === "escalated") row.escalated++;
    byLocationMap.set(c.locationInstallId, row);
  }

  // Daily volume, zero-filled so a quiet day is a gap in the line rather than a
  // missing point that makes the chart lie about the shape.
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const dailyMap = new Map<string, { conversations: number; deflected: number }>();
  for (let i = days - 1; i >= 0; i--) {
    dailyMap.set(dayKey(new Date(Date.now() - i * 86_400_000)), { conversations: 0, deflected: 0 });
  }
  for (const c of conversations) {
    const bucket = dailyMap.get(dayKey(c.startedAt));
    if (bucket) {
      bucket.conversations++;
      if (c.deflected) bucket.deflected++;
    }
  }

  const [clientMessages, topTopics] = await Promise.all([
    prisma.message.count({ where: { role: "user", conversation: where } }),
    topicsFromCitations(conversations.map((c) => c.id)),
  ]);

  return {
    days,
    totals: {
      conversations: conversations.length,
      deflected,
      escalated,
      handedToAgency,
      clientMessages,
    },
    deflectionRate,
    csat: {
      positive,
      negative,
      rate: positive + negative ? positive / (positive + negative) : null,
    },
    firstReply: {
      medianMinutes: median(replyMinutes),
      p90Minutes: p90(replyMinutes),
      sampleCount: replyMinutes.length,
    },
    byLocation: [...byLocationMap.values()].sort((a, b) => b.conversations - a.conversations),
    topTopics,
    handoffTypes,
    daily: [...dailyMap.entries()].map(([date, v]) => ({ date, ...v })),
  };
}

/**
 * "What do clients ask about?" derived from the TAGS of the articles the bot retrieved.
 *
 * Deliberately not an LLM pass over question text: this is free, deterministic, and
 * explainable, and the tags already exist because retrieval needs them for the
 * hiddenFeatures filter. The trade-off is honest - a question that retrieved nothing
 * contributes no topic, so this measures what the KB COVERS, not everything asked. That
 * is still the more actionable number, because an uncovered topic shows up as a rising
 * escalation count instead.
 */
async function topicsFromCitations(conversationIds: string[]): Promise<SupportStats["topTopics"]> {
  if (conversationIds.length === 0) return [];

  const messages = await prisma.message.findMany({
    // Prisma.DbNull, not plain null: a nullable Json column needs the sentinel to
    // express "is not SQL NULL" (plain null is a type error here).
    where: { conversationId: { in: conversationIds }, role: "bot", citations: { not: Prisma.DbNull } },
    select: { citations: true },
  });

  const articleIds = new Set<string>();
  for (const m of messages) {
    if (!Array.isArray(m.citations)) continue;
    for (const c of m.citations as any[]) if (typeof c?.id === "string") articleIds.add(c.id);
  }
  if (articleIds.size === 0) return [];

  const articles = await prisma.kbArticle.findMany({
    where: { id: { in: [...articleIds] } },
    select: { id: true, featureTags: true },
  });
  const tagsById = new Map(articles.map((a) => [a.id, a.featureTags]));

  // Count once per CITATION, not once per article: an article cited in twenty
  // conversations means that topic came up twenty times, which is the question being
  // asked.
  const counts = new Map<string, number>();
  for (const m of messages) {
    if (!Array.isArray(m.citations)) continue;
    for (const c of m.citations as any[]) {
      for (const tag of tagsById.get(c?.id) ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
  }

  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: FEATURE_LABELS[key] ?? key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}
