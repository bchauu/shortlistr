import { z } from "zod";
import { hashPassword, verifyPassword } from "../../auth/password.js";
import { signJwt } from "../../auth/jwt.js";
import { createUser, findUserByEmail, normalizeEmail } from "../../db/repo.js";

const AuthSchema = z.object({
  email: z
    .string({ required_error: "Email is required." })
    .trim()
    .min(1, "Email is required.")
    .email("Please enter a valid email address."),
  password: z.string({ required_error: "Password is required." }).min(6, "Password must be at least 6 characters.")
});

function authErrorMessage(flat) {
  const emailErr = flat?.fieldErrors?.email?.[0];
  if (emailErr) return String(emailErr);
  const pwErr = flat?.fieldErrors?.password?.[0];
  if (pwErr) return String(pwErr);
  const formErr = flat?.formErrors?.[0];
  if (formErr) return String(formErr);
  return "Invalid email or password.";
}

export function createAuthHandlers(config) {
  return {
    signup: async (req, res) => {
      const startedAt = Date.now();
      if (!config.mongoUri) {
        console.warn("[auth] signup blocked: mongo not configured");
        res.status(503).json({ error: "MongoDB not configured." });
        return;
      }
      const parsed = AuthSchema.safeParse(req.body);
      if (!parsed.success) {
        const flat = parsed.error.flatten();
        res.status(400).json({ error: authErrorMessage(flat), details: flat });
        return;
      }

      const email = normalizeEmail(parsed.data.email);
      console.log("[auth] signup attempt", email);
      const existing = await findUserByEmail({ config, email });
      if (existing) {
        console.log("[auth] signup exists", email);
        res.status(409).json({ error: "Account already exists." });
        return;
      }

      const passwordHash = await hashPassword(parsed.data.password);
      const user = await createUser({ config, email, passwordHash });
      const token = signJwt({
        secret: String(config.jwtSecret || ""),
        payload: { sub: user.id, email: user.email },
        expiresInSeconds: 60 * 60 * 24 * Number(config.jwtExpiresDays || 30)
      });

      console.log("[auth] signup ok", email, "ms=", Date.now() - startedAt);
      res.json({ ok: true, token, user: { id: user.id, email: user.email } });
    },

    login: async (req, res) => {
      const startedAt = Date.now();
      if (!config.mongoUri) {
        console.warn("[auth] login blocked: mongo not configured");
        res.status(503).json({ error: "MongoDB not configured." });
        return;
      }
      const parsed = AuthSchema.safeParse(req.body);
      if (!parsed.success) {
        const flat = parsed.error.flatten();
        res.status(400).json({ error: authErrorMessage(flat), details: flat });
        return;
      }

      const email = normalizeEmail(parsed.data.email);
      console.log("[auth] login attempt", email);
      const user = await findUserByEmail({ config, email });
      if (!user) {
        console.log("[auth] login invalid", email);
        res.status(401).json({ error: "Invalid email or password." });
        return;
      }

      const ok = await verifyPassword(parsed.data.password, user.passwordHash);
      if (!ok) {
        console.log("[auth] login invalid", email);
        res.status(401).json({ error: "Invalid email or password." });
        return;
      }

      const token = signJwt({
        secret: String(config.jwtSecret || ""),
        payload: { sub: user.id, email: user.email },
        expiresInSeconds: 60 * 60 * 24 * Number(config.jwtExpiresDays || 30)
      });

      console.log("[auth] login ok", email, "ms=", Date.now() - startedAt);
      res.json({ ok: true, token, user: { id: user.id, email: user.email } });
    }
  };
}
