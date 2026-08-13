import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function readProjectFile(file) {
  return fs.readFile(path.join(projectRoot, file), "utf8");
}

test("profile and notification controls use dismissible mobile topbar panels", async () => {
  const [portalHtml, portalCss, portalScript] = await Promise.all([
    readProjectFile("index.html"),
    readProjectFile("styles.css"),
    readProjectFile("script.js")
  ]);

  assert.doesNotMatch(portalHtml, /Wallet-funded subscriptions and account controls\./);
  assert.match(portalHtml, /id="dropdownProfileName"/);
  assert.match(portalCss, /\.dropdown-panel\s*\{[^}]*width:\s*min\(248px,/s);
  assert.match(portalCss, /\.topbar-menu summary\s*\{[^}]*min-height:\s*40px/s);
  assert.match(portalCss, /top:\s*calc\(62px \+ max\(10px, env\(safe-area-inset-top, 0px\)\)\)/);
  assert.match(portalCss, /@keyframes topbarPanelEnter/);
  assert.match(portalScript, /topbarMenu\?\.addEventListener\("toggle"/);
  assert.match(portalScript, /document\.addEventListener\("pointerdown"[\s\S]*notificationCenter\?\.contains/);
  assert.match(portalScript, /closeTopbarOverlays\(\{ restoreFocus: true \}\)/);
});
