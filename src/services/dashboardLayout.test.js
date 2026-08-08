import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function readProjectFile(file) {
  return fs.readFile(path.join(projectRoot, file), "utf8");
}

test("dashboard stays focused on subscribed pages and one contextual action", async () => {
  const [portalScript, portalCss] = await Promise.all([
    readProjectFile("script.js"),
    readProjectFile("styles.css")
  ]);
  const start = portalScript.indexOf("function renderDashboard() {");
  const end = portalScript.indexOf("function renderLogin() {");
  const dashboardRenderer = portalScript.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(portalScript, /function dashboardPageAction\(page\)/);
  assert.match(portalScript, /function dashboardPageLogoMarkup\(page\)/);
  assert.match(portalScript, /packageId[\s\S]*packageThumbnailUrl\(pagePackage\)/);
  assert.match(portalScript, /renewal\.expired[\s\S]*status: "Expired"[\s\S]*label: "Renew"/);
  assert.match(portalScript, /risk\.status === "red"[\s\S]*status: "Attention"/);
  assert.match(portalScript, /status: "Active", label: "Manage"/);

  assert.match(dashboardRenderer, /dashboard-subscription-list/);
  assert.match(dashboardRenderer, /dashboard-subscription-row/);
  assert.match(dashboardRenderer, /dashboardPages = ownedPages\.filter/);
  assert.match(dashboardRenderer, /All pages are hidden/);
  assert.match(dashboardRenderer, /dashboardPageLogoMarkup\(page\)/);
  assert.match(dashboardRenderer, /Browse pages/);
  assert.doesNotMatch(dashboardRenderer, /dashboard-kpis|dashboard-risk-panel|dashboard-grid|recent activity|workspace status/i);

  assert.match(portalCss, /\.dashboard-minimal\s*\{/);
  assert.match(portalCss, /\.dashboard-subscription-row,[\s\S]*grid-template-columns:\s*48px minmax\(0, 1fr\) auto/);
  assert.match(portalCss, /\.dashboard-page-mark\.has-image img\s*\{[^}]*object-fit:\s*contain/s);
  assert.match(portalCss, /\.dashboard-page-status i\s*\{[^}]*var\(--success\)/s);
});
