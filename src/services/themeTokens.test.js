import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function readProjectFile(file) {
  return fs.readFile(path.join(projectRoot, file), "utf8");
}

test("shared theme tokens drive brand accents and semantic states", async () => {
  const [tokens, portalCss, accessCss, blogCss, portalScript] = await Promise.all([
    readProjectFile("theme-tokens.css"),
    readProjectFile("styles.css"),
    readProjectFile("access.css"),
    readProjectFile("blog/blog.css"),
    readProjectFile("script.js")
  ]);

  assert.match(tokens, /--accent-rgb:\s*124 255 178/);
  assert.match(tokens, /--success-rgb:/);
  assert.match(tokens, /--warning-rgb:/);
  assert.match(tokens, /--danger-rgb:/);
  assert.match(tokens, /--info-rgb:/);
  assert.match(tokens, /color-mix\(in srgb, var\(--accent\)/);
  assert.match(tokens, /data-theme="light"\]\[data-accent="ice"\]/);

  for (const css of [portalCss, accessCss, blogCss]) {
    assert.doesNotMatch(css, /rgba\(124,\s*255,\s*178/i);
    assert.doesNotMatch(css, /^\s*--accent:\s*#/mi);
  }

  assert.match(portalCss, /\.dashboard-kpis article\.is-green\s*\{[^}]*var\(--success-rgb\)/s);
  assert.match(portalCss, /\.invite-status-pending\s*\{[^}]*var\(--warning\)/s);
  assert.match(portalCss, /\.logout-toggle\s*\{[^}]*var\(--danger-rgb\)/s);
  assert.match(portalScript, /document\.documentElement\.dataset\.accent = selection\.key/);
  assert.doesNotMatch(portalScript, /style\.setProperty\("--accent"/);
});
