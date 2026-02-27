import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import cors from "cors";
import { nowIso } from "./utils/text.js";
import { createV1Router } from "./routes/v1.js";

function createCorsOptions(config) {
  return {
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (!config.corsOrigins || config.corsOrigins.length === 0) return cb(null, true);
      if (origin.startsWith("chrome-extension://")) return cb(null, true);
      return cb(null, config.corsOrigins.includes(origin));
    }
  };
}

export function createApp(config) {
  const app = express();
  app.disable("x-powered-by");

  app.use(helmet());
  app.use(morgan("tiny"));
  app.use(cors(createCorsOptions(config)));
  app.use(
    express.json({
      limit: config.jsonLimit
    })
  );

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      time: nowIso(),
      build: String(config.buildId || ""),
      dailyAnalyzeLimit: Number(config.dailyAnalyzeLimit) || 0,
      mongoConfigured: Boolean(config.mongoUri),
      openaiConfigured: Boolean(config.openaiApiKey)
    });
  });

  app.use("/v1", createV1Router(config));

  app.use((err, _req, res, _next) => {
    // Avoid leaking internal details to clients; log server-side.
    console.error(err);
    const msg = err instanceof Error ? err.message : "";
    const safe =
      msg.includes("MONGODB_URI") || msg.includes("JWT secret") || msg.includes("Token expired")
        ? msg
        : "Internal server error";
    res.status(500).json({ error: safe });
  });

  return app;
}
