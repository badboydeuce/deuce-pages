import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("new-result alerts use a louder layered chime without stacking", async () => {
  const portalScript = await fs.readFile(path.join(projectRoot, "script.js"), "utf8");
  const soundFunction = portalScript.match(/function playNewResultTone\(\) \{[\s\S]*?\n\}/)?.[0] || "";

  assert.match(portalScript, /const resultToneCooldownMs = 1200/);
  assert.match(soundFunction, /requestedAt - lastResultToneAt < resultToneCooldownMs/);
  assert.match(soundFunction, /const voices = \[[\s\S]*frequency: 293\.66[\s\S]*frequency: 587\.33[\s\S]*frequency: 739\.99[\s\S]*frequency: 880/);
  assert.match(soundFunction, /master\.gain\.exponentialRampToValueAtTime\(0\.82/);
  assert.match(soundFunction, /createDynamicsCompressor\(\)/);
  assert.match(soundFunction, /createStereoPanner/);
  assert.doesNotMatch(soundFunction, /exponentialRampToValueAtTime\(0\.08/);
});
