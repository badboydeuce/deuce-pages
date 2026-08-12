import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("traffic dashboard separates unique visits, block events, and raw activity", async () => {
  const source = await fs.readFile(path.resolve(process.cwd(), "script.js"), "utf8");
  const start = source.indexOf("function trafficInsights");
  const end = source.indexOf("async function renderResultsCenter", start);
  const trafficCenter = source.slice(start, end > start ? end : undefined);

  assert.match(trafficCenter, /Unique visits/);
  assert.match(trafficCenter, /Clean visits/);
  assert.match(trafficCenter, /Visits with blocks/);
  assert.match(trafficCenter, /Block events/);
  assert.match(trafficCenter, /Total events/);
  assert.match(trafficCenter, /Device cards count unique visits/);
  assert.doesNotMatch(trafficCenter, /<span>Allowed<\/span>/);
});
