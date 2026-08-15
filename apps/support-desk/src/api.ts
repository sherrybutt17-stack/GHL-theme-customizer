const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3210";

/**
 * Desk API client.
 *
 * Note what is absent: any token handling. The agency dashboard has to juggle a
 * token through a URL fragment into sessionStorage because it runs inside GHL's
 * iframe, where cookies are unreliable. The desk is a standalone origin, so the
 * session rides an httpOnly cookie the browser attaches automatically - JS never
 * sees it, so an XSS here cannot steal a session.
 *
 * Two things every request must carry:
 *   credentials: "include"  - the cookie is cross-origin (desk :5174 → API :3000)
 *   x-mosaic-desk: "1"      - CSRF defence. A cross-site page cannot set a custom
 *                             header without a preflight, and only SUPPORT_DESK_URL
 *                             gets one. See services/deskAuth.ts.
 */

export type DeskRole = "mosaic_agent" | "mosaic_admin";

export interface DeskUser {
  id: string;
  email: string;
  name: string;
  role: DeskRole;
  availability?: "available" | "away";
  tier?: number;
  maxConcurrent?: number;
}

export interface DeskUserAdminView extends DeskUser {
  status: "active" | "disabled";
  lastLoginAt: string | null;
  createdAt: string;
  /** Routing, not access — see the schema note on DeskAvailability. */
  availability: "available" | "away";
  tier: number;
  maxConcurrent: number;
}

