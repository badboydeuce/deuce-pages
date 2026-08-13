import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function readProjectFile(file) {
  return fs.readFile(path.join(projectRoot, file), "utf8");
}

test("blog is an integrated floor-lamp login experience without guide copy", async () => {
  const [html, css, script] = await Promise.all([
    readProjectFile("blog/index.html"),
    readProjectFile("blog/blog.css"),
    readProjectFile("blog/blog.js")
  ]);

  assert.match(html, /id="pullCord"[\s\S]*aria-controls="memberLogin"/);
  assert.match(html, /id="memberLogin"[\s\S]*aria-hidden="true" inert/);
  assert.match(html, /id="loginForm"/);
  assert.match(html, /class="lamp-base"/);
  assert.match(html, /class="lamp-stand"/);
  assert.match(html, /class="lamp-shade"/);
  assert.match(html, /class="switch-housing"/);
  assert.match(html, /class="glass-glint"/);
  assert.match(html, /class="chain-pivot"/);
  assert.doesNotMatch(html, /class="ceiling-anchor"/);
  assert.doesNotMatch(html, /Operator Guide|guide-section|Frequently asked/i);

  assert.match(css, /\.access-scene\.is-active \.lamp-rig/);
  assert.match(css, /\.switch-housing/);
  assert.match(css, /\.access-scene\.is-active \.stand-status i/);
  assert.match(css, /\.access-scene\.is-active \.bulb/);
  assert.match(css, /\.access-scene\.is-active \.login-stage/);
  assert.match(css, /@keyframes lampKick/);
  assert.match(css, /@keyframes filamentIgnition/);
  assert.match(css, /\.access-scene\.is-armed \.chain-handle/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

  assert.match(script, /pullCord\.addEventListener\("pointerdown"/);
  assert.match(script, /pullCord\.addEventListener\("pointermove"/);
  assert.match(script, /navigator\.vibrate\?\./);
  assert.match(script, /function playSwitchClick\(\)/);
  assert.match(script, /scene\.classList\.add\("is-switching"\)/);
  assert.match(script, /loginStage\.removeAttribute\("inert"\)/);
  assert.match(script, /await api\("\/api\/auth\/login"/);
});
