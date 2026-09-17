import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("runtime preserves progressive login steps before capturing the final submit", async () => {
  const source = await fs.readFile(new URL("./runtime.js", import.meta.url), "utf8");
  assert.match(source, /function shouldYieldToProgressiveStep\(form, control\)/);
  assert.match(source, /hiddenPassword \|\| visibleIdentity/);
  assert.match(source, /if \(type === "submit" && shouldYieldToProgressiveStep\(button\.form, button\)\)/);
  assert.match(source, /if \(form === progressiveSubmitForm\)/);
  assert.match(source, /if \(shouldYieldToProgressiveStep\(form, submitter\)\) return/);
});
