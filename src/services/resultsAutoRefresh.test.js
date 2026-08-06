import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("result polling pauses for interactions and serializes mutations", async () => {
  const portalScript = await fs.readFile(path.join(projectRoot, "script.js"), "utf8");

  assert.match(portalScript, /function resultsAutoRefreshBlockReason\(\)/);
  assert.match(portalScript, /async function runResultsMutation\(work\)/);
  assert.match(portalScript, /const pendingRefresh = resultsAutoRefreshPromise/);
  assert.match(portalScript, /if \(options\.autoRefresh\)[\s\S]*resultsAutoRefreshBlockReason\(\)/);
  assert.match(portalScript, /data-toggle-results-auto-refresh/);
  assert.match(portalScript, /Deleting", \(\) => runResultsMutation/);
  assert.match(portalScript, /Applying", \(\) => runResultsMutation/);
  assert.doesNotMatch(portalScript, /Auto-refresh 5s \/ \$\{pageTargets\.length\}/);
});
