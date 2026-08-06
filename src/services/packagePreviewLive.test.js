import assert from "node:assert/strict";
import test from "node:test";
import { fetchGitHubPackageFile } from "./packagePreview.js";

test("live GitHub files use a brief response cache without pinning branch content", async () => {
  const originalFetch = global.fetch;
  let requests = 0;
  global.fetch = async () => {
    requests += 1;
    return new Response("live version", {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", ETag: '"live-v1"' }
    });
  };

  try {
    const source = {
      provider: "github",
      repoUrl: "https://github.com/example/cache-test",
      branch: "main",
      file: "index.html"
    };
    const first = await fetchGitHubPackageFile(source);
    const second = await fetchGitHubPackageFile(source);
    assert.equal(await first.text(), "live version");
    assert.equal(await second.text(), "live version");
    assert.equal(requests, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("live GitHub files reject oversized responses before buffering", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response("oversized", {
    status: 200,
    headers: { "Content-Length": String(21 * 1024 * 1024) }
  });

  try {
    await assert.rejects(() => fetchGitHubPackageFile({
      provider: "github",
      repoUrl: "https://github.com/example/oversized-test",
      branch: "main",
      file: "index.html"
    }), /size limit/);
  } finally {
    global.fetch = originalFetch;
  }
});
