import { Router, Request, Response } from "express";
import { prisma } from "../services/prisma";
import {
  createSession,
  clearSessionCookie,
  hashPassword,
  requireDeskAdmin,
  requireDeskAuth,
  revokeAllSessionsForUser,
  revokeSession,
  setSessionCookie,
  verifyPassword,
} from "../services/deskAuth";
import { releaseTicketsFrom } from "../services/deskQueue";
import { describeError } from "../services/security";

/**
 * The Mosaic support desk API, served to apps/support-desk at its own origin.
 *
 * Single-tenant by design: every route here is for MOSAIC's own staff, who answer
 * support requests on behalf of every agency. There is no agency-scoped access and
 * no self-serve signup - accounts come from scripts/createDeskUser.ts.
 */
export const deskRouter = Router();

/** Uniform delay floor so a wrong email and a wrong password take the same time. */
const MIN_LOGIN_MS = 250;

deskRouter.post("/desk/api/login", async (req: Request, res: Response) => {
  const started = Date.now();
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");

  const finish = async (status: number, body: unknown) => {
    const elapsed = Date.now() - started;
    if (elapsed < MIN_LOGIN_MS) await new Promise((r) => setTimeout(r, MIN_LOGIN_MS - elapsed));
    res.status(status).json(body);
  };

  if (!email || !password) {
    return finish(400, { error: "Email and password are required" });
  }

  const user = await prisma.deskUser.findUnique({ where: { email } });
  // Never distinguish "no such user" from "wrong password" from "disabled account" in
  // the response - that's an account-enumeration oracle. The uniform delay above
  // closes the timing side of the same leak.
  if (!user || user.status !== "active" || !verifyPassword(password, user.passwordHash)) {
    console.warn(`[desk] failed login for ${email} from ${req.ip ?? "unknown"}`);
    return finish(401, { error: "Invalid email or password" });
  }

  const token = await createSession(user, {
    userAgent: req.headers["user-agent"],
    ip: req.ip,
  });
  await prisma.deskUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  setSessionCookie(res, token);

  return finish(200, {
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});

deskRouter.post("/desk/api/logout", requireDeskAuth, async (req: Request, res: Response) => {
  if (req.deskSessionId) await revokeSession(req.deskSessionId);
  clearSessionCookie(res);
  res.json({ ok: true });
});

/** Who am I? The desk calls this on load to decide between the app and the login screen. */
deskRouter.get("/desk/api/me", requireDeskAuth, async (req: Request, res: Response) => {
  // Routing state is read fresh rather than carried on the session: a manager changing
  // someone's tier or limit must not have to wait for them to sign in again, and the
  // agent's own away toggle has to survive a reload.
  const routing = await prisma.deskUser.findUnique({
    where: { id: req.deskUser!.id },
    select: { availability: true, tier: true, maxConcurrent: true },
  });
  res.json({ user: { ...req.deskUser, ...routing } });
});

// --- Staff administration (mosaic_admin only) ---

deskRouter.get(
  "/desk/api/users",
  requireDeskAuth,
  requireDeskAdmin,
  async (_req: Request, res: Response) => {
    const users = await prisma.deskUser.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        // Routing, so the staff screen can show and change it in one place rather
        // than making a manager guess why a ticket never reached someone.
        availability: true,
        tier: true,
        maxConcurrent: true,
      },
    });
    res.json(users);
  }
);

deskRouter.post(
  "/desk/api/users",
  requireDeskAuth,
  requireDeskAdmin,
  async (req: Request, res: Response) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const name = String(req.body?.name ?? "").trim();
    const password = String(req.body?.password ?? "");
    const role = req.body?.role === "mosaic_admin" ? "mosaic_admin" : "mosaic_agent";

    if (!email || !name || !password) {
      return res.status(400).json({ error: "email, name and password are required" });
    }
    if (password.length < 12) {
      // Every account here can read every agency's support conversations, so this is
      // not a formality - it's the whole blast radius.
      return res.status(400).json({ error: "Password must be at least 12 characters" });
    }
    if (await prisma.deskUser.findUnique({ where: { email } })) {
      return res.status(409).json({ error: "That email already has an account" });
    }

    const user = await prisma.deskUser.create({
      data: { email, name, passwordHash: hashPassword(password), role },
      select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
    });
    console.log(`[desk] ${req.deskUser?.email} created account ${email} (${role})`);
    res.status(201).json(user);
  }
);

/**
 * Disable an account, kill its live sessions, and return its tickets to the queue — all
 * in the same call.
 *
 * Disabling without revoking would leave the person signed in for up to the session TTL,
 * which defeats the point of having revocable sessions at all. Disabling without
 * releasing is the quieter half of the same mistake: their clients are left waiting on
 * somebody who can no longer sign in, on tickets no screen reports as waiting. See
 * `releaseTicketsFrom`.
 *
 * Order matters. Access is revoked FIRST and the release runs after, so a failure part
 * way through still leaves the person locked out — the urgent half — and readiness
 * reports any ticket that stayed parked.
 */
deskRouter.post(
  "/desk/api/users/:id/disable",
  requireDeskAuth,
  requireDeskAdmin,
  async (req: Request, res: Response) => {
    if (req.params.id === req.deskUser?.id) {
      // Otherwise the last admin can lock the whole team out of the desk.
      return res.status(400).json({ error: "You cannot disable your own account" });
    }
    const user = await prisma.deskUser.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: "No such user" });

    await prisma.deskUser.update({ where: { id: user.id }, data: { status: "disabled" } });
    const revoked = await revokeAllSessionsForUser(user.id);

    // Counted from what actually succeeded, so a partial failure under-reports rather
    // than claiming a client is back in the queue when they are not.
    let released = 0;
    try {
      released = await releaseTicketsFrom(user.id, user.name);
    } catch (e) {
      console.error(
        `[desk] released only ${released} of ${user.email}'s tickets: ${describeError(e)} — the rest are stranded and readiness will name them`
      );
    }

    console.log(
      `[desk] ${req.deskUser?.email} disabled ${user.email}; revoked ${revoked} session(s), returned ${released} ticket(s) to the queue`
    );
    res.json({ ok: true, revokedSessions: revoked, releasedTickets: released });
  }
);

deskRouter.post(
  "/desk/api/users/:id/enable",
  requireDeskAuth,
  requireDeskAdmin,
  async (req: Request, res: Response) => {
    const user = await prisma.deskUser.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: "No such user" });
    await prisma.deskUser.update({ where: { id: user.id }, data: { status: "active" } });
    console.log(`[desk] ${req.deskUser?.email} re-enabled ${user.email}`);
    res.json({ ok: true });
  }
);

/** Change your own password. Rotating credentials also drops every other session. */
deskRouter.post("/desk/api/password", requireDeskAuth, async (req: Request, res: Response) => {
  const current = String(req.body?.currentPassword ?? "");
  const next = String(req.body?.newPassword ?? "");
  if (next.length < 12) {
    return res.status(400).json({ error: "New password must be at least 12 characters" });
  }
  const user = await prisma.deskUser.findUnique({ where: { id: req.deskUser!.id } });
  if (!user || !verifyPassword(current, user.passwordHash)) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }

  await prisma.deskUser.update({ where: { id: user.id }, data: { passwordHash: hashPassword(next) } });
  await revokeAllSessionsForUser(user.id);
  // Revoking everything logged this browser out too, so hand back a fresh session
  // rather than bouncing someone to the login screen for doing the right thing.
  const token = await createSession(user, { userAgent: req.headers["user-agent"], ip: req.ip });
  setSessionCookie(res, token);
  res.json({ ok: true });
});
