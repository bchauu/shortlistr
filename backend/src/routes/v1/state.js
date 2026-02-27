import { z } from "zod";
import { dayKeyFromTzOffsetMinutes, getShortlistCount, getUserDailyAnalyze, getUserState, updateUserState } from "../../db/repo.js";

function nextLocalResetAtIso(dayKey, tzOffsetMinutes) {
  const off = Number(tzOffsetMinutes);
  if (!Number.isFinite(off) || Math.abs(off) > 14 * 60) return "";
  if (typeof dayKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return "";

  const base = new Date(`${dayKey}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + 1);
  const nextDayKey = base.toISOString().slice(0, 10);
  const resetMs = Date.parse(`${nextDayKey}T00:00:00.000Z`) + off * 60_000;
  if (!Number.isFinite(resetMs)) return "";
  return new Date(resetMs).toISOString();
}

const ProfileSchema = z
  .object({
    lookingFor: z.string().optional(),
    strengths: z.string().optional(),
    workHighlights: z.string().optional(),
    mustHaves: z.string().optional(),
    niceToHaves: z.string().optional(),
    avoid: z.string().optional()
  })
  .optional();

const SettingsSchema = z
  .object({
    autoShortlistThreshold: z.number().optional(),
    promptShortlistThreshold: z.number().optional(),
    autoSaveNearCertain: z.boolean().optional(),
    autoSaveGreatFit: z.boolean().optional(),
    autoSavePossibleFit: z.boolean().optional()
  })
  .optional();

const PutStateSchema = z.object({
  profile: ProfileSchema,
  settings: SettingsSchema,
  resumeText: z.string().optional()
});

export function createStateHandlers(config) {
  return {
    get: async (req, res) => {
      const startedAt = Date.now();
      if (!config.mongoUri) {
        console.warn("[state] get blocked: mongo not configured");
        res.status(503).json({ error: "MongoDB not configured." });
        return;
      }
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const state = await getUserState({ config, userId });
      const shortlistCount = await getShortlistCount({ config, userId });

      const tzOffsetMinutes = req.query && req.query.tzOffsetMinutes != null ? Number(req.query.tzOffsetMinutes) : undefined;
      const day = dayKeyFromTzOffsetMinutes(tzOffsetMinutes);
      const daily = await getUserDailyAnalyze({ config, userId });
      const used = daily && daily.day === day ? Number(daily.count) || 0 : 0;
      const limit = Number(config.dailyAnalyzeLimit) || 25;
      const remaining = Math.max(0, limit - used);
      const resetAt = nextLocalResetAtIso(day, tzOffsetMinutes);

      console.log(
        "[state] get ok",
        userId,
        "shortlist=",
        shortlistCount,
        "quota=",
        `${used}/${limit}`,
        "day=",
        day,
        "ms=",
        Date.now() - startedAt
      );
      res.json({
        ok: true,
        profile: state.profile,
        settings: state.settings,
        resumeText: state.resumeText,
        resumeTextLen: (state.resumeText || "").length,
        shortlistCount,
        quota: {
          day,
          used,
          limit,
          remaining,
          resetAt,
          firstAt: daily?.firstAt || "",
          lastAt: daily?.lastAt || ""
        }
      });
    },

    put: async (req, res) => {
      const startedAt = Date.now();
      if (!config.mongoUri) {
        console.warn("[state] put blocked: mongo not configured");
        res.status(503).json({ error: "MongoDB not configured." });
        return;
      }
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const parsed = PutStateSchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request.", details: parsed.error.flatten() });
        return;
      }

      await updateUserState({
        config,
        userId,
        profile: parsed.data.profile,
        settings: parsed.data.settings,
        resumeText: typeof parsed.data.resumeText === "string" ? parsed.data.resumeText : undefined
      });
      console.log("[state] put ok", userId, "ms=", Date.now() - startedAt);
      res.json({ ok: true });
    }
  };
}
