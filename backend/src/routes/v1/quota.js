import { resetUserDailyAnalyze } from "../../db/repo.js";

export function createQuotaHandlers(config) {
  return {
    reset: async (req, res) => {
      const startedAt = Date.now();
      if (!config.mongoUri) {
        console.warn("[quota] reset blocked: mongo not configured");
        res.status(503).json({ error: "MongoDB not configured." });
        return;
      }
      if (!config.allowQuotaReset) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      await resetUserDailyAnalyze({ config, userId });
      console.log("[quota] reset ok", userId, "ms=", Date.now() - startedAt);
      res.json({ ok: true });
    }
  };
}

