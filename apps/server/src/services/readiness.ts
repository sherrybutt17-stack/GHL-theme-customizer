import { prisma } from "./prisma";
import { MAX_TIER } from "./deskQueue";

/**
 * "The deploy went green and the product is dead."
 *
 * This project has shipped that state twice — the support half was absent from the
 * Blueprint entirely, and the desk was write-only for its whole life — so it is worth a
 * check of its own rather than trust.
 *
 * `validateEnv` already covers configuration, thoroughly, and refuses to boot on the
 * fatal gaps. What it structurally cannot see is the other half: the failures that hurt
 * most here are DATABASE facts. An unseeded knowledge base, a desk with no staff, a tier
 * nobody covers — every one of them boots clean, logs nothing, serves 200s, and quietly
 * answers nobody.
 *
 * Severity is deliberately computed from env AND data together, because the same missing
 * value means different things. `OPENAI_API_KEY` unset is a footnote on an install that
 * has never switched support on, and the single most important line in the log on one
 * that has.
 */
export type Severity = "blocker" | "warning";

export interface Finding {
  id: string;
  severity: Severity;
  /** What is wrong, in one line. */
  what: string;
  /** The SYMPTOM somebody would otherwise be looking at, since none of these throw. */
  why: string;
  /** The command or setting that fixes it. */
  fix: string;
}

export interface Readiness {
  findings: Finding[];
  supportEnabled: boolean;
}

