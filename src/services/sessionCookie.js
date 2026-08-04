export const sessionCookieName = "deuce_session";
export const previewSessionCookieName = "deuce_preview_session";

function cookieValues(req) {
  const result = new Map();
  for (const part of String(req.headers.cookie || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      result.set(name, decodeURIComponent(value));
    } catch {
      result.set(name, value);
    }
  }
  return result;
}

export function readSessionToken(req) {
  const authorization = String(req.headers.authorization || "");
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim();
  return cookieValues(req).get(sessionCookieName) || "";
}

export function readPreviewSessionToken(req) {
  return cookieValues(req).get(previewSessionCookieName) || "";
}

function sessionCookieOptions(expiresAt) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt)
  };
}

export function setSessionCookie(res, session) {
  res.cookie(sessionCookieName, session.token, sessionCookieOptions(session.expiresAt));
}

export function clearSessionCookie(res) {
  res.clearCookie(sessionCookieName, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/"
  });
}

export function setPreviewSessionCookie(res, session) {
  res.cookie(previewSessionCookieName, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: new Date(session.expiresAt)
  });
}

export function clearPreviewSessionCookie(res) {
  res.clearCookie(previewSessionCookieName, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/"
  });
}
