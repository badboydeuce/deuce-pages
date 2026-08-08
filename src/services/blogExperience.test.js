import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function readProjectFile(file) {
  return fs.readFile(path.join(projectRoot, file), "utf8");
}

test("blog is a pull-cord login experience without guide copy", async () => {
  const [html, css, script] = await Promise.all([
    readProjectFile("blog/index.html"),
    readProjectFile("blog/blog.css"),
    readProjectFile("blog/blog.js")
  ]);

  assert.match(html, /id="pullCord"[\s\S]*aria-controls="memberLogin"/);
  assert.match(html, /id="memberLogin"[\s\S]*aria-hidden="true" inert/);
  assert.match(html, /id="loginForm"/);
  assert.doesNotMatch(html, /Operator Guide|guide-section|Frequently asked/i);

  assert.match(css, /\.access-scene\.is-active \.lamp-rig/);
  assert.match(css, /\.access-scene\.is-active \.bulb/);
  assert.match(css, /\.access-scene\.is-active \.login-stage/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

  assert.match(script, /pullCord\.addEventListener\("pointerdown"/);
  assert.match(script, /pullCord\.addEventListener\("pointermove"/);
  assert.match(script, /loginStage\.removeAttribute\("inert"\)/);
  assert.match(script, /await api\("\/api\/auth\/login"/);
});
