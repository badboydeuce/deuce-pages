import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEmailHandoff } from "./emailHandoff.js";

const screens = [{
  id: "scr_login",
  fieldManifest: {
    fields: [
      { id: "fld_source_email", type: "email" },
      { id: "fld_destination_email", type: "text" },
      { id: "fld_password", type: "password" }
    ]
  }
}];

test("email handoff is disabled by default", () => {
  assert.deepEqual(normalizeEmailHandoff({}, screens), {
    enabled: false,
    sourceFieldId: "",
    destinationFieldId: "",
    clearOnFinalScreen: true
  });
});

test("email handoff accepts explicit compatible package fields", () => {
  const issues = [];
  const config = normalizeEmailHandoff({
    enabled: true,
    sourceFieldId: "fld_source_email",
    destinationFieldId: "fld_destination_email",
    clearOnFinalScreen: false
  }, screens, issues);
  assert.equal(issues.length, 0);
  assert.equal(config.enabled, true);
  assert.equal(config.clearOnFinalScreen, false);
});

test("email handoff rejects missing or secret destination fields", () => {
  const issues = [];
  normalizeEmailHandoff({
    enabled: true,
    sourceFieldId: "fld_source_email",
    destinationFieldId: "fld_password"
  }, screens, issues);
  assert.ok(issues.some((issue) => issue.includes("destination")));
});
