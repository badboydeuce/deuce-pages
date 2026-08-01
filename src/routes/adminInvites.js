import { Router } from "express";
import {
  createRegistrationInvitation,
  listRegistrationInvitations,
  revokeRegistrationInvitation
} from "../repositories/appRepository.js";
import { requireAdmin } from "../middleware/auth.js";

export const adminInvitesRouter = Router();

adminInvitesRouter.use(requireAdmin);

adminInvitesRouter.get("/", async (req, res) => {
  try {
    const invitations = await listRegistrationInvitations();
    res.json({ invitations });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

adminInvitesRouter.post("/", async (req, res) => {
  try {
    const result = await createRegistrationInvitation({
      email: req.body.email,
      expiresInHours: req.body.expiresInHours,
      createdBy: req.user.id
    });
    res.status(201).json(result);
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

adminInvitesRouter.delete("/:id", async (req, res) => {
  try {
    const invitation = await revokeRegistrationInvitation(req.params.id);
    if (!invitation) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }
    res.json({ invitation });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});
