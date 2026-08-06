import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createPersistentFieldManifest,
  instrumentResultFields,
  reconcilePersistentFieldManifest,
  redactLegacyResultPayload,
  redactStructuredResultCapture,
  serverNormalizedFieldManifest,
  signResultFieldManifest,
  verifyResultFieldManifest
} from "./resultCapture.js";

test("builds stable persistent field manifests across file renames", () => {
  const html = `
    <form id="profile">
      <label for="country">Country</label>
      <select id="country" name="country"><option value="ng">Nigeria</option></select>
      <label for="answer">Answer</label>
      <input id="answer" name="security_answer">
    </form>
  `;
  const first = createPersistentFieldManifest(html, { screenFile: "personal.html", screenId: "scr_personal" });
  const renamed = createPersistentFieldManifest(html, { screenFile: "profile.html", screenId: "scr_personal" });
  assert.deepEqual(first.fields.map((field) => field.id), renamed.fields.map((field) => field.id));
  assert.equal(first.fields[0].type, "select");
  assert.equal(first.fields[1].sensitivity, "authentication-secret");
  assert.ok(first.fields.every((field) => field.policy === "redact"));
});

test("reconciles detected field changes while preserving reviewed metadata", () => {
  const first = createPersistentFieldManifest(`
    <form><input name="full_name" aria-label="Full name"><input name="phone" aria-label="Phone"></form>
  `, { screenFile: "personal.html", screenId: "scr_personal" });
  first.fields[0].label = "Customer name";
  first.fields[0].sensitivity = "personal";
  const next = createPersistentFieldManifest(`
    <form><input name="full_name" aria-label="Full name"><select name="country" aria-label="Country"></select></form>
  `, { screenFile: "personal.html", screenId: "scr_personal" });
  const reconciled = reconcilePersistentFieldManifest(first, next, { screenId: "scr_personal" });
  assert.equal(reconciled.diff.added.length, 1);
  assert.equal(reconciled.diff.removed.length, 1);
  assert.equal(reconciled.diff.hasChanges, true);
  assert.equal(reconciled.manifest.fields[0].label, "Customer name");
  assert.equal(reconciled.manifest.needsReview, true);
});

test("flags duplicate labels and unsupported custom controls for review", () => {
  const manifest = createPersistentFieldManifest(`
    <form><input name="first" aria-label="Answer"><input name="second" aria-label="Answer"><div role="combobox"></div></form>
  `, { screenFile: "questions.html", screenId: "scr_questions" });
  assert.equal(manifest.needsReview, true);
  assert.ok(manifest.warnings.some((warning) => /duplicate field label/i.test(warning)));
  assert.ok(manifest.warnings.some((warning) => /custom control/i.test(warning)));
});

