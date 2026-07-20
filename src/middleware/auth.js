import { getUserBySessionToken } from "../repositories/appRepository.js";

function readBearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export async function requireAuth(req, res, next) {
  try {
    const user = await getUserBySessionToken(readBearerToken(req));
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.user = user;
    next();
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

export async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (String(req.user?.role || "").toLowerCase() !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  });
}

export function requireCapability(capability) {
  return async function capabilityMiddleware(req, res, next) {
    await requireAuth(req, res, () => {
      if (String(req.user?.role || "").toLowerCase() === "admin") return next();
      const collaboration = req.user?.collaboration || {};
      if (collaboration.enabled && collaboration[capability]) return next();
      res.status(403).json({ error: `${capability} permission required` });
    });
  };
}

export function requireAnyCapability(...capabilities) {
  return async function anyCapabilityMiddleware(req, res, next) {
    await requireAuth(req, res, () => {
      if (String(req.user?.role || "").toLowerCase() === "admin") return next();
      const collaboration = req.user?.collaboration || {};
      if (collaboration.enabled && capabilities.some((capability) => collaboration[capability])) return next();
      res.status(403).json({ error: "Support permission required" });
    });
  };
}
