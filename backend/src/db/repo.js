import crypto from "node:crypto";
import { nowIso, truncate } from "../utils/text.js";
import { getCollections, toObjectId } from "./mongo.js";
import { normalizeUrl, sanitizeJobForStorage, shortlistKeyForJob } from "../utils/url.js";

export const DEFAULT_PROFILE = {
  lookingFor: "",
  strengths: "",
  workHighlights: "",
  mustHaves: "",
  niceToHaves: "",
  avoid: ""
};

export const DEFAULT_SETTINGS = {
  autoShortlistThreshold: 79,
  promptShortlistThreshold: 70,
  autoSaveNearCertain: true,
  autoSaveGreatFit: false,
  autoSavePossibleFit: false
};

const LEGACY_DEFAULT_SETTINGS = {
  autoShortlistThreshold: 90,
  promptShortlistThreshold: 80,
  autoSaveNearCertain: true,
  autoSaveGreatFit: false,
  autoSavePossibleFit: false
};

const CANDIDATE_EXTRACT_CACHE_VERSION = 1;

export function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

export function candidateExtractCacheKey({ profile = {}, resumeText = "", model = "" }) {
  const payload = {
    v: CANDIDATE_EXTRACT_CACHE_VERSION,
    model: String(model || ""),
    profile: {
      lookingFor: String(profile.lookingFor || ""),
      strengths: String(profile.strengths || ""),
      workHighlights: String(profile.workHighlights || ""),
      mustHaves: String(profile.mustHaves || ""),
      niceToHaves: String(profile.niceToHaves || ""),
      avoid: String(profile.avoid || "")
    },
    resumeText: String(resumeText || "")
  };

  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function sanitizeProfile(profile = {}) {
  return {
    lookingFor: truncate(String(profile.lookingFor || ""), 6000),
    strengths: truncate(String(profile.strengths || ""), 6000),
    workHighlights: truncate(String(profile.workHighlights || ""), 12000),
    mustHaves: truncate(String(profile.mustHaves || ""), 6000),
    niceToHaves: truncate(String(profile.niceToHaves || ""), 6000),
    avoid: truncate(String(profile.avoid || ""), 6000)
  };
}

export async function getCandidateExtractCache({ config, userId }) {
  const { userState } = await getCollections(config);
  const oid = toObjectId(userId);
  const doc = await userState.findOne({ userId: oid }, { projection: { candidateExtractCache: 1 } });
  const cache = doc && doc.candidateExtractCache && typeof doc.candidateExtractCache === "object" ? doc.candidateExtractCache : null;
  if (!cache) return null;

  const v = Number(cache.v);
  const key = String(cache.key || "");
  const model = String(cache.model || "");
  const updatedAt = String(cache.updatedAt || "");
  const value = cache.value && typeof cache.value === "object" ? cache.value : null;

  if (!key || !value) return null;
  return { v: Number.isFinite(v) ? v : 0, key, model, updatedAt, value };
}

export async function upsertCandidateExtractCache({ config, userId, key, model, candidateExtract }) {
  const { userState } = await getCollections(config);
  const oid = toObjectId(userId);
  const cacheKey = String(key || "").trim();
  if (!cacheKey) return false;
  if (!candidateExtract || typeof candidateExtract !== "object") return false;

  await userState.updateOne(
    { userId: oid },
    {
      $setOnInsert: {
        userId: oid,
        profile: { ...DEFAULT_PROFILE },
        settings: { ...DEFAULT_SETTINGS },
        resumeText: "",
        createdAt: nowIso()
      },
      $set: {
        candidateExtractCache: {
          v: CANDIDATE_EXTRACT_CACHE_VERSION,
          key: cacheKey,
          model: String(model || ""),
          updatedAt: nowIso(),
          value: candidateExtract
        },
        updatedAt: nowIso()
      }
    },
    { upsert: true }
  );

  return true;
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function isIsoDay(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function serverLocalDayFromMs(epochMs) {
  if (!Number.isFinite(epochMs)) return "";
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayKeyFromTzOffsetMinutesAtMs(epochMs, tzOffsetMinutes) {
  const off = Number(tzOffsetMinutes);
  if (!Number.isFinite(epochMs)) return utcDay();
  if (!Number.isFinite(off) || Math.abs(off) > 14 * 60) return new Date(epochMs).toISOString().slice(0, 10);
  const local = new Date(epochMs - off * 60_000);
  return local.toISOString().slice(0, 10);
}

export function dayKeyFromTzOffsetMinutes(tzOffsetMinutes) {
  const off = Number(tzOffsetMinutes);
  // getTimezoneOffset() is minutes to add to local time to get UTC.
  // localDay = UTC - offsetMinutes.
  if (!Number.isFinite(off) || Math.abs(off) > 14 * 60) return serverLocalDayFromMs(Date.now()) || utcDay();
  const local = new Date(Date.now() - off * 60_000);
  return local.toISOString().slice(0, 10);
}

export async function getDailyAnalyzeQuota({ config, userId, limit, day, tzOffsetMinutes }) {
  const lim = Number(limit);
  const dailyLimit = Number.isFinite(lim) && lim > 0 ? Math.max(1, Math.min(10_000, Math.round(lim))) : 25;
  const dayKey = isIsoDay(day) ? day : dayKeyFromTzOffsetMinutes(tzOffsetMinutes);

  const daily = await getUserDailyAnalyze({ config, userId });
  const used = daily && daily.day === dayKey ? Number(daily.count) || 0 : 0;
  const remaining = Math.max(0, dailyLimit - used);

  return { ok: used < dailyLimit, day: dayKey, limit: dailyLimit, used, remaining };
}

export async function incrementDailyAnalyzeQuota({ config, userId, limit, day, tzOffsetMinutes }) {
  const lim = Number(limit);
  const dailyLimit = Number.isFinite(lim) && lim > 0 ? Math.max(1, Math.min(10_000, Math.round(lim))) : 25;
  const dayKey = isIsoDay(day) ? day : dayKeyFromTzOffsetMinutes(tzOffsetMinutes);

  const { userState } = await getCollections(config);
  const oid = toObjectId(userId);
  const now = nowIso();

  const doc = await userState.findOne({ userId: oid }, { projection: { dailyAnalyze: 1 } });
  const cur = doc && doc.dailyAnalyze && typeof doc.dailyAnalyze === "object" ? doc.dailyAnalyze : null;
  const curDay = String(cur?.day || "");
  const curCount = Number(cur?.count);
  const used = curDay === dayKey && Number.isFinite(curCount) ? Math.max(0, Math.round(curCount)) : 0;

  const nextUsed = curDay === dayKey ? Math.min(dailyLimit, used + 1) : 1;
  const firstAt = curDay === dayKey ? String(cur?.firstAt || now) : now;

  await userState.updateOne(
    { userId: oid },
    {
      $setOnInsert: {
        userId: oid,
        profile: { ...DEFAULT_PROFILE },
        settings: { ...DEFAULT_SETTINGS },
        resumeText: "",
        createdAt: nowIso()
      },
      $set: {
        dailyAnalyze: {
          day: dayKey,
          count: nextUsed,
          firstAt,
          lastAt: now
        },
        updatedAt: now
      }
    },
    { upsert: true }
  );

  return { ok: true, day: dayKey, limit: dailyLimit, used: nextUsed, remaining: Math.max(0, dailyLimit - nextUsed) };
}

function sanitizeSettings(settings = {}) {
  const auto = Number(settings.autoShortlistThreshold);
  const prompt = Number(settings.promptShortlistThreshold);
  const out = {
    autoShortlistThreshold: Number.isFinite(auto) ? Math.max(0, Math.min(100, Math.round(auto))) : DEFAULT_SETTINGS.autoShortlistThreshold,
    promptShortlistThreshold: Number.isFinite(prompt)
      ? Math.max(0, Math.min(100, Math.round(prompt)))
      : DEFAULT_SETTINGS.promptShortlistThreshold,
    autoSaveNearCertain:
      typeof settings.autoSaveNearCertain === "boolean" ? settings.autoSaveNearCertain : DEFAULT_SETTINGS.autoSaveNearCertain,
    autoSaveGreatFit: typeof settings.autoSaveGreatFit === "boolean" ? settings.autoSaveGreatFit : DEFAULT_SETTINGS.autoSaveGreatFit,
    autoSavePossibleFit:
      typeof settings.autoSavePossibleFit === "boolean"
        ? settings.autoSavePossibleFit
        : DEFAULT_SETTINGS.autoSavePossibleFit
  };

  // Migration: if a user still has the old default thresholds, shift them to the new defaults.
  // This avoids surprising behavior after we change the rubric, while preserving customized settings.
  const isLegacyDefault =
    out.autoShortlistThreshold === LEGACY_DEFAULT_SETTINGS.autoShortlistThreshold &&
    out.promptShortlistThreshold === LEGACY_DEFAULT_SETTINGS.promptShortlistThreshold &&
    out.autoSaveNearCertain === LEGACY_DEFAULT_SETTINGS.autoSaveNearCertain &&
    out.autoSaveGreatFit === LEGACY_DEFAULT_SETTINGS.autoSaveGreatFit &&
    out.autoSavePossibleFit === LEGACY_DEFAULT_SETTINGS.autoSavePossibleFit;

  if (isLegacyDefault) {
    return {
      ...out,
      autoShortlistThreshold: DEFAULT_SETTINGS.autoShortlistThreshold,
      promptShortlistThreshold: DEFAULT_SETTINGS.promptShortlistThreshold
    };
  }

  return out;
}

function sanitizeAnalysis(analysis = {}) {
  const score = Number(analysis.score);
  const clampInt = (n, min, max) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return min;
    return Math.max(min, Math.min(max, Math.round(x)));
  };
  const clampFloat = (n, min, max) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return min;
    return Math.max(min, Math.min(max, x));
  };

  const subscoresRaw = analysis.subscores && typeof analysis.subscores === "object" ? analysis.subscores : null;
  const subscores = subscoresRaw
    ? {
        role_intent_match: clampInt(subscoresRaw.role_intent_match, 0, 5),
        responsibilities_match: clampInt(subscoresRaw.responsibilities_match, 0, 5),
        environment_match: clampInt(subscoresRaw.environment_match, 0, 5),
        preference_match: clampInt(subscoresRaw.preference_match, 0, 5),
        seniority_match: clampInt(subscoresRaw.seniority_match, 0, 5),
        confidence: clampInt(subscoresRaw.confidence, 0, 5)
      }
    : undefined;

  const personasRaw = Array.isArray(analysis.personas) ? analysis.personas : [];
  const personas =
    personasRaw.length > 0
      ? personasRaw
          .map((p) => ({
            persona: String(p?.persona || ""),
            label: String(p?.label || ""),
            adjustedScore: clampInt(p?.adjustedScore, 0, 100),
            delta: clampInt(p?.delta, -20, 20),
            notes: Array.isArray(p?.notes) ? p.notes.map((s) => String(s)).filter(Boolean).slice(0, 3) : []
          }))
          .filter((p) => p.persona || p.label)
          .slice(0, 4)
      : undefined;

  const impliedNeedsRaw = Array.isArray(analysis.implied_company_needs) ? analysis.implied_company_needs : [];
  const implied_company_needs =
    impliedNeedsRaw.length > 0
      ? impliedNeedsRaw
          .map((n) => ({
            need: truncate(String(n?.need || ""), 240).trim(),
            confidence: clampFloat(n?.confidence, 0, 1),
            evidence: Array.isArray(n?.evidence) ? n.evidence.map((s) => truncate(String(s || ""), 160)).filter(Boolean).slice(0, 3) : []
          }))
          .filter((n) => n.need)
          .slice(0, 6)
      : undefined;

  const hiddenValueRaw = Array.isArray(analysis.candidate_hidden_value) ? analysis.candidate_hidden_value : [];
  const candidate_hidden_value =
    hiddenValueRaw.length > 0
      ? hiddenValueRaw
          .map((v) => ({
            value: truncate(String(v?.value || ""), 280).trim(),
            maps_to_need: truncate(String(v?.maps_to_need || ""), 240).trim(),
            confidence: clampFloat(v?.confidence, 0, 1),
            evidence: Array.isArray(v?.evidence) ? v.evidence.map((s) => truncate(String(s || ""), 160)).filter(Boolean).slice(0, 4) : []
          }))
          .filter((v) => v.value)
          .slice(0, 6)
      : undefined;

  const questionsRaw = Array.isArray(analysis.questions_to_validate) ? analysis.questions_to_validate : [];
  const questions_to_validate =
    questionsRaw.length > 0
      ? questionsRaw
          .map((q) => truncate(String(q || ""), 260).trim())
          .filter(Boolean)
          .slice(0, 10)
      : undefined;

  const savedViaRaw = String(analysis.saved_via || "").toLowerCase();
  const saved_via = savedViaRaw === "auto" || savedViaRaw === "manual" ? savedViaRaw : undefined;

  return {
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
    label: String(analysis.label || ""),
    summary: truncate(String(analysis.summary || ""), 2000),
    tldr: truncate(String(analysis.tldr || ""), 900),
    resume_or_cover_letter_tip: truncate(String(analysis.resume_or_cover_letter_tip || ""), 900),
    strengths_to_highlight: Array.isArray(analysis.strengths_to_highlight)
      ? analysis.strengths_to_highlight.map((s) => String(s)).filter(Boolean).slice(0, 8)
      : [],
    reasons: Array.isArray(analysis.reasons) ? analysis.reasons.map((s) => String(s)).filter(Boolean).slice(0, 10) : [],
    concerns: Array.isArray(analysis.concerns) ? analysis.concerns.map((s) => String(s)).filter(Boolean).slice(0, 10) : [],
    subscores,
    personas,
    implied_company_needs,
    candidate_hidden_value,
    questions_to_validate,
    saved_via,
    action: analysis.action ? String(analysis.action) : undefined
  };
}

export async function createUser({ config, email, passwordHash }) {
  const { users, userState } = await getCollections(config);
  const doc = {
    email: normalizeEmail(email),
    passwordHash: String(passwordHash || ""),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  const res = await users.insertOne(doc);
  const userId = res.insertedId;

  await userState.updateOne(
    { userId },
    {
      $setOnInsert: {
        userId,
        profile: { ...DEFAULT_PROFILE },
        settings: { ...DEFAULT_SETTINGS },
        resumeText: "",
        createdAt: nowIso()
      },
      $set: { updatedAt: nowIso() }
    },
    { upsert: true }
  );

  return { id: String(userId), email: doc.email };
}

export async function findUserByEmail({ config, email }) {
  const { users } = await getCollections(config);
  const doc = await users.findOne({ email: normalizeEmail(email) });
  if (!doc) return null;
  return { id: String(doc._id), email: String(doc.email || ""), passwordHash: String(doc.passwordHash || "") };
}

export async function getUserState({ config, userId }) {
  const { userState } = await getCollections(config);
  const oid = toObjectId(userId);
  const doc = await userState.findOne({ userId: oid });
  if (!doc) {
    return { profile: { ...DEFAULT_PROFILE }, settings: { ...DEFAULT_SETTINGS }, resumeText: "", shortlistCount: 0 };
  }
  return {
    profile: sanitizeProfile(doc.profile || {}),
    settings: sanitizeSettings(doc.settings || {}),
    resumeText: String(doc.resumeText || ""),
    shortlistCount: 0
  };
}

export async function getUserDailyAnalyze({ config, userId }) {
  const { userState } = await getCollections(config);
  const oid = toObjectId(userId);
  const doc = await userState.findOne({ userId: oid }, { projection: { dailyAnalyze: 1 } });
  const raw = doc && doc.dailyAnalyze && typeof doc.dailyAnalyze === "object" ? doc.dailyAnalyze : null;
  if (!raw) return null;

  const day = String(raw.day || "");
  const countRaw = raw.count;
  const count = Number(countRaw);
  const firstAt = String(raw.firstAt || "");
  const lastAt = String(raw.lastAt || "");

  const normalizedCount = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
  // Self-repair: older versions accidentally stored `dailyAnalyze.count` as a string, which can break numeric comparisons.
  if (typeof countRaw !== "number") {
    try {
      await userState.updateOne(
        { userId: oid },
        { $set: { "dailyAnalyze.count": normalizedCount, updatedAt: nowIso() } }
      );
    } catch {
      // Best-effort; do not fail the request if repair fails.
    }
  }

  return {
    day,
    count: normalizedCount,
    firstAt,
    lastAt
  };
}

export async function resetUserDailyAnalyze({ config, userId }) {
  const { userState } = await getCollections(config);
  const oid = toObjectId(userId);
  await userState.updateOne({ userId: oid }, { $unset: { dailyAnalyze: "" }, $set: { updatedAt: nowIso() } });
  return true;
}

export async function updateUserState({ config, userId, profile, settings, resumeText }) {
  const { userState } = await getCollections(config);
  const oid = toObjectId(userId);

  const update = { updatedAt: nowIso() };
  if (profile) update.profile = sanitizeProfile(profile);
  if (settings) update.settings = sanitizeSettings(settings);
  if (typeof resumeText === "string") update.resumeText = truncate(resumeText, 26000);

  const setOnInsert = { userId: oid, createdAt: nowIso() };
  // Avoid Mongo update-path conflicts (cannot set the same path in $set and $setOnInsert).
  if (!profile) setOnInsert.profile = { ...DEFAULT_PROFILE };
  if (!settings) setOnInsert.settings = { ...DEFAULT_SETTINGS };
  if (typeof resumeText !== "string") setOnInsert.resumeText = "";

  await userState.updateOne(
    { userId: oid },
    {
      $setOnInsert: setOnInsert,
      $set: update
    },
    { upsert: true }
  );

  return true;
}

export async function listShortlistItems({ config, userId, limit = 500 }) {
  const { shortlistItems } = await getCollections(config);
  const oid = toObjectId(userId);
  const cursor = shortlistItems.find({ userId: oid }).sort({ savedAt: -1 }).limit(Math.max(1, Math.min(1000, limit)));
  const items = await cursor.toArray();
  return items.map((d) => ({
    key: String(d.key || ""),
    savedAt: String(d.savedAt || ""),
    job: d.job || {},
    analysis: d.analysis || {}
  }));
}

export async function upsertShortlistItem({ config, userId, item }) {
  const { shortlistItems } = await getCollections(config);
  const oid = toObjectId(userId);
  const rawJob = item?.job || {};

  const key = String(item?.key || shortlistKeyForJob(rawJob));
  const savedAt = String(item?.savedAt || nowIso());
  const job = sanitizeJobForStorage(rawJob);
  const analysis = sanitizeAnalysis(item?.analysis || {});

  await shortlistItems.updateOne(
    { userId: oid, key },
    {
      $set: {
        userId: oid,
        key,
        savedAt,
        url: normalizeUrl(job.url || ""),
        job,
        analysis,
        updatedAt: nowIso()
      },
      $setOnInsert: { createdAt: nowIso() }
    },
    { upsert: true }
  );

  return { key };
}

export async function deleteShortlistItem({ config, userId, key }) {
  const { shortlistItems } = await getCollections(config);
  const oid = toObjectId(userId);
  await shortlistItems.deleteOne({ userId: oid, key: String(key || "") });
  return true;
}

export async function clearShortlist({ config, userId }) {
  const { shortlistItems } = await getCollections(config);
  const oid = toObjectId(userId);
  await shortlistItems.deleteMany({ userId: oid });
  return true;
}

export async function getShortlistCount({ config, userId }) {
  const { shortlistItems } = await getCollections(config);
  const oid = toObjectId(userId);
  return shortlistItems.countDocuments({ userId: oid });
}
