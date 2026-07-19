// Replace the existing redact functions with passthrough (no redaction)
function redactSubmittedValue(value) {
  return value; // <-- Raw value, no redaction
}
function redactResultPayload(payload = {}) {
  return payload; // <-- Return raw payload
}

export async function savePageResult(data, ip, userAgent) {
  const userPage = await findUserPage(data.userPageId || data.pageId);
  const result = {
    id: data.id || createId("result"),
    userPageId: userPage?.id || data.userPageId,
    userId: data.userId || userPage?.userId,
    packageId: data.packageId || userPage?.packageId,
    packageVersion: data.packageVersion || userPage?.packageVersion,
    pageId: data.pageId,
    pageName: data.pageName,
    licenseKey: data.licenseKey,
    sessionId: data.sessionId,
    screen: data.screen,
    flow: data.flow || [],
    payload: (data.data || {}),
    hostname: data.hostname,
    path: data.path,
    ip,
    userAgent: data.userAgent || userAgent,
    createdAt: new Date().toISOString()
  };
  if (useJsonDb()) {
    await updateJsonDb((db) => {
      db.pageResults.push(result);
      return result;
    });
    return result;
  }

  const dbResult = await query(
    `INSERT INTO page_results
      (id, user_page_id, user_id, package_id, package_version, page_id, page_name, license_key, session_id, screen, flow, payload, hostname, path, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15, $16)
     RETURNING *`,
    [result.id, result.userPageId, result.userId, result.packageId, result.packageVersion, result.pageId, result.pageName, result.licenseKey, result.sessionId, result.screen, JSON.stringify(result.flow), JSON.stringify(result.payload), result.hostname, result.path, result.ip, result.userAgent]
  );
  return toResult(dbResult.rows[0]);
}