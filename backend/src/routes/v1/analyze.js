import { AnalyzeSchema } from "../../schemas/analyze.js";
import { truncate } from "../../utils/text.js";
import { scoreWithHeuristics } from "../../scoring/heuristics.js";
import { runAgentPipeline } from "../../agents/pipeline.js";
import {
  candidateExtractCacheKey,
  dayKeyFromTzOffsetMinutes,
  getDailyAnalyzeQuota,
  getCandidateExtractCache,
  incrementDailyAnalyzeQuota,
  getUserState,
  upsertCandidateExtractCache
} from "../../db/repo.js";

export function createAnalyzeHandler(config) {
  return async (req, res) => {
    const startedAt = Date.now();
    const parsed = AnalyzeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request.", details: parsed.error.flatten() });
      return;
    }

    const rawCandidates = Array.isArray(parsed.data.job.descriptionCandidates) ? parsed.data.job.descriptionCandidates : [];
    const descriptionCandidates = rawCandidates
      .slice(0, 12)
      .map((c, idx) => ({
        id: String(c?.id || `c${idx}`),
        label: String(c?.label || ""),
        source: String(c?.source || ""),
        selector: String(c?.selector || ""),
        text: truncate(String(c?.text || ""), 9000)
      }))
      .filter((c) => c.text.length >= 80);

    const bestCandidateText = descriptionCandidates.reduce((best, c) => (c.text.length > best.length ? c.text : best), "");
    const rawDescription = String(parsed.data.job.description || "");
    const description = rawDescription.trim() ? rawDescription : bestCandidateText;

    const job = {
      ...parsed.data.job,
      description: truncate(description, 16000),
      descriptionCandidates
    };
    const reqProfile = parsed.data.profile || {};
    const reqResumeText = truncate(parsed.data.resumeText || "", 26000);
    const model = parsed.data.model || config.openaiModel;
    const dayKey = dayKeyFromTzOffsetMinutes(parsed.data.tzOffsetMinutes);
    const userId = req.user?.id;

    console.log(
      "[analyze] start",
      userId ? `user=${userId}` : "user=unknown",
      `source=${job.source || "unknown"}`,
      `url=${job.url || ""}`,
      `candidates=${descriptionCandidates.length}`,
      `model=${model}`
    );

    try {
      // Per-user daily quota (requires Mongo).
      // Philosophy: check first (no charge), run analysis, then increment on success.
      if (config.openaiApiKey && config.mongoUri && userId) {
        const quota = await getDailyAnalyzeQuota({
          config,
          userId,
          limit: config.dailyAnalyzeLimit,
          day: dayKey,
          tzOffsetMinutes: parsed.data.tzOffsetMinutes
        });
        if (!quota.ok) {
          const msg = `Daily limit hit (${quota.used}/${quota.limit}). Try again tomorrow.`;
          console.warn("[analyze] daily_limit_hit", `user=${userId}`, `day=${quota.day}`, `used=${quota.used}`, `limit=${quota.limit}`);
          res.status(429).json({ error: msg, limit: quota.limit, used: quota.used, day: quota.day });
          return;
        }
      }

      // If the extension doesn't send profile/resume (or sends blanks), fall back to stored user state.
      let stored = null;
      if (userId) {
        try {
          stored = await getUserState({ config, userId });
        } catch {
          stored = null;
        }
      }

      const storedProfile = stored?.profile || {};
      const profile = {
        lookingFor: String(reqProfile.lookingFor || "").trim() ? String(reqProfile.lookingFor) : String(storedProfile.lookingFor || ""),
        strengths: String(reqProfile.strengths || "").trim() ? String(reqProfile.strengths) : String(storedProfile.strengths || ""),
        workHighlights: String(reqProfile.workHighlights || "").trim()
          ? String(reqProfile.workHighlights)
          : String(storedProfile.workHighlights || ""),
        mustHaves: String(reqProfile.mustHaves || "").trim() ? String(reqProfile.mustHaves) : String(storedProfile.mustHaves || ""),
        niceToHaves: String(reqProfile.niceToHaves || "").trim()
          ? String(reqProfile.niceToHaves)
          : String(storedProfile.niceToHaves || ""),
        avoid: String(reqProfile.avoid || "").trim() ? String(reqProfile.avoid) : String(storedProfile.avoid || "")
      };

      const resumeText = reqResumeText.trim() ? reqResumeText : truncate(String(stored?.resumeText || ""), 26000);

      if (!config.openaiApiKey) {
        const analysis = scoreWithHeuristics(job, profile);
        console.log("[analyze] done mode=heuristics ms=", Date.now() - startedAt);
        res.json({ analysis, meta: { mode: "heuristics" } });
        return;
      }

      const key = candidateExtractCacheKey({ profile, resumeText, model });
      let cachedCandidateExtract = null;
      let usedCandidateCache = false;
      if (userId && config.mongoUri) {
        try {
          const cache = await getCandidateExtractCache({ config, userId });
          if (cache && cache.key === key && cache.model === model && cache.value) {
            cachedCandidateExtract = cache.value;
            usedCandidateCache = true;
          }
        } catch {
          cachedCandidateExtract = null;
          usedCandidateCache = false;
        }
      }

      let result;
      try {
        result = await runAgentPipeline({
          apiKey: config.openaiApiKey,
          model,
          job,
          profile,
          resumeText,
          candidateExtract: cachedCandidateExtract || undefined
        });
      } catch (e) {
        throw e;
      }

      if (!usedCandidateCache && userId && config.mongoUri) {
        try {
          await upsertCandidateExtractCache({
            config,
            userId,
            key,
            model,
            candidateExtract: result?.debug?.candidateExtract
          });
        } catch {
          // Best-effort cache; ignore failures.
        }
      }

      // Increment daily quota after successful analysis.
      if (config.mongoUri && userId) {
        try {
          await incrementDailyAnalyzeQuota({
            config,
            userId,
            limit: config.dailyAnalyzeLimit,
            day: dayKey,
            tzOffsetMinutes: parsed.data.tzOffsetMinutes
          });
        } catch (e) {
          // Best-effort: don't fail the analysis response if quota increment fails.
          const msg = e && typeof e === "object" && "message" in e ? String(e.message || "") : String(e || "");
          console.warn("[analyze] quota_increment_failed", `user=${userId}`, msg);
        }
      }

      const selectorMode = result?.debug?.selected ? "llm_selector" : "heuristic_selector";
      console.log(
        "[analyze] done mode=openai_agents",
        `candidate_cache=${usedCandidateCache ? "hit" : "miss"}`,
        `selector=${selectorMode}`,
        "ms=",
        Date.now() - startedAt
      );
      res.json({
        analysis: result.analysis,
        meta: { mode: "openai_agents", ms: Date.now() - startedAt },
        debug: req.query.debug ? result.debug : undefined
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  };
}
