import crypto from "node:crypto";

export const challengeProofTtlMs = 10 * 60 * 1000;
export const sourceChallengeProofTtlMs = 30 * 60 * 1000;

function proofSecret() {
  return process.env.CHALLENGE_PROOF_SECRET || process.env.JWT_SECRET || "deuce-pages-challenge-proof-secret";
}

function signature(encoded) {
  return crypto.createHmac("sha256", proofSecret()).update(encoded).digest("base64url");
}

export function createChallengeProof({ userPageId, sessionId, ip, scope = "session", ttlMs = challengeProofTtlMs }) {
  const payload = {
    userPageId: String(userPageId || ""),
    sessionId: String(sessionId || ""),
    ip: String(ip || ""),
    scope: String(scope || "session"),
    expiresAt: Date.now() + Math.max(1, Number(ttlMs) || challengeProofTtlMs)
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function verifyChallengeProof(token, { userPageId, sessionId, ip, scope = "session" }) {
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
      && String(payload.scope || "session") === String(scope || "session")
      && Number(payload.expiresAt) >= Date.now();
  } catch {
    return false;
  }
}

export function createSourceChallengeProof({ userPageId, ip }) {
  return createChallengeProof({
    userPageId,
    sessionId: "",
    ip,
    scope: "source",
    ttlMs: sourceChallengeProofTtlMs
  });
}

export function verifySourceChallengeProof(token, { userPageId, ip }) {
  return verifyChallengeProof(token, {
    userPageId,
    sessionId: "",
    ip,
    scope: "source"
  });
}
