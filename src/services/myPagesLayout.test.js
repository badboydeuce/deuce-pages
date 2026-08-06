import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function readProjectFile(file) {
  return fs.readFile(path.join(projectRoot, file), "utf8");
}

test("My Pages prioritizes health, live URL, and one primary action", async () => {
  const portalScript = await readProjectFile("script.js");
  const cardStart = portalScript.indexOf("function ownedPageCard(page) {");
  const viewStart = portalScript.indexOf("function renderMyPages() {");
  const viewEnd = portalScript.indexOf("function renderGoLiveCenter(");
  const card = portalScript.slice(cardStart, viewStart);
  const view = portalScript.slice(viewStart, viewEnd);

  assert.ok(cardStart >= 0 && viewStart > cardStart && viewEnd > viewStart);
  assert.match(card, /my-page-overview/);
  assert.match(card, /Page health/);
  assert.match(card, /Live URL/);
  assert.match(card, /my-page-primary-action/);
  assert.ok(card.indexOf("Page health") < card.indexOf("data-page-section=\"hosting\""));

  for (const section of ["hosting", "advanced-security", "results"]) {
    assert.match(card, new RegExp(`data-page-section="${section}"`));
  }
  assert.doesNotMatch(card, /<details[^>]+\sopen(?:\s|>)/);
  assert.match(card, /data-go-live/);
  assert.match(card, /data-security-tab="security"/);
  assert.match(card, /data-results/);

  assert.match(view, /my-pages-view/);
  assert.doesNotMatch(view, /my-pages-kpis|my-pages-brief|summary-grid/);
});
