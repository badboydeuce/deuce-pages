import { Router } from "express";
import { processGitHubPush, verifyGitHubWebhookSignature } from "../services/githubWebhook.js";

export const githubWebhooksRouter = Router();

githubWebhooksRouter.post("/github", async (req, res) => {
  try {
    verifyGitHubWebhookSignature(req.rawBody, req.get("x-hub-signature-256"));
    const event = String(req.get("x-github-event") || "").toLowerCase();
    if (event === "ping") {
      res.status(200).json({ ok: true, event: "ping" });
      return;
    }
    if (event !== "push") {
      res.status(202).json({ accepted: true, ignored: true, event: event || "unknown" });
      return;
    }
    const result = await processGitHubPush(req.body, req.get("x-github-delivery"));
    res.status(202).json({ accepted: true, ...result });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "GitHub webhook failed" });
  }
});
