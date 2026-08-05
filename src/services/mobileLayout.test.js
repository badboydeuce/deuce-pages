import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function readProjectFile(file) {
  return fs.readFile(path.join(projectRoot, file), "utf8");
}

test("mobile layouts provide safe areas, touch navigation, and zoom-safe forms", async () => {
  const [portalCss, accessCss, blogCss, portalScript, ...pages] = await Promise.all([
    readProjectFile("styles.css"),
    readProjectFile("access.css"),
    readProjectFile("blog/blog.css"),
    readProjectFile("script.js"),
    readProjectFile("index.html"),
    readProjectFile("login.html"),
    readProjectFile("invite.html"),
    readProjectFile("access.html"),
    readProjectFile("blog/index.html")
  ]);

  for (const page of pages) {
    assert.match(page, /width=device-width, initial-scale=1, viewport-fit=cover/);
  }

  assert.match(portalCss, /\.app-shell:not\(\.auth-mode\) \.sidebar\s*\{[^}]*position:\s*fixed/s);
  assert.match(portalCss, /env\(safe-area-inset-bottom, 0px\)/);
  assert.match(portalCss, /\.preview input,[\s\S]*font-size:\s*16px/);
  assert.match(portalCss, /\.dropdown-panel,[\s\S]*\.notification-panel\s*\{[^}]*position:\s*fixed/s);
  assert.match(accessCss, /\.auth-field input\s*\{[^}]*font-size:\s*16px/s);
  assert.match(blogCss, /\.hero-actions\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(portalScript, /function keepActiveNavVisible\(item\)/);
  assert.match(portalScript, /nav\.scrollTo\(\{ left:/);
});
