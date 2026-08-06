import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = fs.readFileSync(path.join(root, "script.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");

test("package editor exposes the complete Screen Manifest v2 mapping controls", () => {
  for (const marker of [
    "data-package-screen-label",
    "data-package-screen-stage",
    "data-package-screen-state",
    "data-package-screen-entry",
    "data-package-screen-final",
    "data-package-screen-enabled",
    "data-package-screen-redirect"
  ]) {
    assert.match(script, new RegExp(marker));
  }
  assert.match(script, /targetScreenId, targetFile, forceReload/);
  assert.match(styles, /\.screen-mapping-panel\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(styles, /\.file-map-list\s*>\s*\.screen-map-row/);
});

test("import workflow requires screen mapping before UI publishing", () => {
  assert.doesNotMatch(script, /data-github-publish>Import & Publish/);
  assert.doesNotMatch(script, /data-local-import="publish">Upload & publish/);
  assert.match(script, /Map screens & publish/);
});
