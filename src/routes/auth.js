import { Router } from "express";
import { authenticateUser, createSession, createUser, getUserBySessionToken } from "../repositories/appRepository.js";

export const authRouter = Router();

function readBearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

authRouter.post("/register", (req, res) => {
  createUser(req.body)
    .then(async (user) => {
      const session = await createSession(user.id);
      res.status(201).json({ user, token: session.token, expiresAt: session.expiresAt });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});

authRouter.post("/login", (req, res) => {
  authenticateUser(req.body.email, req.body.password)
    .then(async (user) => {
      const session = await createSession(user.id);
      res.json({ user, token: session.token, expiresAt: session.expiresAt });
    })
    .catch((error) => res.status(401).json({ error: error.message }));
});

authRouter.post("/logout", (req, res) => {
  res.json({ ok: true });
});

authRouter.get("/me", (req, res) => {
  getUserBySessionToken(readBearerToken(req))
    .then((user) => {
      if (!user) return res.status(401).json({ error: "Authentication required" });
      res.json({ user });
    })
    .catch((error) => res.status(400).json({ error: error.message }));
});
