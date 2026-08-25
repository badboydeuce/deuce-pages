import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function readProjectFile(file) {
  return fs.readFile(path.join(projectRoot, file), "utf8");
}

test("initial boot uses only the centered workspace loader", async () => {
  const [portalHtml, portalScript, portalCss] = await Promise.all([
    readProjectFile("index.html"),
    readProjectFile("script.js"),
    readProjectFile("styles.css")
  ]);

  assert.match(portalHtml, /app-loading-view[\s\S]*loader-orbit[\s\S]*loading-rail/);
  assert.doesNotMatch(portalHtml, /Opening workspace|Loading your session, pages, wallet, and live controls\./);
  assert.match(portalScript, /let initialBootActive = true/);
  assert.match(portalScript, /const showCompactIndicator = busy && !initialBootActive/);
  assert.match(portalScript, /classList\.toggle\("is-loading", showCompactIndicator\)/);
  assert.match(portalScript, /finally\s*\{\s*initialBootActive = false;\s*setAppBusy\(false\)/);
  assert.match(portalCss, /\.app-shell\.is-loading::after/);
});
