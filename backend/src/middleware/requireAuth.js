import crypto from "node:crypto";

export function createRequireAuth(apiToken) {
  const expected = String(apiToken || "");
  if (!expected) {
    return (_req, _res, next) => next();
  }

  return (req, res, next) => {
    const auth = req.header("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : req.header("x-shortlistr-token") || "";

    if (token && token.length === expected.length) {
      if (crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return next();
    }

    res.status(401).json({ error: "Unauthorized" });
  };
}

