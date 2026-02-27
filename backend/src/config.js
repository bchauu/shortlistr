import fs from "node:fs";
import { fileURLToPath } from "node:url";

let dotenvLoaded = false;

function loadDotEnvOnce() {
  if (dotenvLoaded) return;
  dotenvLoaded = true;

  try {
    const envPath = fileURLToPath(new URL("../.env", import.meta.url));
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/g)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;

      const keyRaw = trimmed.slice(0, eq).trim();
      const key = keyRaw.startsWith("export ") ? keyRaw.slice("export ".length).trim() : keyRaw;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (process.env[key] !== undefined) continue;

      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
        (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
      ) {
        value = value.slice(1, -1);
        value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\\\/g, "\\");
      }
      process.env[key] = value;
    }
  } catch {
    // Best-effort; env vars can come from the host (Render, shell, etc).
  }
}

// Load `backend/.env` for local development (Render sets env vars via the dashboard).
loadDotEnvOnce();

export const config = {
  buildId: process.env.BUILD_ID || new Date().toISOString(),
  port: Number(process.env.PORT) || 8787,
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  mongoUri: process.env.MONGODB_URI || process.env.MONGO_URI || "",
  mongoDbName: process.env.MONGODB_DB || process.env.MONGO_DB || "shortlistr",
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  jwtExpiresDays: Number(process.env.JWT_EXPIRES_DAYS) || 30,
  apiToken: process.env.API_TOKEN || "",
  allowQuotaReset: String(process.env.ALLOW_QUOTA_RESET || "").toLowerCase() === "true",
  corsOrigins: (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE) || 60,
  dailyAnalyzeLimit: Number(process.env.DAILY_ANALYZE_LIMIT) || 25,
  jsonLimit: "2mb",
  resumeMaxBytes: 6 * 1024 * 1024
};

export function hasOpenAI(cfg = config) {
  return Boolean(cfg.openaiApiKey);
}
