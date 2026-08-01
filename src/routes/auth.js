import { Router } from "express";
import {
  authenticateUser,
  createSession,
  getUserBySessionToken,
  inspectRegistrationInvitation,
  registerInvitedUser,
  revokeSessionToken
} from "../repositories/appRepository.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "../services/sessionCookie.js";

export const authRouter = Router();

const loginLimit = rateLimit({ key: "auth-login", max: 10 });
const registrationLimit = rateLimit({ key: "auth-register", max: 10 });
const invitationLimit = rateLimit({ key: "auth-invitation", max: 30 });

authRouter.post("/invitations/validate", invitationLimit, async (req, res) => {
  try {
    const invitation = await inspectRegistrationInvitation(req.body.inviteToken);
    res.json({ invitation });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

authRouter.post("/register", registrationLimit, async (req, res) => {
  try {
    const user = await registerInvitedUser(req.body);
    const session = await createSession(user.id);
    setSessionCookie(res, session);
    res.status(201).json({ user, expiresAt: session.expiresAt });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

authRouter.post("/login", loginLimit, (req, res) => {
  authenticateUser(req.body.email, req.body.password)
    .then(async (user) => {
      const session = await createSession(user.id);
      setSessionCookie(res, session);
      res.json({ user, expiresAt: session.expiresAt });
    })
    .catch((error) => res.status(401).json({ error: error.message }));
});

authRouter.post("/logout", async (req, res) => {
  try {
    await revokeSessionToken(readSessionToken(req));
  } catch {
    // Clearing the browser cookie must still complete if the session store is unavailable.
  } finally {
    clearSessionCookie(res);
  }
  res.json({ ok: true });
});

authRouter.get("/me", (req, res) => {
  getUserBySessionToken(readSessionToken(req))
    .then((user) => {
      if (!user) return res.status(401).json({ error: "Authentication required" });
      res.json({ user });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});
