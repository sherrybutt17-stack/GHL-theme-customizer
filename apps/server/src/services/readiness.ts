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

  const [activeAgencies, activeLocations, supportAgencies, widgetLocations, kbReady, deskUsers] =
    await Promise.all([
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
      prisma.deskUser.findMany({ where: { status: "active" }, select: { tier: true } }),
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
