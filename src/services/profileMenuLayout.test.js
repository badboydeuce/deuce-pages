import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function readProjectFile(file) {
  return fs.readFile(path.join(projectRoot, file), "utf8");
}

test("profile controls stay concise and use a compact dropdown", async () => {
  const [portalHtml, portalCss] = await Promise.all([
    readProjectFile("index.html"),
    readProjectFile("styles.css")
  ]);

  assert.doesNotMatch(portalHtml, /Wallet-funded subscriptions and account controls\./);
  assert.match(portalHtml, /id="dropdownProfileName"/);
  assert.match(portalCss, /\.dropdown-panel\s*\{[^}]*width:\s*min\(248px,/s);
  assert.match(portalCss, /\.topbar-menu summary\s*\{[^}]*min-height:\s*40px/s);
});