/** Thrown for any non-2xx so callers can branch on 401 vs a real failure. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Called whenever the server says our session is no longer good.
 *
 * The comment on ApiError promised callers could "branch on 401 vs a real failure", and
 * not one of them did. So an expired — or REVOKED — session left an agent looking at a
 * fully rendered desk with their own name in the top bar while every action failed. That
 * is not hypothetical: revocation is a designed feature here (disabling a user kills
 * their live sessions in the same call, which is the entire reason these sessions are
 * DB-backed rather than stateless), and its whole point is that it takes effect while
 * somebody is mid-shift.
 *
 * Central, not per-call, for the reason the per-call version already failed: there are
 * ~25 endpoints and any one of them forgotten is an agent stranded on a dead desk.
 */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-mosaic-desk": "1",
        ...(init.headers ?? {}),
      },
    });
  } catch {
    // A network-level failure is indistinguishable from a CORS rejection in the
    // browser, and "failed to fetch" tells an operator nothing actionable.
    throw new ApiError(0, "Could not reach the Mosaic server. Check that it's running and that SUPPORT_DESK_URL matches this origin.");
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body; fall back to statusText */
    }
    // Fires for /me too, which 401s on a first visit — App.tsx ignores it until it has
    // actually seen a signed-in user, so the handler never has to guess.
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const login = (email: string, password: string) =>
  request<{ user: DeskUser }>("/desk/api/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

export const logout = () => request<{ ok: true }>("/desk/api/logout", { method: "POST" });

export const me = () => request<{ user: DeskUser }>("/desk/api/me");

export const listUsers = () => request<DeskUserAdminView[]>("/desk/api/users");

export const createUser = (input: { email: string; name: string; password: string; role: DeskRole }) =>
  request<DeskUserAdminView>("/desk/api/users", { method: "POST", body: JSON.stringify(input) });

export const setUserEnabled = (id: string, enabled: boolean) =>
  request<{ ok: true; revokedSessions?: number; releasedTickets?: number }>(
    `/desk/api/users/${id}/${enabled ? "enable" : "disable"}`,
    { method: "POST" }
  );

export const changePassword = (currentPassword: string, newPassword: string) =>
  request<{ ok: true }>("/desk/api/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });

// --- Inbox ---

export type TicketStatus = "open" | "resolved" | "escalated" | "abandoned";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export interface InboxRow {
  id: string;
  status: TicketStatus;
  priority: TicketPriority;
  tier: number;
  /** When it entered the HUMAN queue — the clock the wait is measured from. */
  queuedAt: string | null;
  subject: string | null;
  /** What the CLIENT calls the platform — the name we must answer as. */
  brandName: string | null;
  agencyInstallId: string;
  agencyName: string | null;
  locationName: string | null;
  assignedTo: { id: string; name: string } | null;
  lastMessageAt: string;
  startedAt: string;
  firstAgentReplyAt: string | null;
  handedToAgencyAt: string | null;
  preview: string;
  brandLeakHits: number;
}

/** Everything the agent must have in front of them before typing a word. */
export interface BrandContext {
  brandName: string | null;
  brandNameSource: string | null;
  renamedLabels: Record<string, string>;
  hiddenFeatures: string[];
  forbiddenTerms: string[];
  allowedLinkDomains: string[];
  supportBoundary: "how_to_only" | "how_to_and_account" | "custom";
  boundaryNotes: string | null;
  escalationEmails: string[];
  userNoun: string | null;
}

export interface TicketMessage {
  id: string;
  role: "user" | "bot" | "agent" | "system";
  body: string;
  createdAt: string;
  /** Titles only — never URLs. A link a rep can see is a link that gets pasted. */
  citations: { title: string | null }[] | null;
}

export interface Ticket {
  id: string;
  status: TicketStatus;
  priority: TicketPriority;
  tier: number;
  queuedAt: string | null;
  subject: string | null;
  agencyInstallId: string;
  agencyName: string | null;
  locationName: string | null;
  ghlLocationId: string;
  assignedTo: { id: string; name: string; email: string } | null;
  startedAt: string;
  lastMessageAt: string;
  firstAgentReplyAt: string | null;
  handedToAgencyAt: string | null;
  deflected: boolean;
  csat: number | null;
  contextSnapshot: { pageUrl?: string; userAgent?: string; cssApplied?: boolean } | null;
  brandLeakHits: number;
  overlapRejects: number;
  context: BrandContext;
  messages: TicketMessage[];
}

export interface GateFinding {
  gate: "brand" | "link" | "overlap";
  detail: string;
  sample?: string;
}

/** A refused send. 422 means the request was fine and the CONTENT was rejected. */
export interface BlockedReply {
  blocked: true;
  findings: GateFinding[];
  reasons: string[];
}

export interface CannedReply {
  id: string;
  title: string;
  body: string;
  agencyInstallId: string | null;
}

export const fetchInbox = (params: { status?: string; mine?: boolean; unassigned?: boolean } = {}) => {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  if (params.mine) q.set("mine", "1");
  if (params.unassigned) q.set("unassigned", "1");
  return request<{ conversations: InboxRow[]; counts: { escalated: number; open: number; unassigned: number } }>(
    `/desk/api/inbox?${q}`
  );
};

export const fetchTicket = (id: string) => request<Ticket>(`/desk/api/conversations/${id}`);

export const assignTicket = (id: string, assigneeId?: string | null) =>
  request<{ id: string; assignedTo: { id: string; name: string } | null }>(
    `/desk/api/conversations/${id}/assign`,
    { method: "POST", body: JSON.stringify({ assigneeId }) }
  );

export const updateTicket = (id: string, patch: { status?: TicketStatus; priority?: TicketPriority; subject?: string }) =>
  request<{ id: string; status: TicketStatus; priority: TicketPriority; subject: string | null }>(
    `/desk/api/conversations/${id}`,
    { method: "PATCH", body: JSON.stringify(patch) }
  );

/**
 * Check a draft without sending. The server re-runs the identical check on send, so
 * this is a fast warning, never the enforcement.
 */
export const checkDraft = (id: string, text: string) =>
  request<{ blocked: boolean; findings: GateFinding[] }>(`/desk/api/conversations/${id}/check`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });

export const sendReply = (id: string, text: string, internal = false) =>
  request<TicketMessage>(`/desk/api/conversations/${id}/reply`, {
    method: "POST",
    body: JSON.stringify({ text, internal }),
  });

export const draftReply = (id: string) =>
  request<{ draft: string; citations: { title: string | null }[]; thin: boolean }>(
    `/desk/api/conversations/${id}/draft`,
    { method: "POST", body: JSON.stringify({}) }
  );

export const handToAgency = (id: string, note: string) =>
  request<{ id: string; handedToAgencyAt: string; recipients: string[] }>(
    `/desk/api/conversations/${id}/hand-to-agency`,
    { method: "POST", body: JSON.stringify({ note }) }
  );

export const fetchCannedReplies = (agencyInstallId?: string) =>
  request<CannedReply[]>(
    `/desk/api/canned-replies${agencyInstallId ? `?agencyInstallId=${agencyInstallId}` : ""}`
  );

/** Renders {{PLATFORM}} / {{FEATURE:x}} for THIS ticket's client. */
export const renderCannedReply = (conversationId: string, replyId: string) =>
  request<{ body: string }>(
    `/desk/api/conversations/${conversationId}/canned-replies/${replyId}/render`,
    { method: "POST", body: JSON.stringify({}) }
  );

export const createCannedReply = (input: { title: string; body: string; agencyInstallId?: string }) =>
  request<CannedReply>("/desk/api/canned-replies", { method: "POST", body: JSON.stringify(input) });

// --- Routing ---

export type Availability = "available" | "away";

export interface QueueRow {
  id: string;
  position: number;
  priority: TicketPriority;
  tier: number;
  subject: string | null;
  brandName: string | null;
  agencyName: string | null;
  locationName: string | null;
  waitingSeconds: number;
}

export interface QueueAgent {
  id: string;
  name: string;
  tier: number;
  held: number;
  maxConcurrent: number;
  available: boolean;
}

export interface QueueBoard {
  queue: QueueRow[];
  depth: number;
  capacity: { capacity: number; inProgress: number; free: number; onDuty: number };
  responseTime: { count: number; medianSeconds: number; p90Seconds: number; windowDays: number };
  agents: QueueAgent[];
  /** What a client joining the back of the queue would be told. null = we won't guess. */
  estimatedWaitSeconds: number | null;
}

export const fetchQueue = () => request<QueueBoard>("/desk/api/queue");

/**
 * Claim the next ticket. 409 is the normal, expected answer when the queue is empty,
 * you are at your limit, or somebody beat you to it — not an error to hide.
 */
export const takeNext = () =>
  request<{ conversationId: string }>("/desk/api/queue/next", { method: "POST" });

export const distributeQueue = (limit?: number) =>
  request<{ assigned: number; leftQueued: number }>("/desk/api/queue/distribute", {
    method: "POST",
    body: JSON.stringify({ limit }),
  });

export const setAvailability = (availability: Availability) =>
  request<{ availability: Availability }>("/desk/api/me/availability", {
    method: "POST",
    body: JSON.stringify({ availability }),
  });

export const setUserRouting = (id: string, patch: { tier?: number; maxConcurrent?: number }) =>
  request<{ id: string; name: string; tier: number; maxConcurrent: number }>(
    `/desk/api/users/${id}/routing`,
    { method: "PATCH", body: JSON.stringify(patch) }
  );

export const transferTicket = (id: string, deskUserId: string, note?: string) =>
  request<{ id: string; assignedTo: { id: string; name: string }; targetAway: boolean }>(
    `/desk/api/conversations/${id}/transfer`,
    { method: "POST", body: JSON.stringify({ deskUserId, note }) }
  );

export const escalateTier = (id: string, note?: string, tier?: number) =>
  request<{ id: string; tier: number; agentsAtTier: number }>(
    `/desk/api/conversations/${id}/escalate`,
    { method: "POST", body: JSON.stringify({ note, tier }) }
  );
