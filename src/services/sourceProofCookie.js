import { sourceChallengeProofTtlMs } from "./challengeProof.js";

export const sourceProofCookieName = "deuce_source_proof";

function cookieValue(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return "";
}

export function readSourceProofCookie(req) {
  return cookieValue(req, sourceProofCookieName);
}

export function setSourceProofCookie(res, token) {
  res.cookie(sourceProofCookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api",
    maxAge: sourceChallengeProofTtlMs
  });
}

export function clearSourceProofCookie(res) {
  res.clearCookie(sourceProofCookieName, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api"
  });
}
