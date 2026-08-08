import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { cloudflareWorkerScript } from "./cloudflareDeploy.js";

test("managed Worker removes the customer Origin before forwarding runtime requests", async () => {
  const previousRuntimeApiBaseUrl = process.env.RUNTIME_API_BASE_URL;
  const previousApiBaseUrl = process.env.API_BASE_URL;
  const previousAppBaseUrl = process.env.APP_BASE_URL;

  process.env.RUNTIME_API_BASE_URL = "https://api.example";
  delete process.env.API_BASE_URL;
  delete process.env.APP_BASE_URL;

  try {
    const source = cloudflareWorkerScript({ relaySecret: "relay-test-secret" });
    let fetchHandler;
    let forwardedRequest;
    let responsePromise;

    vm.runInNewContext(source, {
      URL,
      Headers,
      Request,
      Response,
      addEventListener(type, handler) {
        if (type === "fetch") fetchHandler = handler;
      },
      async fetch(target, init) {
        forwardedRequest = { target, init };
        return new Response("ok", {
          status: 200,
          headers: { "Set-Cookie": "deuce_source_proof=proof; Path=/api; HttpOnly; Secure" }
        });
      }
    });

    assert.equal(typeof fetchHandler, "function");

    const request = new Request("https://client.example/api/traffic", {
      method: "POST",
      headers: {
        Origin: "https://client.example",
        "CF-Connecting-IP": "198.51.100.70",
        "Content-Type": "application/json",
        "X-Deuce-Client-IP": "203.0.113.99",
        "X-Test": "preserved"
      },
      body: "{}"
    });

    fetchHandler({
      request,
      respondWith(value) {
        responsePromise = Promise.resolve(value);
      }
    });
    const response = await responsePromise;

    assert.equal(response.status, 200);
    assert.equal(forwardedRequest.target, "https://api.example/api/runtime/traffic");
    assert.equal(forwardedRequest.init.headers.get("origin"), null);
    assert.equal(forwardedRequest.init.headers.get("x-deuce-relay-secret"), "relay-test-secret");
    assert.equal(forwardedRequest.init.headers.get("x-deuce-client-host"), "client.example");
    assert.equal(forwardedRequest.init.headers.get("x-deuce-client-ip"), "198.51.100.70");
    assert.equal(forwardedRequest.init.headers.get("x-test"), "preserved");
    assert.match(response.headers.get("set-cookie") || "", /^deuce_source_proof=proof/);
  } finally {
    if (previousRuntimeApiBaseUrl === undefined) delete process.env.RUNTIME_API_BASE_URL;
    else process.env.RUNTIME_API_BASE_URL = previousRuntimeApiBaseUrl;
    if (previousApiBaseUrl === undefined) delete process.env.API_BASE_URL;
    else process.env.API_BASE_URL = previousApiBaseUrl;
    if (previousAppBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previousAppBaseUrl;
  }
});

test("browser Worker template also removes Origin", async () => {
  const browserSource = await readFile(new URL("../../script.js", import.meta.url), "utf8");

  assert.match(
    browserSource,
    /const headers = new Headers\(request\.headers\);\s+headers\.delete\("origin"\);\s+headers\.delete\("x-deuce-client-ip"\);/
  );
  assert.match(browserSource, /request\.headers\.get\("cf-connecting-ip"\)/);
});
