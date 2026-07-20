import crypto from "node:crypto";

function proofSecret() {
  return process.env.CHALLENGE_PROOF_SECRET || process.env.JWT_SECRET || "deuce-pages-challenge-proof-secret";
}

function signature(encoded) {
  return crypto.createHmac("sha256", proofSecret()).update(encoded).digest("base64url");
}

export function createChallengeProof({ userPageId, sessionId, ip }) {
  const payload = {
    userPageId: String(userPageId || ""),
    sessionId: String(sessionId || ""),
    ip: String(ip || ""),
    expiresAt: Date.now() + 10 * 60 * 1000
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function verifyChallengeProof(token, { userPageId, sessionId, ip }) {
  try {
    const [encoded, provided] = String(token || "").split(".");
    if (!encoded || !provided) return false;
    const expected = signature(encoded);
    const left = Buffer.from(provided);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return false;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload.userPageId === String(userPageId || "")
      && payload.sessionId === String(sessionId || "")
      && payload.ip === String(ip || "")
      && Number(payload.expiresAt) >= Date.now();
  } catch {
    return false;
  }
}
