import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("result sessions use one concise three-view filter", async () => {
  const portalScript = await fs.readFile(path.join(projectRoot, "script.js"), "utf8");
  const resultsStart = portalScript.indexOf("async function renderResultsCenter(");
  const resultsEnd = portalScript.indexOf("function renderWallet(", resultsStart);
  const resultsCenter = portalScript.slice(resultsStart, resultsEnd);

  assert.match(resultsCenter, /data-session-filter-select/);
  assert.match(resultsCenter, /\["all", "All sessions"\]/);
  assert.match(resultsCenter, /\["live", "Active now"\]/);
  assert.match(resultsCenter, /\["has-results", "With results"\]/);
  assert.doesNotMatch(resultsCenter, /data-session-filter-button/);
  assert.doesNotMatch(resultsCenter, /\["(?:queued|delivered|blocked|offline|idle)",/);
});
