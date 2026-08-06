import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("secure result viewer is a session-aware command center", async () => {
  const [portalScript, portalStyles] = await Promise.all([
    fs.readFile(path.join(projectRoot, "script.js"), "utf8"),
    fs.readFile(path.join(projectRoot, "styles.css"), "utf8")
  ]);
  const viewerStart = portalScript.indexOf("function resultViewerContext(");
  const viewerEnd = portalScript.indexOf("function bulkResultsToolbarMarkup(", viewerStart);
  const viewerSource = portalScript.slice(viewerStart, viewerEnd);

  assert.match(viewerSource, /session command center/);
  assert.match(viewerSource, /data-toggle-result-controls/);
  assert.match(viewerSource, /data-result-viewer-redirect/);
  assert.match(viewerSource, /data-result-viewer-reload/);
  assert.match(viewerSource, /data-result-viewer-workflow/);
  assert.match(viewerSource, /data-result-viewer-ip-action/);
  assert.match(viewerSource, /data-result-viewer-export/);
  assert.match(viewerSource, /data-result-viewer-delete/);
  assert.match(viewerSource, /pageCapabilityAllowed\(page, "controlSessions"\)/);
  assert.match(viewerSource, /pageCapabilityAllowed\(page, "editSecurity"\)/);
  assert.doesNotMatch(viewerSource, /configured journey/i);
  assert.doesNotMatch(viewerSource, /Expected page flow/i);

  assert.match(portalStyles, /@media \(max-width: 600px\)[\s\S]*\.result-viewer-command-center\s*\{[\s\S]*position:\s*absolute/);
  assert.match(portalStyles, /\.result-viewer-layout\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(portalStyles, /\.result-viewer-steps\s*\{[\s\S]*overflow-x:\s*auto/);
  assert.match(portalStyles, /env\(safe-area-inset-bottom\)/);
});
