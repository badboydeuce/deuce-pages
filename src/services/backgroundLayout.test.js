import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "script.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");

test("portal uses a calm ambient field instead of falling matrix digits", () => {
  assert.match(html, /class="ambient-field"/);
  assert.match(html, /ambient-orb-primary/);
  assert.match(html, /ambient-orb-secondary/);
  assert.doesNotMatch(html, /id="matrix"|class="scanline"/);
  assert.doesNotMatch(script, /drawMatrix|resetStreams|glyphs|\.getContext\("2d"\)/);
});

test("ambient background honors reduced motion and disables animation on mobile", () => {
  assert.match(styles, /@keyframes ambientDriftPrimary/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.ambient-orb\s*\{[\s\S]*?animation:\s*none/s);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.ambient-orb\s*\{[\s\S]*?animation:\s*none/s);
  assert.match(styles, /\.ambient-orb-depth\s*\{[\s\S]*?display:\s*none/s);
});
