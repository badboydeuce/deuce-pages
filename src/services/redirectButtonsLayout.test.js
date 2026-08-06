import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("redirect controls use one manifest-ordered name-only button grid", async () => {
  const script = await fs.readFile(path.join(projectRoot, "script.js"), "utf8");
  const markupStart = script.indexOf("function sessionCommandMarkup(");
  const markupEnd = script.indexOf("function activeSessionCardMarkup(", markupStart);
  const markup = script.slice(markupStart, markupEnd);

  assert.match(markup, /pageTargets\.length \? pageTargets\.map\(targetButton\)\.join\(""\)/);
  assert.match(markup, /<span>\$\{escapeHtml\(target\.label\)\}<\/span>/);
  assert.match(markup, /isError \? "is-error"/);
  assert.match(markup, /isSuccess \? "is-success"/);
  assert.doesNotMatch(markup, /groupedTargets|session-route-group|stageLabels/);
});

test("redirect button grid is responsive without adding visible state labels", async () => {
  const styles = await fs.readFile(path.join(projectRoot, "styles.css"), "utf8");

  assert.match(styles, /\.session-route-buttons\s*\{[^}]*repeat\(4, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*?\.session-route-buttons\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.session-route-buttons\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 360px\)[\s\S]*?\.session-route-buttons\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(styles, /\.session-route-buttons button\.is-current:disabled\s*\{[^}]*background:\s*var\(--accent\)[^}]*opacity:\s*1/s);
  assert.doesNotMatch(styles, /\.session-route-buttons button\.is-current::after|content:\s*["']\s*now/);
});
