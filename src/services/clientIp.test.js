import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { clientIp, configureClientIpTrust, trustedRelayClientIp } from "./clientIp.js";

async function observedClientIp(env, headers = {}) {
  const app = express();
  configureClientIpTrust(app, env);
  app.get("/", (req, res) => {
    res.json({ ip: clientIp(req), ips: req.ips });
  });

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}`, { headers });
    return response.json();
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("ignores forwarded client IP headers outside a Render web service", async () => {
  const observed = await observedClientIp(
    { NODE_ENV: "production" },
    {
      "X-Forwarded-For": "198.51.100.20",
      "CF-Connecting-IP": "198.51.100.30"
    }
  );

  assert.equal(observed.ip, "127.0.0.1");
  assert.deepEqual(observed.ips, []);
});

test("trusts only Render's immediate forwarded hop", async () => {
  const observed = await observedClientIp(
    { RENDER: "true", RENDER_SERVICE_TYPE: "web" },
    {
      "X-Forwarded-For": "198.51.100.40, 203.0.113.10",
      "CF-Connecting-IP": "198.51.100.50"
    }
  );

  assert.equal(observed.ip, "203.0.113.10");
  assert.deepEqual(observed.ips, ["203.0.113.10"]);
});

test("does not enable proxy trust for non-web Render services", async () => {
  const observed = await observedClientIp(
    { RENDER: "true", RENDER_SERVICE_TYPE: "pserv" },
    { "X-Forwarded-For": "198.51.100.60" }
  );

  assert.equal(observed.ip, "127.0.0.1");
  assert.deepEqual(observed.ips, []);
});

test("uses the Worker visitor IP only after relay authentication", () => {
  const request = {
    headers: { "x-deuce-client-ip": "198.51.100.88" },
    ip: "203.0.113.40",
    socket: { remoteAddress: "203.0.113.41" }
  };

  assert.equal(trustedRelayClientIp(request), "203.0.113.40");
  request.deuceRelayTrusted = true;
  assert.equal(trustedRelayClientIp(request), "198.51.100.88");

  request.headers["x-deuce-client-ip"] = "spoofed";
  assert.equal(trustedRelayClientIp(request), "203.0.113.40");
});
