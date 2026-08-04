import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("package preview tickets are one-time and bound to the portal session", async () => {
  const previousLocalJsonDb = process.env.LOCAL_JSON_DB;
  const previousJsonDbPath = process.env.JSON_DB_PATH;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deuce-preview-session-"));
  const dbPath = path.join(tempRoot, "db.json");
  const portalToken = "portal-session-token";
  const tokenHash = createHash("sha256").update(portalToken).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  process.env.LOCAL_JSON_DB = "true";
  process.env.JSON_DB_PATH = dbPath;
  await fs.writeFile(dbPath, JSON.stringify({
    users: [{
      id: "user_1",
      name: "Preview User",
      email: "preview@example.com",
      role: "subscriber",
      status: "active",
      walletBalance: 0,
      collaboration: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    sessions: [{
      id: "session_1",
      userId: "user_1",
      tokenHash,
      expiresAt,
      createdAt: new Date().toISOString()
    }],
    packagePreviewSessions: []
  }));

  try {
    const repository = await import("./appRepository.js");
    const ticket = await repository.createPackagePreviewTicket({
      userId: "user_1",
      userSessionId: "session_1",
      packageId: "pkg_1",
      packageVersion: "v1"
    });

    const claimed = await repository.claimPackagePreviewTicket(ticket.ticket);
    assert.equal(claimed.packageId, "pkg_1");
    assert.equal(claimed.packageVersion, "v1");
    assert.ok(claimed.token);

    const access = await repository.getPackagePreviewAccess(claimed.token);
    assert.deepEqual(
      { userId: access.userId, packageId: access.packageId, packageVersion: access.packageVersion },
      { userId: "user_1", packageId: "pkg_1", packageVersion: "v1" }
    );

    await assert.rejects(
      repository.claimPackagePreviewTicket(ticket.ticket),
      /invalid or expired/
    );

    assert.equal(await repository.revokeSessionToken(portalToken), true);
    assert.equal(await repository.getPackagePreviewAccess(claimed.token), null);
  } finally {
    if (previousLocalJsonDb === undefined) delete process.env.LOCAL_JSON_DB;
    else process.env.LOCAL_JSON_DB = previousLocalJsonDb;
    if (previousJsonDbPath === undefined) delete process.env.JSON_DB_PATH;
    else process.env.JSON_DB_PATH = previousJsonDbPath;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
