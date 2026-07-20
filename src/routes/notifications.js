import { Router } from "express";
import { listNotifications, markAllNotificationsRead, markNotificationRead } from "../repositories/appRepository.js";
import { requireAuth } from "../middleware/auth.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get("/", async (req, res) => {
  try {
    const result = await listNotifications(req.user.id, req.query.limit);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

notificationsRouter.patch("/read-all", async (req, res) => {
  try {
    const updated = await markAllNotificationsRead(req.user.id);
    res.json({ updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

notificationsRouter.patch("/:id/read", async (req, res) => {
  try {
    const notification = await markNotificationRead(req.user.id, req.params.id);
    if (!notification) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json({ notification });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
