import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./app.js";

async function withServer(run) {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const address = server.address();
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("root identifies DEUCE without serving workspace or package content", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/html/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
    assert.match(body, /DEUCE Pages service endpoint/);
    assert.match(body, /not a customer website/);
    assert.match(body, /href="\/app#login"/);
    assert.doesNotMatch(body, /id="preview"|data-route=|Pro Hacker Templates/);
  });
});

test("workspace remains available at the explicit app route", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/app`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /<title>DEUCE Pages \| Workspace<\/title>/);
    assert.match(body, /id="preview"/);
  });
});

test("API health route remains available", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.service, "deuce-pages-api");
  });
});
