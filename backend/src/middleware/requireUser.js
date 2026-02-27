import { verifyJwt } from "../auth/jwt.js";

export function createRequireUser(config) {
  const secret = String(config?.jwtSecret || "");
  return (req, res, next) => {
    const auth = req.header("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!token) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const payload = verifyJwt({ secret, token });
      const userId = String(payload?.sub || "");
      const email = String(payload?.email || "");
      if (!userId) throw new Error("Missing sub");
      req.user = { id: userId, email };
      next();
    } catch {
      res.status(401).json({ error: "Unauthorized" });
    }
  };
}

