import { Router } from "express";
import { savePageResult, saveTrafficEvent } from "../repositories/appRepository.js";

export const eventsRouter = Router();

function requestIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
}

eventsRouter.post("/page-traffic", (req, res) => {
  saveTrafficEvent(req.body, requestIp(req), req.headers["user-agent"])
    .then((event) => res.status(201).json({ event }))
    .catch((error) => res.status(400).json({ error: error.message }));
});

eventsRouter.post("/page-results", (req, res) => {
  savePageResult(req.body, requestIp(req), req.headers["user-agent"])
    .then((result) => res.status(201).json({ result }))
    .catch((error) => res.status(400).json({ error: error.message }));
});
