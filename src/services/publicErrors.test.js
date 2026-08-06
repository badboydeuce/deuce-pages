import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createApp } from "../app.js";
import { publicErrorMessage, sanitizeErrorResponse } from "./publicErrors.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const exposedUrl = "https://deuce-pages.onrender.com/api/user-pages/user_page_36f5e2d4b89348b8bc/results/result_9ed0163d1f684f9885";

test("public error messages reject URLs, routes, identifiers, and internal diagnostics", () => {
  const message = publicErrorMessage(new Error(`API connection failed at ${exposedUrl}`), { status: 0 });
  assert.equal(message, "Connection failed. Please try again.");
  assert.doesNotMatch(message, /https?:|\/api\/|user_page_|result_/i);

  assert.equal(
    publicErrorMessage("Display domain must be a hostname only", { status: 400 }),
    "Display domain must be a hostname only"
  );
  assert.equal(
    publicErrorMessage("SELECT * FROM users failed at C:\\app\\db.js:12", { status: 500 }),
    "The service is temporarily unavailable. Please try again."
  );
  for (const raw of [
    "Preview failed at /preview/private/session_abcdef123456",
    "Provider deuce-pages.onrender.com returned an error",
    "Request rejected for 203.0.113.42",
    "Account badboy@example.com was not found",
    "Invalid request ?token=private-value",
    "Resource 123e4567-e89b-12d3-a456-426614174000 was not found"
  ]) {
    assert.equal(publicErrorMessage(raw, { status: 400 }), "Please check the submitted information and try again.");
  }
});

test("error response sanitization removes raw diagnostic fields recursively", () => {
  const response = sanitizeErrorResponse({
    error: `Request failed at ${exposedUrl}`,
    path: "/api/private/path",
    stack: "Error: private\n at C:\\app\\server.js:12",
    validation: {
      issues: [`Invalid resource result_9ed0163d1f684f9885`, "Display domain must be a hostname only"]
    }
  }, 400);
  const serialized = JSON.stringify(response);

  assert.equal(response.error, "Please check the submitted information and try again.");
  assert.equal(response.path, undefined);
  assert.equal(response.stack, undefined);
  assert.equal(response.validation.issues[1], "Display domain must be a hostname only");
  assert.doesNotMatch(serialized, /https?:|\/api\/|user_page_|result_|server\.js/i);
});

test("API and browser boundaries do not expose raw paths", async () => {
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/api/missing/user_page_36f5e2d4b89348b8bc`);
    const body = await response.json();
    const serialized = JSON.stringify(body);
    assert.equal(response.status, 404);
    assert.equal(body.path, undefined);
    assert.doesNotMatch(serialized, /\/api\/|user_page_/i);

    const publicScriptResponse = await fetch(`${baseUrl}/public-errors.js`);
    assert.equal(publicScriptResponse.status, 200);
    assert.match(publicScriptResponse.headers.get("cache-control") || "", /no-store/);

    const [portalScript, loginScript, inviteScript, accessScript] = await Promise.all([
      fs.readFile(path.join(projectRoot, "script.js"), "utf8"),
      fs.readFile(path.join(projectRoot, "login.js"), "utf8"),
      fs.readFile(path.join(projectRoot, "invite.js"), "utf8"),
      fs.readFile(path.join(projectRoot, "access.js"), "utf8")
    ]);
    const browserSources = [portalScript, loginScript, inviteScript, accessScript].join("\n");
    assert.doesNotMatch(browserSources, /API connection failed at/);
    assert.doesNotMatch(browserSources, /error\.message/);
    assert.match(browserSources, /safeErrorMessage/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
