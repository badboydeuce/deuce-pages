import assert from "node:assert/strict";
import test from "node:test";

import { summarizeTrafficEvents } from "./trafficAnalytics.js";

test("traffic summaries count each session once and keep event counts separate", () => {
  const now = Date.parse("2026-08-12T12:00:00.000Z");
  const summary = summarizeTrafficEvents([
    {
      id: "event_1",
      sessionId: "session_a",
      event: "page_load",
      result: "allowed",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile",
      createdAt: "2026-08-12T10:05:00.000Z"
    },
    {
      id: "event_2",
      sessionId: "session_a",
      event: "screen_view",
      result: "allowed",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile",
      createdAt: "2026-08-12T10:07:00.000Z"
    },
    {
      id: "event_3",
      sessionId: "session_b",
      event: "security_denied",
      result: "blocked",
      metadata: { deviceType: "desktop" },
      createdAt: "2026-08-12T11:10:00.000Z"
    },
    {
      id: "event_4",
      sessionId: "session_b",
      event: "turnstile_verify_failed",
      result: "blocked",
      metadata: { deviceType: "desktop" },
      createdAt: "2026-08-12T11:12:00.000Z"
    }
  ], { now });

  assert.equal(summary.uniqueVisits, 2);
  assert.equal(summary.cleanVisits, 1);
  assert.equal(summary.blockedVisits, 1);
  assert.equal(summary.blockEvents, 2);
  assert.equal(summary.totalEvents, 4);
  assert.deepEqual(summary.devices, { mobile: 1, desktop: 1, tablet: 0, bot: 0, other: 0 });
  assert.deepEqual(summary.timeline, [
    { at: "2026-08-12T10:00:00.000Z", visits: 1, blockedVisits: 0 },
    { at: "2026-08-12T11:00:00.000Z", visits: 1, blockedVisits: 1 }
  ]);
});

test("traffic summaries treat events without session ids as separate visits", () => {
  const summary = summarizeTrafficEvents([
    { id: "legacy_a", event: "page_load", result: "allowed", createdAt: "2026-08-12T10:00:00.000Z" },
    { id: "legacy_b", event: "security_denied", result: "blocked", createdAt: "2026-08-12T10:01:00.000Z" }
  ], { now: Date.parse("2026-08-12T12:00:00.000Z") });

  assert.equal(summary.uniqueVisits, 2);
  assert.equal(summary.blockedVisits, 1);
  assert.equal(summary.blockEvents, 1);
});