test("instruments normal controls with stable ids and a signed server manifest", () => {
  process.env.RESULT_CAPTURE_SECRET = "result-capture-unit-test-secret";
  const source = `<!doctype html>
    <form id="security-form">
      <label for="question">Security question</label>
      <select id="question" name="security_question" required>
        <option value="first-school">What was your first school?</option>
      </select>
      <label for="answer">Answer</label>
      <input id="answer" name="security_answer" type="text" required>
      <input name="csrf_token" type="hidden" value="not-a-result-field">
    </form>`;

  const first = instrumentResultFields(source, { screenFile: "security.html" });
  const second = instrumentResultFields(source, { screenFile: "security.html" });

  assert.equal(first.manifest.fields.length, 2);
  assert.deepEqual(first.manifest, second.manifest);
  assert.match(first.html, /data-deuce-form-id="frm_/);
  assert.equal((first.html.match(/data-deuce-field-id=/g) || []).length, 2);
  assert.equal(first.manifest.fields[0].label, "Security question");
  assert.equal(first.manifest.fields[0].type, "select");
  assert.equal(first.manifest.fields[1].label, "Answer");

  const token = signResultFieldManifest(first.manifest, { userPageId: "page_security" });
  const verified = verifyResultFieldManifest(token, {
    userPageId: "page_security",
    screenFile: "security.html"
  });
  assert.deepEqual(verified, first.manifest);
  assert.throws(() => verifyResultFieldManifest(`${token}x`, { userPageId: "page_security" }), /invalid/i);
  assert.throws(() => verifyResultFieldManifest(token, { userPageId: "another_page" }), /does not match/i);
});

test("uses trusted manifest labels and derives only redacted, blank, or missing states", () => {
  const { manifest } = instrumentResultFields(`
    <form id="personal">
      <input name="full_name" aria-label="Full name" required>
      <input name="phone" aria-label="Phone" required>
      <select name="country" aria-label="Country" required><option value="ng">Nigeria</option></select>
    </form>
  `, { screenFile: "personal.html" });
  const scopeId = manifest.fields[0].scopeId;
  const payload = redactStructuredResultCapture({
    scopeId,
    fields: [
      { id: manifest.fields[0].id, label: "Untrusted replacement", type: "text", value: "Ada Secret" },
      { id: manifest.fields[1].id, type: "text", value: "" }
    ]
  }, manifest);

  assert.deepEqual(payload, {
    "Full name": "[redacted]",
    Phone: "[blank]",
    Country: "[missing]"
  });
  assert.doesNotMatch(JSON.stringify(payload), /Ada Secret/);
  assert.equal(Object.hasOwn(payload, "Untrusted replacement"), false);
});

test("server-normalizes unsigned legacy manifests without accepting redaction decisions", () => {
  const capture = {
    scopeId: "generated-flow",
    fields: [
      { id: "generated_personal_name_1", label: "Full name", type: "text", value: "Private Name", state: "visible" },
      { id: "generated_personal_country_2", label: "Country", type: "select", value: "" }
    ]
  };
  const manifest = serverNormalizedFieldManifest(capture, { screenFile: "generated-flow" });
  const payload = redactStructuredResultCapture(capture, manifest);
  assert.deepEqual(payload, { "Full name": "[redacted]", Country: "[blank]" });
  assert.doesNotMatch(JSON.stringify(payload), /Private Name|visible/);
});

test("legacy object payloads are redacted recursively on the backend", () => {
  const payload = redactLegacyResultPayload({
    "Personal Info": {
      Name: "Private Name",
      Address: "",
      ClaimedState: "[missing]",
      _fieldCount: 2
    },
    Token: ["one", "two"]
  });
  assert.deepEqual(payload, {
    "Personal Info": { Name: "[redacted]", Address: "[blank]", ClaimedState: "[redacted]" },
    Token: "[redacted]"
  });
  assert.doesNotMatch(JSON.stringify(payload), /Private Name|one|two/);
});

test("savePageResult writes raw submitted values to JSON storage", async () => {
  const previous = {
    LOCAL_JSON_DB: process.env.LOCAL_JSON_DB,
    JSON_DB_PATH: process.env.JSON_DB_PATH
  };
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deuce-result-capture-"));
  const dbPath = path.join(tempRoot, "db.json");
  const now = new Date().toISOString();
  process.env.LOCAL_JSON_DB = "true";
  process.env.JSON_DB_PATH = dbPath;
  await fs.writeFile(dbPath, JSON.stringify({
    userPages: [{
      id: "page_capture_test",
      userId: "user_capture_test",
      packageId: "package_capture_test",
      packageVersion: "v1",
      slug: "capture-test",
      name: "Capture Test",
      resultSettings: { retentionDays: 30, notifyOnResult: true },
      createdAt: now,
      updatedAt: now
    }],
    pageResults: [],
    notificationOutbox: []
  }));

  try {
    const repository = await import(`../repositories/appRepository.js?result-capture-test=${Date.now()}`);
    const { manifest } = instrumentResultFields(`
      <form id="test"><input name="answer" aria-label="Answer"><input name="optional" aria-label="Optional"></form>
    `, { screenFile: "test.html" });
    const capture = {
      scopeId: manifest.fields[0].scopeId,
      fields: [
        { id: manifest.fields[0].id, type: "text", value: "raw-answer-must-never-persist" },
        { id: manifest.fields[1].id, type: "text", value: "" }
      ]
    };
    const result = await repository.savePageResult({
      userPageId: "page_capture_test",
      pageId: "capture-test",
      pageName: "Capture Test",
      sessionId: "session_capture_test",
      screen: "Test",
      capture
    }, "127.0.0.1", "test-agent", { fieldManifest: manifest });

    assert.deepEqual(result.payload, { Answer: "raw-answer-must-never-persist", Optional: "" });
    assert.match(JSON.stringify(result), /raw-answer-must-never-persist/);
    const rawDatabase = await fs.readFile(dbPath, "utf8");
    assert.match(rawDatabase, /raw-answer-must-never-persist/);
    assert.doesNotMatch(rawDatabase, /\[redacted\]/);
  } finally {
    process.env.LOCAL_JSON_DB = previous.LOCAL_JSON_DB;
    process.env.JSON_DB_PATH = previous.JSON_DB_PATH;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
