import { z } from "zod";
import { clearShortlist, deleteShortlistItem, listShortlistItems, upsertShortlistItem } from "../../db/repo.js";

const UpsertSchema = z.object({
  item: z.object({
    key: z.string().optional(),
    savedAt: z.string().optional(),
    job: z.record(z.any()).default({}),
    analysis: z.record(z.any()).default({})
  })
});

const DeleteSchema = z.object({
  key: z.string().min(1)
});

export function createShortlistHandlers(config) {
  return {
    list: async (req, res) => {
      const startedAt = Date.now();
      if (!config.mongoUri) {
        console.warn("[shortlist] list blocked: mongo not configured");
        res.status(503).json({ error: "MongoDB not configured." });
        return;
      }
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const shortlist = await listShortlistItems({ config, userId, limit: 800 });
      console.log("[shortlist] list ok", userId, "count=", shortlist.length, "ms=", Date.now() - startedAt);
      res.json({ ok: true, shortlist });
    },

    upsert: async (req, res) => {
      const startedAt = Date.now();
      if (!config.mongoUri) {
        console.warn("[shortlist] upsert blocked: mongo not configured");
        res.status(503).json({ error: "MongoDB not configured." });
        return;
      }
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const parsed = UpsertSchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request.", details: parsed.error.flatten() });
        return;
      }

      const { key } = await upsertShortlistItem({ config, userId, item: parsed.data.item });
      console.log("[shortlist] upsert ok", userId, "key=", key, "ms=", Date.now() - startedAt);
      res.json({ ok: true, key });
    },

    del: async (req, res) => {
      const startedAt = Date.now();
      if (!config.mongoUri) {
        console.warn("[shortlist] delete blocked: mongo not configured");
        res.status(503).json({ error: "MongoDB not configured." });
        return;
      }
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const parsed = DeleteSchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request.", details: parsed.error.flatten() });
        return;
      }

      await deleteShortlistItem({ config, userId, key: parsed.data.key });
      console.log("[shortlist] delete ok", userId, "key=", parsed.data.key, "ms=", Date.now() - startedAt);
      res.json({ ok: true });
    },

    clear: async (req, res) => {
      const startedAt = Date.now();
      if (!config.mongoUri) {
        console.warn("[shortlist] clear blocked: mongo not configured");
        res.status(503).json({ error: "MongoDB not configured." });
        return;
      }
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      await clearShortlist({ config, userId });
      console.log("[shortlist] clear ok", userId, "ms=", Date.now() - startedAt);
      res.json({ ok: true });
    }
  };
}
