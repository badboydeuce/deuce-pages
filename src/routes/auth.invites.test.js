import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("invite-only registration consumes links once and supports admin revocation", async () => {
  const previous = {
    LOCAL_JSON_DB: process.env.LOCAL_JSON_DB,
    JSON_DB_PATH: process.env.JSON_DB_PATH,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    NODE_ENV: process.env.NODE_ENV
  };
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "deuce-invites-"));
  const dbPath = path.join(tempDir, "local-db.json");
  process.env.LOCAL_JSON_DB = "true";
  process.env.JSON_DB_PATH = dbPath;
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.NODE_ENV = "development";

  const repository = await import(`../repositories/appRepository.js?invite-test=${Date.now()}`);
  const admin = await repository.createUser({
    name: "Invite Admin",
    email: "admin@example.com",
    password: "admin-password-123"
  });
  const adminSession = await repository.createSession(admin.id);
  const { createApp } = await import(`../app.js?invite-app-test=${Date.now()}`);
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function api(pathname, { method = "GET", token = "", cookie = "", body } = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  try {
    const publicRegistration = await api("/api/auth/register", {
      method: "POST",
      body: { name: "No Invite", password: "password-123" }
    });
    assert.equal(publicRegistration.response.status, 400);
    assert.match(publicRegistration.data.error, /invitation/i);

    const unauthorizedCreate = await api("/api/admin/invites", {
      method: "POST",
      body: { email: "member@example.com", expiresInHours: 48 }
    });
    assert.equal(unauthorizedCreate.response.status, 401);

    const created = await api("/api/admin/invites", {
      method: "POST",
      token: adminSession.token,
      body: { email: "Member@Example.com", expiresInHours: 48 }
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.data.invitation.email, "member@example.com");
    assert.equal(created.data.invitation.status, "pending");
    assert.match(created.data.token, /^[A-Za-z0-9_-]{40,}$/);

    const storedBeforeSignup = await fs.readFile(dbPath, "utf8");
    assert.equal(storedBeforeSignup.includes(created.data.token), false);

    const validated = await api("/api/auth/invitations/validate", {
      method: "POST",
      body: { inviteToken: created.data.token }
    });
    assert.equal(validated.response.status, 200);
    assert.equal(validated.data.invitation.email, "member@example.com");

    const failedSignup = await api("/api/auth/register", {
      method: "POST",
      body: { name: "Invited Member", password: "short", inviteToken: created.data.token }
    });
    assert.equal(failedSignup.response.status, 400);

    const stillValid = await api("/api/auth/invitations/validate", {
      method: "POST",
      body: { inviteToken: created.data.token }
    });
    assert.equal(stillValid.response.status, 200);

    const signup = await api("/api/auth/register", {
      method: "POST",
      body: {
        name: "Invited Member",
        password: "member-password-123",
        inviteToken: created.data.token
      }
    });
    assert.equal(signup.response.status, 201);
    assert.equal(signup.data.user.email, "member@example.com");
    assert.equal(signup.data.token, undefined);
    const setCookie = signup.response.headers.get("set-cookie") || "";
    assert.match(setCookie, /^deuce_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    const sessionCookie = setCookie.split(";")[0];

    const sessionUser = await api("/api/auth/me", { cookie: sessionCookie });
    assert.equal(sessionUser.response.status, 200);
    assert.equal(sessionUser.data.user.email, "member@example.com");

    const protectedPortal = await fetch(`${baseUrl}/portal`, { headers: { Cookie: sessionCookie } });
    assert.equal(protectedPortal.status, 200);
    const portalHtml = await protectedPortal.text();
    assert.match(portalHtml, /DEUCE PAGES/);
    assert.doesNotMatch(portalHtml, /Opening workspace|Loading your session, pages, wallet, and live controls\./);
    assert.doesNotMatch(portalHtml, /Welcome back|Loading your workspace access screen/);

    const logout = await api("/api/auth/logout", { method: "POST", cookie: sessionCookie });
    assert.equal(logout.response.status, 200);
    const revokedPortal = await fetch(`${baseUrl}/portal`, { headers: { Cookie: sessionCookie }, redirect: "manual" });
    assert.equal(revokedPortal.status, 303);
    assert.equal(revokedPortal.headers.get("location"), "/login");

    const reusedValidation = await api("/api/auth/invitations/validate", {
      method: "POST",
      body: { inviteToken: created.data.token }
    });
    assert.equal(reusedValidation.response.status, 410);

    const reusedSignup = await api("/api/auth/register", {
      method: "POST",
      body: {
        name: "Second Member",
        password: "another-password-123",
        inviteToken: created.data.token
      }
    });
    assert.equal(reusedSignup.response.status, 410);

    const listed = await api("/api/admin/invites", { token: adminSession.token });
    assert.equal(listed.response.status, 200);
    assert.equal(listed.data.invitations[0].status, "used");
    assert.ok(listed.data.invitations[0].usedAt);
    assert.equal(JSON.stringify(listed.data).includes(created.data.token), false);

    const revocable = await api("/api/admin/invites", {
      method: "POST",
      token: adminSession.token,
      body: { email: "revoked@example.com", expiresInHours: 24 }
    });
    assert.equal(revocable.response.status, 201);

    const revoked = await api(`/api/admin/invites/${revocable.data.invitation.id}`, {
      method: "DELETE",
      token: adminSession.token
    });
    assert.equal(revoked.response.status, 200);
    assert.equal(revoked.data.invitation.status, "revoked");

    const revokedValidation = await api("/api/auth/invitations/validate", {
      method: "POST",
      body: { inviteToken: revocable.data.token }
    });
    assert.equal(revokedValidation.response.status, 410);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(tempDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
