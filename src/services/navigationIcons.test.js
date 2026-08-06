import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function readProjectFile(file) {
  return fs.readFile(path.join(projectRoot, file), "utf8");
}

test("primary navigation uses a consistent SVG icon set", async () => {
  const [portalHtml, portalCss] = await Promise.all([
    readProjectFile("index.html"),
    readProjectFile("styles.css")
  ]);
  const navigation = portalHtml.match(/<nav class="side-nav"[\s\S]*?<\/nav>/)?.[0] || "";
  const icons = navigation.match(/<svg class="nav-icon-svg"[\s\S]*?<\/svg>/g) || [];

  assert.equal(icons.length, 5);
  assert.doesNotMatch(navigation, /&#\d+;/);
  for (const icon of icons) {
    assert.match(icon, /viewBox="0 0 24 24"/);
    assert.match(icon, /fill="none"/);
    assert.match(icon, /stroke="currentColor"/);
    assert.match(icon, /stroke-width="1\.8"/);
    assert.match(icon, /focusable="false"/);
  }
  assert.match(portalCss, /\.nav-icon-svg\s*\{[^}]*width:\s*52%;[^}]*height:\s*52%/s);
});