export async function checkReadiness(): Promise<Readiness> {
  const findings: Finding[] = [];

  const [
    activeAgencies, activeLocations, supportAgencies, widgetLocations, kbReady, deskUsers,
    feeds, sharedPending,
  ] = await Promise.all([
      prisma.agencyInstall.findMany({ where: { status: "active" }, select: { id: true, companyName: true } }),
      // Grouped per agency for the same reason as widgetLocations below: a global count
      // is satisfied by ONE agency having sub-accounts, which is exactly how an agency
      // whose sync never ran stays invisible.
      prisma.locationInstall.groupBy({
        by: ["agencyInstallId"],
        where: { status: "active", enabled: true },
        _count: true,
      }),
      prisma.supportConfig.findMany({
        where: { enabled: true },
        select: { agencyInstallId: true, escalationEmails: true },
      }),
      /**
       * Grouped PER AGENCY, not counted globally. A global count is the failure this
       * whole file is about, in miniature: one agency with the widget switched on
       * anywhere makes the count non-zero, so every OTHER agency that turned support on
       * and enabled it on no sub-account reads as fine. Caught by the live check, which
       * is the only reason it isn't still here — the global version passes on a
       * one-agency dev database and is wrong the moment there are two.
       */
      prisma.locationInstall.groupBy({
        by: ["agencyInstallId"],
        where: { supportEnabled: true, status: "active" },
        _count: true,
      }),
      prisma.kbArticle.count({ where: { status: "ready" } }),
      prisma.deskUser.findMany({ where: { status: "active" }, select: { tier: true, email: true } }),
      /**
       * Feeds are the only thing keeping the corpus current, and every way they fail is
       * silent by construction: polling is an external script, so nothing in the request
       * path ever notices it stopped.
       *
       * A SHARED feed is the sharp case. An agency's own feed at least surfaces its error
       * in their "Your content" tab; a shared one belongs to no agency, so there is no
       * dashboard anywhere that shows it. Exactly the gap that made the shared review
       * queue write-only — shared content has no owner, so no per-tenant screen covers it.
       */
      prisma.kbFeed.findMany({
        select: {
          id: true, url: true, enabled: true, autoPublish: true, createdAt: true,
          lastPolledAt: true, lastError: true, consecutiveErrors: true, agencyInstallId: true,
        },
      }),
      prisma.kbArticle.groupBy({
        by: ["feedId"],
        where: { status: "needs_review", agencyInstallId: null },
        _count: true,
      }),
    ]);
  const agenciesWithWidget = new Set(widgetLocations.map((g) => g.agencyInstallId));

  const supportEnabled = supportAgencies.length > 0;
  const add = (f: Finding) => findings.push(f);

  // --- Theming: the live product ---
  const agenciesWithLocations = new Set(activeLocations.map((g) => g.agencyInstallId));
  if (activeAgencies.length === 0) {
    add({
      id: "no-agencies",
      severity: "warning",
      what: "No agency has installed the app.",
      why: "Expected on a fresh deploy; unexpected if anyone has completed OAuth.",
      fix: "Install from the GHL marketplace listing, or check /authorize-handler in the logs.",
    });
  } else {
    const empty = activeAgencies.filter((a) => !agenciesWithLocations.has(a.id));
    if (empty.length > 0) {
      add({
        id: "no-locations",
        severity: "blocker",
        what: `${empty.length} of ${activeAgencies.length} agency install(s) have zero active sub-accounts: ${empty
          .map((a) => a.companyName ?? a.id)
          .slice(0, 5)
          .join(", ")}`,
        why: "The stylesheet is generated per sub-account, so their theme is empty — the agency pastes the @import and nothing whatsoever changes.",
        fix: "npm run sync-locations --workspace apps/server",
      });
    }
  }

  // --- Feeds: the corpus goes stale silently, and staleness has no error path ---
  //
  // Polling is an external script by design (the free instance sleeps, and two instances
  // would race the same upserts). The cost of that decision is that NOTHING in the
  // request path can notice it stopped: the bot keeps answering, confidently, from
  // whatever it learned last. A wrong answer delivered fluently is worse than a hand-off.
  if (feeds.length > 0) {
    const DAY = 86_400_000;
    const describe = (f: (typeof feeds)[number]) => (f.agencyInstallId ? f.url : `${f.url} (shared)`);

    // A feed added an hour ago has legitimately not polled yet; one added last week has
    // not been scheduled at all. Without the age window this trips the moment anyone
    // adds a feed, and a check that cries wolf on correct behaviour gets ignored.
    const neverPolled = feeds.filter(
      (f) => f.enabled && !f.lastPolledAt && Date.now() - f.createdAt.getTime() > DAY
    );
    if (neverPolled.length > 0) {
      add({
        id: "feed-never-polled",
        severity: "warning",
        what: `${neverPolled.length} feed(s) have never been polled: ${neverPolled.map(describe).join(", ")}.`,
        why: "Somebody configured a feed and reasonably believes the corpus is updating itself. It is not — polling is an external script, so a feed nobody schedules is a setting that looks live and does nothing.",
        fix: "Schedule `npm run poll-feeds --workspace @ghl-theme-builder/server` (hourly is plenty), or run it by hand to confirm the feed works.",
      });
    }

    // The scheduler dying looks exactly like a publisher who stopped writing.
    const stale = feeds.filter(
      (f) => f.enabled && f.lastPolledAt && Date.now() - f.lastPolledAt.getTime() > 7 * DAY
    );
    if (stale.length > 0) {
      add({
        id: "feed-stale",
        severity: "warning",
        what: `${stale.length} feed(s) have not been polled in over a week: ${stale.map(describe).join(", ")}.`,
        why: "The scheduler has stopped, or was never carried over to this environment. Nothing errors: the bot keeps answering from a corpus that is quietly ageing, which is indistinguishable from a publisher who went quiet.",
        fix: "Check whatever calls `poll-feeds` is still running against this deployment.",
      });
    }

    // Auto-disabled after 10 consecutive failures. An AGENCY's feed at least shows its
    // error on their own "Your content" tab; a SHARED feed belongs to no agency, so no
    // screen in the product displays it. This is the only place it can be seen.
    const dead = feeds.filter((f) => !f.enabled);
    if (dead.length > 0) {
      const shared = dead.filter((f) => !f.agencyInstallId).length;
      add({
        id: "feed-disabled",
        severity: "warning",
        what: `${dead.length} feed(s) are disabled after repeated failures${shared ? `, ${shared} of them shared` : ""}: ${dead.map((f) => `${describe(f)} — ${f.lastError ?? "no error recorded"}`).join("; ")}.`,
        why: "Disabled rather than deleted, so the URL is recoverable — but a shared feed has no agency dashboard to surface its error, so nothing else in the product will ever mention it again.",
        fix: "Fix or replace the URL, then re-enable the feed. If the publisher is genuinely gone, delete it so this stops reporting.",
      });
    }

    // Items that arrived, passed every gate, and are waiting on a human who does not
    // know they exist. The feed reports success the whole time.
    const pending = sharedPending.reduce((n, g) => n + (g.feedId ? g._count : 0), 0);
    if (pending > 0) {
      add({
        id: "feed-review-backlog",
        severity: "warning",
        what: `${pending} shared feed article(s) are waiting for review.`,
        why: "They are not retrievable, so the corpus is not actually growing. The feed reports success on every poll and nothing else mentions the backlog — shared content has no agency dashboard to appear on.",
        fix: "npm run review-kb --workspace @ghl-theme-builder/server",
      });
    }
  }

  // --- Support: every one of these boots clean and answers nobody ---
  if (supportEnabled) {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      add({
        id: "no-model-key",
        severity: "blocker",
        what: "Support is switched on but OPENAI_API_KEY is not set.",
        why: 'The bot cannot generate an answer, so it replies "let me get someone from the team" to EVERY question. The widget appears, works, logs no error, and deflects nothing.',
        fix: "Set OPENAI_API_KEY on the server service and redeploy.",
      });
    }
    if (kbReady === 0) {
      add({
        id: "kb-empty",
        severity: "blocker",
        what: "Support is switched on but no knowledge-base article is retrievable.",
        why: "Retrieval returns nothing, which the bot reads as thin retrieval and hands to a human — indistinguishable in the logs from a missing model key, and it files a ticket every time.",
        fix: "npm run seed-kb --workspace @ghl-theme-builder/server",
      });
    }
    const widgetless = supportAgencies.filter((c) => !agenciesWithWidget.has(c.agencyInstallId));
    if (widgetless.length > 0) {
      add({
        id: "no-support-locations",
        severity: "warning",
        what: `${widgetless.length} agency/agencies have support on but no sub-account with it enabled.`,
        why: "Both switches are required, so the widget renders for nobody. The agency sees their master switch on and concludes the product is broken.",
        fix: 'Turn on the "Support" column for at least one sub-account in the dashboard.',
      });
    }
    const noEscalation = supportAgencies.filter((c) => c.escalationEmails.length === 0);
    if (noEscalation.length > 0) {
      add({
        id: "no-escalation-email",
        severity: "blocker",
        what: `${noEscalation.length} agency support config(s) have no escalation address.`,
        why: "A tier-3 hand-off is refused rather than silently dropped, so anything outside our remit dead-ends on the client.",
        fix: "Set an escalation email in the agency's support settings (the PUT normally enforces this; a pre-existing row can predate it).",
      });
    }

    // --- The desk: staffing is a data fact and nothing else checks it ---
    if (deskUsers.length === 0) {
      add({
        id: "no-desk-staff",
        severity: "blocker",
        what: "Support is on but there is not one active desk account.",
        why: "Every escalation lands in a queue nobody can open. Accounts are created by hand — there is deliberately no signup — so a fresh deploy has zero.",
        fix: 'npm run create-desk-user --workspace @ghl-theme-builder/server -- --email a@b.c --name "Name" --role mosaic_admin',
      });
    } else {
      // Every account starts at tier 1. A ticket escalated to a tier nobody holds is
      // never routed and never transferred: it looks handled and waits forever.
      const topTier = Math.max(...deskUsers.map((u) => u.tier));
      if (topTier < MAX_TIER) {
        add({
          id: "unstaffed-tiers",
          severity: "warning",
          what: `No desk account above tier ${topTier} (tiers ${topTier + 1}–${MAX_TIER} are unstaffed).`,
          why: "Escalating past the top staffed tier leaves a ticket routable to nobody — it reads as handled on every screen and is answered by no one.",
          fix: "Raise someone's tier in the desk's Staff tab.",
        });
      }
    }

    /**
     * A LIVE desk account on a reserved test domain is a harness fixture that outlived its
     * run, and every one of them can read every agency's support conversations.
     *
     * The suites create these with a password that is a constant in the repository, and
     * their teardown is armed on SIGINT/SIGTERM — which a SIGKILL (a CI timeout, a killed
     * terminal) does not honour. Measured 2026-08-26 on this database: two accounts left
     * `active` by a run the harness timed out and killed at 120 seconds. Per-run stamps
     * make such leftovers inert to the SUITES; they do nothing about the accounts being
     * usable, and nothing else in the product will ever mention them again.
     *
     * `.test` is RESERVED by RFC 6761 — the same argument `env.ts` makes for `.localhost` —
     * so this is a rule rather than a guess: nobody creates a real account there.
     */
    const fixtureAccounts = deskUsers.filter((u) => /\.(test|invalid|example)$/i.test(u.email.split("@")[1] ?? ""));
    if (fixtureAccounts.length > 0) {
      add({
        id: "harness-desk-accounts",
        severity: "warning",
        what: `${fixtureAccounts.length} active desk account(s) are on a reserved test domain: ${fixtureAccounts
          .map((u) => u.email)
          .join(", ")}.`,
        why: "These are test fixtures a suite failed to clean up, and their passwords are constants in the repository. Every desk account can read every agency's support conversations, and nothing else in the product will ever mention them.",
        fix: "Delete them, or disable them if one is a deliberate local login.",
      });
    }

    /**
     * A ticket assigned to a disabled account is held by somebody who cannot sign in.
     * `releaseTicketsFrom` now returns them on disable, but the state is still reachable
     * without that route — a psql session, or any row written before it existed — and it
     * is the exact shape this file is for: nothing throws, every screen reports the
     * ticket as handled, and a real client waits on an answer that is never coming.
     *
     * Queried by relation rather than by fetching disabled ids first, so an install with
     * a long staff history costs one query either way.
     */
    const stranded = await prisma.conversation.count({
      where: { status: { in: ["escalated", "open"] }, assignedTo: { status: "disabled" } },
    });
    if (stranded > 0) {
      add({
        id: "stranded-tickets",
        severity: "blocker",
        what: `${stranded} live conversation(s) are assigned to a disabled desk account.`,
        why: "They are invisible: the queue only holds unassigned tickets, so 'take next' cannot reach them, distribute skips them, and the client's widget says somebody has picked it up rather than showing a place in line. Nobody has.",
        fix: "Re-open and re-assign them from the desk inbox, or disable and re-enable the account — disabling now returns held tickets to the queue.",
      });
    }

    if (!process.env.RESEND_API_KEY?.trim()) {
      add({
        id: "no-email",
        severity: "warning",
        what: "Support is on but no email provider is configured.",
        why: "A supported state, not a fault: escalations are recorded before any send, so the queue is the source of truth. But nobody is alerted, so the desk must be watched.",
        fix: "Set RESEND_API_KEY, EMAIL_FROM (needs SPF/DKIM) and DESK_NOTIFY_EMAIL — or accept it and watch the queue.",
      });
    }

    /**
     * Is anything actually RUNNING the ticket automations?
     *
     * This check is self-validating rather than a configuration read, which is the only
     * version worth having: the scheduler lives in GitHub Actions, outside this
     * deployment entirely, so nothing in the request path can observe whether it fired.
     * What we CAN observe is its work not being done — a conversation well past any
     * plausible response target whose `slaBreachedAt` is still null could not exist if a
     * pass had run.
     *
     * The window is deliberately generous (a full day against a ten-minute cadence). The
     * job runs on a free scheduler that delays under load, and a readiness blocker that
     * fires because Actions was twenty minutes late is one people learn to ignore — at
     * which point it is worse than absent.
     */
    const AUTOMATION_GRACE_HOURS = 24;
    const unsweptSince = new Date(Date.now() - AUTOMATION_GRACE_HOURS * 3_600_000);
    const unswept = await prisma.conversation.count({
      where: {
        status: "escalated",
        firstAgentReplyAt: null,
        slaBreachedAt: null,
        queuedAt: { not: null, lte: unsweptSince },
      },
    });
    if (unswept > 0) {
      add({
        id: "automations-never-run",
        severity: "blocker",
        what: `${unswept} conversation(s) have been waiting over ${AUTOMATION_GRACE_HOURS}h with no response-target check recorded.`,
        why: "Nothing is running the ticket automations, so no unclaimed ticket is ever nudged, no missed response target escalates, no snooze comes back and no idle chat is closed. The desk looks the same either way — the queue still lists everything — which is exactly why this is invisible until a client complains.",
        fix: "Add the DATABASE_URL secret in GitHub → Settings → Secrets → Actions so .github/workflows/ticket-automations.yml can run, or run `npm run ticket-automations --workspace @ghl-theme-builder/server` on a schedule of your own.",
      });
    }

    /**
     * Desk-raised tickets with nobody to reach.
     *
     * A warning rather than a blocker: the ticket is still worked, and the transcript is
     * still the record. What is lost is every follow-up — there is no address, so any
     * notification about it is silently a no-op.
     */
    const noContact = await prisma.conversation.count({
      where: { origin: "desk", contactEmail: null, status: { in: ["open", "escalated"] } },
    });
    if (noContact > 0) {
      add({
        id: "tickets-without-contact",
        severity: "warning",
        what: `${noContact} desk-raised ticket(s) have no contact email.`,
        why: "The client reached us by phone or through their agency, so the widget is not where they are looking. Without an address there is no way to tell them anything, and every notification about the ticket quietly does nothing.",
        fix: "Add the client's email on the ticket in the desk, or follow up through whoever reported it.",
      });
    }
  }

  return { findings, supportEnabled };
}

export function formatReadiness({ findings, supportEnabled }: Readiness): string {
  if (findings.length === 0) {
    return `[readiness] all checks passed (support ${supportEnabled ? "on" : "off"}).`;
  }
  const lines = findings.map(
    (f) => `  ${f.severity === "blocker" ? "BLOCKER" : "warning"}  ${f.what}\n           ${f.why}\n           fix: ${f.fix}`
  );
  const blockers = findings.filter((f) => f.severity === "blocker").length;
  return [
    `[readiness] ${blockers} blocker(s), ${findings.length - blockers} warning(s):`,
    ...lines,
  ].join("\n");
}

/**
 * Boot-time report. Deliberately NOT an HTTP endpoint: a public URL enumerating exactly
 * which of our safeguards are unconfigured is a gift to anyone probing, and the moment
 * this is worth reading is the moment somebody is already looking at the deploy log.
 *
 * Never throws and never blocks the listen — a readiness check that can take the service
 * down is worse than the misconfiguration it reports.
 */
export async function reportReadiness(): Promise<void> {
  try {
    console.log(formatReadiness(await checkReadiness()));
  } catch (e) {
    console.warn(`[readiness] check could not run: ${(e as Error)?.message ?? e}`);
  }
}
