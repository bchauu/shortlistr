const STORAGE_KEYS = {
  profile: "shortlistr_profile",
  settings: "shortlistr_settings",
  backend: "shortlistr_backend",
  resumeText: "shortlistr_resume_text",
  shortlist: "shortlistr_shortlist",
  cache: "shortlistr_cache",
  enabledSites: "shortlistr_enabled_sites"
};

// Your hosted API (Render, etc). Users should never need to configure this.
// For local dev, keep `http://localhost:8787`.
const FIXED_API_BASE_URL = "http://localhost:8787";

const LOCAL_JOB_DESC_MAX = 4000;
const REMOTE_JOB_DESC_MAX = 16000;
const CACHE_VERSION = 6;

const DEFAULT_SETTINGS = {
  autoShortlistThreshold: 79,
  promptShortlistThreshold: 70,
  autoSaveNearCertain: true,
  autoSaveGreatFit: false,
  autoSavePossibleFit: false
};

const DEFAULT_PROFILE = {
  lookingFor: "",
  strengths: "",
  workHighlights: "",
  mustHaves: "",
  niceToHaves: "",
  avoid: ""
};

const DEFAULT_BACKEND = {
  enabled: true,
  apiBaseUrl: FIXED_API_BASE_URL,
  apiToken: "",
  model: ""
};

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

function storageRemove(keys) {
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}

function scriptingGetRegisteredContentScripts() {
  return new Promise((resolve, reject) => {
    if (!chrome?.scripting?.getRegisteredContentScripts) {
      reject(new Error("Missing Chrome scripting permission."));
      return;
    }
    chrome.scripting.getRegisteredContentScripts((scripts) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(Array.isArray(scripts) ? scripts : []);
    });
  });
}

function scriptingRegisterContentScripts(scripts) {
  return new Promise((resolve, reject) => {
    if (!chrome?.scripting?.registerContentScripts) {
      reject(new Error("Missing Chrome scripting permission."));
      return;
    }
    chrome.scripting.registerContentScripts(scripts, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve();
    });
  });
}

function scriptingUnregisterContentScripts({ ids } = {}) {
  return new Promise((resolve, reject) => {
    if (!chrome?.scripting?.unregisterContentScripts) {
      reject(new Error("Missing Chrome scripting permission."));
      return;
    }
    chrome.scripting.unregisterContentScripts(ids ? { ids } : {}, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve();
    });
  });
}

function insertCssFilesInTab(tabId, files) {
  return new Promise((resolve, reject) => {
    if (!chrome?.scripting?.insertCSS) {
      reject(new Error("Missing Chrome scripting permission."));
      return;
    }
    chrome.scripting.insertCSS({ target: { tabId }, files }, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve();
    });
  });
}

function executeScriptFilesInTab(tabId, files) {
  return new Promise((resolve, reject) => {
    if (!chrome?.scripting?.executeScript) {
      reject(new Error("Missing Chrome scripting permission."));
      return;
    }
    chrome.scripting.executeScript({ target: { tabId }, files }, (results) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(results);
    });
  });
}

function nowIso() {
  return new Date().toISOString();
}

async function clearBackendToken() {
  const current = (await getState()).backend;
  await storageSet({ [STORAGE_KEYS.backend]: { ...current, apiToken: "" } });
}

function truncateText(s, maxLen) {
  const t = String(s || "");
  if (!maxLen || t.length <= maxLen) return t;
  return t.slice(0, maxLen) + "\n\n[truncated]";
}

function sanitizeJobForStorage(job, maxDescLen) {
  const storedJob = { ...(job || {}), url: normalizeUrl((job && job.url) || "") };
  if (storedJob.descriptionCandidates) delete storedJob.descriptionCandidates;
  if (typeof storedJob.description === "string" && storedJob.description.length > maxDescLen) {
    storedJob.description = truncateText(storedJob.description, maxDescLen);
  }
  return storedJob;
}

function sanitizeShortlistItemForLocal(item) {
  if (!item || typeof item !== "object") return null;
  const key = String(item.key || "");
  if (!key) return null;
  const savedAt = String(item.savedAt || "");
  const job = sanitizeJobForStorage(item.job || {}, LOCAL_JOB_DESC_MAX);
  const analysis = item.analysis && typeof item.analysis === "object" ? item.analysis : {};
  return { key, savedAt, job, analysis };
}

function sanitizeShortlistForLocal(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const it of list) {
    const s = sanitizeShortlistItemForLocal(it);
    if (s) out.push(s);
  }
  return out;
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    const dropParams = [
      "trk",
      "trkInfo",
      "refId",
      "refId",
      "referenceId",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "lipi"
    ];
    for (const p of dropParams) u.searchParams.delete(p);
    u.searchParams.sort();
    return u.toString();
  } catch {
    return url;
  }
}

function normalizeOriginPattern(originPattern) {
  const s = String(originPattern || "").trim();
  if (!s) return "";
  if (s.endsWith("/*")) return s;
  if (s.endsWith("/")) return s + "*";
  return s + "/*";
}

function siteScriptId(originPattern) {
  return `shortlistr_site_${String(originPattern || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120)}`;
}

async function getEnabledSites() {
  const data = await storageGet([STORAGE_KEYS.enabledSites]);
  const sites = Array.isArray(data[STORAGE_KEYS.enabledSites]) ? data[STORAGE_KEYS.enabledSites] : [];
  return sites.map((s) => normalizeOriginPattern(s)).filter(Boolean);
}

async function setEnabledSites(sites) {
  const list = Array.from(new Set((Array.isArray(sites) ? sites : []).map((s) => normalizeOriginPattern(s)).filter(Boolean)));
  await storageSet({ [STORAGE_KEYS.enabledSites]: list });
  return list;
}

function buildSiteContentScript(originPattern) {
  const normalized = normalizeOriginPattern(originPattern);
  const id = siteScriptId(normalized);
  return {
    id,
    matches: [normalized],
    js: ["src/content/shortlistr.js"],
    css: ["src/content/shortlistr.css"],
    runAt: "document_idle",
    persistAcrossSessions: true
  };
}

async function registerSiteContentScript(originPattern) {
  const script = buildSiteContentScript(originPattern);
  await scriptingUnregisterContentScripts({ ids: [script.id] }).catch(() => {});
  await scriptingRegisterContentScripts([script]);
  return script;
}

async function unregisterSiteContentScript(originPattern) {
  const id = siteScriptId(normalizeOriginPattern(originPattern));
  await scriptingUnregisterContentScripts({ ids: [id] }).catch(() => {});
}

async function injectShortlistrIntoTab(tabId) {
  await insertCssFilesInTab(tabId, ["src/content/shortlistr.css"]);
  await executeScriptFilesInTab(tabId, ["src/content/shortlistr.js"]);
}

async function ensureEnabledSiteContentScriptsRegistered() {
  const sites = await getEnabledSites();
  if (sites.length === 0) return;

  let registered = [];
  try {
    registered = await scriptingGetRegisteredContentScripts();
  } catch {
    registered = [];
  }
  const existing = new Set(registered.map((s) => String(s?.id || "")));

  const toRegister = [];
  for (const originPattern of sites) {
    const script = buildSiteContentScript(originPattern);
    if (existing.has(script.id)) continue;
    toRegister.push(script);
  }

  if (toRegister.length > 0) await scriptingRegisterContentScripts(toRegister);
}

function executeScriptInTab(tabId, func, args) {
  return new Promise((resolve, reject) => {
    if (!chrome?.scripting?.executeScript) {
      reject(new Error("Missing Chrome scripting permission."));
      return;
    }

    chrome.scripting.executeScript({ target: { tabId }, func, args }, (results) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      if (!Array.isArray(results) || results.length < 1) {
        reject(new Error("No script result."));
        return;
      }
      resolve(results[0]?.result);
    });
  });
}

function extractJobFromDom() {
  function normalizeSpace(s) {
    return String(s || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function truncate(s, maxLen) {
    const t = String(s || "");
    if (!maxLen || t.length <= maxLen) return t;
    return t.slice(0, maxLen) + "\n\n[truncated]";
  }

  function firstText(selectors) {
    for (const sel of selectors || []) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const t = normalizeSpace(el.innerText || el.textContent || "");
      if (t) return t;
    }
    return "";
  }

  function metaContent(selectors) {
    for (const sel of selectors || []) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const c = String(el.getAttribute("content") || "").trim();
      if (c) return c;
    }
    return "";
  }

  function stripHtmlTags(s) {
    return String(s || "").replace(/<[^>]*>/g, " ");
  }

  function collectJobPostingNodes(node, out) {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const v of node) collectJobPostingNodes(v, out);
      return;
    }
    if (typeof node !== "object") return;

    const t = node["@type"];
    const types = Array.isArray(t) ? t : t ? [t] : [];
    if (types.some((x) => String(x).toLowerCase() === "jobposting")) out.push(node);

    if (node["@graph"]) collectJobPostingNodes(node["@graph"], out);
    for (const k of Object.keys(node)) {
      if (k === "@type" || k === "@context") continue;
      collectJobPostingNodes(node[k], out);
    }
  }

  function extractJsonLdJobPosting() {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    const jobs = [];
    for (const s of scripts) {
      const raw = (s.textContent || "").trim();
      if (!raw) continue;
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        continue;
      }
      collectJobPostingNodes(data, jobs);
    }

    if (!jobs.length) return { text: "", title: "", company: "", location: "" };

    function pickLocation(j) {
      const loc = j.jobLocation;
      const first = Array.isArray(loc) ? loc[0] : loc;
      const addr = first?.address || first?.jobLocation?.address || first;
      const locality = addr?.addressLocality || "";
      const region = addr?.addressRegion || "";
      const country = addr?.addressCountry || "";
      const parts = [locality, region, country].map((x) => String(x || "").trim()).filter(Boolean);
      return parts.join(", ");
    }

    const parts = [];
    let topTitle = "";
    let topCompany = "";
    let topLocation = "";

    for (const j of jobs.slice(0, 3)) {
      const title = j.title || j.name || "";
      const company = j.hiringOrganization?.name || "";
      const location = pickLocation(j);
      const desc = stripHtmlTags(j.description || j.articleBody || "");
      const responsibilities = Array.isArray(j.responsibilities) ? j.responsibilities.join("\n") : j.responsibilities || "";
      const qualifications = Array.isArray(j.qualifications) ? j.qualifications.join("\n") : j.qualifications || "";

      if (!topTitle && title) topTitle = String(title);
      if (!topCompany && company) topCompany = String(company);
      if (!topLocation && location) topLocation = String(location);

      const block = normalizeSpace(
        [
          title ? `Title: ${title}` : "",
          company ? `Company: ${company}` : "",
          location ? `Location: ${location}` : "",
          desc ? `Description:\n${desc}` : "",
          responsibilities ? `Responsibilities:\n${stripHtmlTags(responsibilities)}` : "",
          qualifications ? `Qualifications:\n${stripHtmlTags(qualifications)}` : ""
        ]
          .filter(Boolean)
          .join("\n\n")
      );
      if (block) parts.push(block);
    }

    return { text: parts.join("\n\n----\n\n"), title: topTitle, company: topCompany, location: topLocation };
  }

  const url = location.href;
  const hostname = (() => {
    try {
      return new URL(url).hostname || "";
    } catch {
      return "";
    }
  })();

  const jsonLd = extractJsonLdJobPosting();

  const baseTitle = firstText(["h1"]) || document.title || "";
  const baseCompany =
    metaContent(["meta[property='og:site_name']", "meta[name='application-name']", "meta[name='apple-mobile-web-app-title']"]) ||
    hostname;

  const candidates = [];
  const seen = new Set();

  function addCandidate(label, source, selector, text, priority) {
    const cleaned = normalizeSpace(text);
    if (!cleaned) return;
    const lower = cleaned.toLowerCase();
    const head = lower.slice(0, 220);
    const tail = lower.slice(Math.max(0, lower.length - 220));
    const key = `${head}|${tail}|${lower.length}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      id: `${source}:${selector || "na"}:${candidates.length}`,
      label: String(label || ""),
      source: String(source || ""),
      selector: selector ? String(selector) : "",
      text: truncate(cleaned, 9000),
      priority: Number(priority) || 0
    });
  }

  if (jsonLd.text) addCandidate("JSON-LD JobPosting", "jsonld", 'script[type=\"application/ld+json\"]', jsonLd.text, 5);

  const pageMetaDesc = metaContent(["meta[name='description']", "meta[property='og:description']", "meta[name='twitter:description']"]);
  if (pageMetaDesc) addCandidate("Page meta description", "meta", "meta", pageMetaDesc, 1);

  const main = document.querySelector("main");
  if (main) addCandidate("Main content", "main", "main", main.innerText || main.textContent || "", 2);
  const article = document.querySelector("article");
  if (article) addCandidate("Article content", "article", "article", article.innerText || article.textContent || "", 2);
  const bodyText = document.body ? document.body.innerText : "";
  if (bodyText) addCandidate("Body text", "body", "body", bodyText, 1);

  candidates.sort((a, b) => b.priority - a.priority || b.text.length - a.text.length);
  const bestCandidates = candidates.slice(0, 6).map(({ priority, ...c }) => c);
  const bestDescription = bestCandidates.length ? bestCandidates[0].text : "";

  return {
    source: "generic",
    url,
    title: truncate(jsonLd.title || baseTitle, 200),
    company: truncate(jsonLd.company || baseCompany, 200),
    location: truncate(jsonLd.location || "", 200),
    description: truncate(bestDescription, 12000),
    descriptionCandidates: bestCandidates
  };
}

async function extractJobFromTab(tabId) {
  try {
    const job = await executeScriptInTab(tabId, extractJobFromDom, []);
    if (!job || typeof job !== "object") throw new Error("Page extract returned no data.");
    return job;
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e ? String(e.message || "") : String(e || "");
    if (/chrome:\/\//i.test(msg)) {
      throw new Error("Chrome blocks extensions from analyzing internal pages (chrome://). Try a normal website tab.");
    }
    if (/extensions gallery|chrome web store/i.test(msg)) {
      throw new Error("Chrome blocks extensions from analyzing the Chrome Web Store. Try a normal website tab.");
    }
    if (/Cannot access contents of the page|cannot be scripted|not permitted/i.test(msg)) {
      throw new Error("Can’t analyze this page (Chrome blocked script access). Try a different website.");
    }
    throw new Error(msg || "Failed to read page content.");
  }
}

// Best-effort: re-register enabled site scripts when the service worker starts.
void ensureEnabledSiteContentScriptsRegistered().catch(() => {});

async function getState() {
  const data = await storageGet([
    STORAGE_KEYS.profile,
    STORAGE_KEYS.settings,
    STORAGE_KEYS.backend,
    STORAGE_KEYS.resumeText,
    STORAGE_KEYS.shortlist,
    STORAGE_KEYS.cache
  ]);

  const profile = { ...DEFAULT_PROFILE, ...(data[STORAGE_KEYS.profile] || {}) };
  const settings = { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.settings] || {}) };
  const backend = { ...DEFAULT_BACKEND, ...(data[STORAGE_KEYS.backend] || {}) };
  backend.enabled = true;
  backend.apiBaseUrl = FIXED_API_BASE_URL;
  backend.model = "";
  const resumeText = typeof data[STORAGE_KEYS.resumeText] === "string" ? data[STORAGE_KEYS.resumeText] : "";
  const shortlist = Array.isArray(data[STORAGE_KEYS.shortlist]) ? data[STORAGE_KEYS.shortlist] : [];
  const cache = data[STORAGE_KEYS.cache] && typeof data[STORAGE_KEYS.cache] === "object" ? data[STORAGE_KEYS.cache] : {};

  return { profile, settings, backend, resumeText, shortlist, cache };
}

function scoreToLabel(score) {
  if (score >= 95) return "Bullseye";
  if (score >= 87) return "Very strong";
  if (score >= 79) return "Good shot";
  if (score >= 70) return "Modest odds";
  if (score >= 65) return "Long-shot";
  return "Probably no";
}

function actionForScore(score, settings) {
  const autoThreshold = Number(settings.autoShortlistThreshold);
  const promptThreshold = Number(settings.promptShortlistThreshold);

  const nearCertainMin = Number.isFinite(autoThreshold) ? autoThreshold : 90;
  const greatMin = Number.isFinite(promptThreshold) ? promptThreshold : 80;
  const possibleMin = 65;

  const autoNear = settings && typeof settings.autoSaveNearCertain === "boolean" ? settings.autoSaveNearCertain : true;
  const autoGreat = settings && typeof settings.autoSaveGreatFit === "boolean" ? settings.autoSaveGreatFit : false;
  const autoPossible = settings && typeof settings.autoSavePossibleFit === "boolean" ? settings.autoSavePossibleFit : false;

  if (score >= nearCertainMin) return autoNear ? "auto_shortlist" : "prompt_shortlist";
  if (score >= greatMin) return autoGreat ? "auto_shortlist" : "prompt_shortlist";
  if (score >= possibleMin) return autoPossible ? "auto_shortlist" : "skip";
  return "skip";
}

async function analyzeWithHeuristics(job, profile) {
  const jobText = `${job.title || ""}\n${job.company || ""}\n${job.location || ""}\n\n${job.description || ""}`.toLowerCase();
  const wantText =
    `${profile.lookingFor || ""}\n${profile.strengths || ""}\n${profile.workHighlights || ""}\n${profile.mustHaves || ""}\n${profile.niceToHaves || ""}`.toLowerCase();
  const avoidText = (profile.avoid || "").toLowerCase();

  const wantConsulting = /(consult|transformation|change management|adoption)/i.test(wantText);
  const consultingSignals = [
    /\b(mckinsey|bain|boston consulting group|bcg|oliver wyman|accenture|deloitte|pwc|pricewaterhousecoopers|ey|ernst\s*&\s*young)\b/i,
    /\b(top[- ]tier consulting|global consultanc|enterprise transformation|strategic consulting)\b/i,
    /\b(change management|behavior change|stakeholder buy[- ]?in|adoption|enablement)\b/i
  ];
  let consultingHits = 0;
  for (const re of consultingSignals) {
    if (re.test(jobText)) consultingHits += 1;
  }

  const tokens = new Set(
    wantText
      .split(/[^a-z0-9+.#-]+/g)
      .filter((t) => t.length >= 3 && t.length <= 30)
  );

  const avoidTokens = new Set(
    avoidText
      .split(/[^a-z0-9+.#-]+/g)
      .filter((t) => t.length >= 3 && t.length <= 30)
  );

  let hits = 0;
  for (const t of tokens) {
    if (jobText.includes(t)) hits += 1;
  }

  let avoidHits = 0;
  for (const t of avoidTokens) {
    if (jobText.includes(t)) avoidHits += 1;
  }

  // Fuzzy-role decoding hints (very lightweight)
  const fuzzyBoostTerms = [
    "forward deployed",
    "solutions engineer",
    "sales engineer",
    "customer engineer",
    "applied ai",
    "applied ml",
    "ml",
    "machine learning",
    "llm",
    "llms",
    "genai",
    "generative ai",
    "agent",
    "agents",
    "ai engineer"
  ];

  let fuzzyBoost = 0;
  for (const t of fuzzyBoostTerms) {
    if (jobText.includes(t)) fuzzyBoost += 1;
  }

  const consultingPenalty = wantConsulting ? 0 : Math.min(40, consultingHits * 14);
  const base =
    Math.min(75, hits * 6) + Math.min(15, fuzzyBoost * 3) - Math.min(30, avoidHits * 10) - consultingPenalty;
  const score = Math.max(0, Math.min(100, Math.round(base)));

  const reasons = [];
  if (hits > 0) reasons.push(`Matches ${hits} preference keyword${hits === 1 ? "" : "s"} you listed.`);
  if (fuzzyBoost > 0) reasons.push("Detected fuzzy role language; scored using broader signals.");
  if (consultingHits > 0 && !wantConsulting)
    reasons.push("Detected consulting/transformation signals; penalized due to your target profile.");
  if (avoidHits > 0) reasons.push(`Includes ${avoidHits} avoid keyword${avoidHits === 1 ? "" : "s"} you listed.`);

  return {
    score,
    label: scoreToLabel(score),
    summary:
      score >= 95
        ? "Bullseye on keyword match. Still sanity-check the actual responsibilities."
        : score >= 87
          ? "Very strong keyword match. Worth a close read and a quick apply."
          : score >= 79
            ? "Good shot based on keyword match. Verify responsibilities and any hard constraints."
            : score >= 70
              ? "Modest odds based on keyword match. Apply if you like it and can tell a strong story."
              : score >= 65
                ? "Long-shot based on keyword match. Save/apply only if you love the company or domain."
                : "Probably no based on keyword match. Not enough alignment signal to recommend.",
    strengths_to_highlight: (profile.strengths || "")
      .split(/\n+/g)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5),
    reasons,
    concerns: [
      ...(avoidHits > 0 ? ["May conflict with your avoid list."] : []),
      ...(consultingHits > 0 && !wantConsulting ? ["May be more consulting/transformation than hands-on engineering."] : [])
    ]
  };
}

function normalizeApiBaseUrl(apiBaseUrl) {
  const s = String(apiBaseUrl || "").trim();
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function backendIsAuthed(backend) {
  return Boolean(backend && backend.apiToken);
}

async function backendJson(backend, path, { method = "GET", body } = {}) {
  const base = normalizeApiBaseUrl(backend.apiBaseUrl);
  const url = `${base}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (backend.apiToken) headers.Authorization = `Bearer ${backend.apiToken}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  if (res.status === 401) {
    await clearBackendToken();
    throw new Error("Session expired. Please sign in again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data && typeof data === "object" && typeof data.error === "string" ? data.error : "Request failed.";
    throw new Error(`Backend ${path} failed (${res.status}): ${msg}`);
  }
  return data;
}

async function authWithBackend(backend, mode, email, password) {
  const base = normalizeApiBaseUrl(backend.apiBaseUrl);
  const url = `${base}/v1/auth/${mode}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data && typeof data === "object" && typeof data.error === "string" ? data.error : "Auth failed.";
    throw new Error(msg);
  }

  const token = data && typeof data === "object" ? String(data.token || "") : "";
  if (!token) throw new Error("Auth response missing token.");
  return { token, user: data.user || null };
}

async function pullStateFromBackend(backend) {
  const tzOffsetMinutes = new Date().getTimezoneOffset();
  const data = await backendJson(backend, `/v1/state?tzOffsetMinutes=${encodeURIComponent(String(tzOffsetMinutes))}`);
  if (!data || typeof data !== "object") throw new Error("Backend state response invalid.");
  const quotaRaw = data.quota && typeof data.quota === "object" ? data.quota : null;
  const quota = quotaRaw
    ? {
        day: String(quotaRaw.day || ""),
        used: Number(quotaRaw.used) || 0,
        limit: Number(quotaRaw.limit) || 0,
        remaining: Number(quotaRaw.remaining) || 0,
        resetAt: String(quotaRaw.resetAt || ""),
        firstAt: String(quotaRaw.firstAt || ""),
        lastAt: String(quotaRaw.lastAt || "")
      }
    : null;
  return {
    profile: data.profile || {},
    settings: data.settings || {},
    resumeText: String(data.resumeText || ""),
    shortlistCount: Number(data.shortlistCount) || 0,
    quota
  };
}

async function pushStateToBackend(backend, { profile, settings, resumeText }) {
  await backendJson(backend, "/v1/state", { method: "PUT", body: { profile, settings, resumeText } });
}

async function pullShortlistFromBackend(backend) {
  const data = await backendJson(backend, "/v1/shortlist");
  const shortlist = data && typeof data === "object" ? data.shortlist : null;
  if (!Array.isArray(shortlist)) throw new Error("Backend shortlist response invalid.");
  return shortlist;
}

async function upsertShortlistToBackend(backend, item) {
  await backendJson(backend, "/v1/shortlist/upsert", { method: "POST", body: { item } });
}

async function deleteShortlistFromBackend(backend, key) {
  await backendJson(backend, "/v1/shortlist/delete", { method: "POST", body: { key } });
}

async function clearShortlistOnBackend(backend) {
  await backendJson(backend, "/v1/shortlist/clear", { method: "POST", body: {} });
}

async function analyzeWithBackend(job, backend) {
  const base = normalizeApiBaseUrl(backend.apiBaseUrl);
  const url = `${base}/v1/analyze`;
  const headers = { "Content-Type": "application/json" };
  if (backend.apiToken) headers.Authorization = `Bearer ${backend.apiToken}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ job, tzOffsetMinutes: new Date().getTimezoneOffset() })
  });

  if (res.status === 401) {
    await clearBackendToken();
    throw new Error("Session expired. Please sign in again.");
  }

  if (!res.ok) {
    let msg = "";
    const ct = String(res.headers.get("content-type") || "");
    if (ct.includes("application/json")) {
      const data = await res.json().catch(() => null);
      if (data && typeof data === "object" && typeof data.error === "string") msg = data.error;
    }
    if (!msg) msg = (await res.text().catch(() => "")) || "";
    msg = String(msg || "").trim();

    // Some environments return JSON as text; try to unwrap {"error": "..."}.
    if (msg && msg.startsWith("{") && msg.includes("\"error\"")) {
      try {
        const parsed = JSON.parse(msg);
        if (parsed && typeof parsed === "object" && typeof parsed.error === "string") {
          const errMsg = String(parsed.error || "").trim();
          if (errMsg) msg = errMsg;
        }
      } catch {
        // ignore
      }
    }

    // Make quota errors user-friendly.
    if (res.status === 429 && /daily limit/i.test(msg)) {
      throw new Error(msg || "Daily limit hit. Try again tomorrow.");
    }

    throw new Error(`Backend analyze failed (${res.status}): ${(msg || "Request failed.").slice(0, 200)}`);
  }

  const data = await res.json().catch(() => null);
  const analysis = data && typeof data === "object" ? data.analysis : null;
  if (!analysis || typeof analysis !== "object") throw new Error("Backend response missing analysis.");

  const score = Number(analysis.score);
  if (!Number.isFinite(score)) throw new Error("Backend analysis missing numeric score.");

  const subscores =
    analysis.subscores && typeof analysis.subscores === "object" ? analysis.subscores : undefined;

  const personas = Array.isArray(analysis.personas)
    ? analysis.personas
        .map((p) => ({
          persona: String(p?.persona || ""),
          label: String(p?.label || ""),
          adjustedScore: Number(p?.adjustedScore),
          delta: Number(p?.delta),
          notes: Array.isArray(p?.notes) ? p.notes.map((s) => String(s)).filter(Boolean).slice(0, 3) : []
        }))
        .filter((p) => (p.persona || p.label) && Number.isFinite(p.adjustedScore))
        .slice(0, 4)
    : [];

  const implied_company_needs = Array.isArray(analysis.implied_company_needs)
    ? analysis.implied_company_needs
        .map((n) => ({
          need: String(n?.need || "").trim(),
          confidence: Number(n?.confidence),
          evidence: Array.isArray(n?.evidence) ? n.evidence.map((s) => String(s)).filter(Boolean).slice(0, 3) : []
        }))
        .filter((n) => n.need)
        .slice(0, 6)
    : [];

  const candidate_hidden_value = Array.isArray(analysis.candidate_hidden_value)
    ? analysis.candidate_hidden_value
        .map((v) => ({
          value: String(v?.value || "").trim(),
          maps_to_need: String(v?.maps_to_need || "").trim(),
          confidence: Number(v?.confidence),
          evidence: Array.isArray(v?.evidence) ? v.evidence.map((s) => String(s)).filter(Boolean).slice(0, 4) : []
        }))
        .filter((v) => v.value)
        .slice(0, 6)
    : [];

  const questions_to_validate = Array.isArray(analysis.questions_to_validate)
    ? analysis.questions_to_validate.map((q) => String(q)).filter(Boolean).slice(0, 10)
    : [];

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    label: String(analysis.label || scoreToLabel(score)).trim(),
    summary: String(analysis.summary || "").trim(),
    tldr: String(analysis.tldr || "").trim(),
    resume_or_cover_letter_tip: String(analysis.resume_or_cover_letter_tip || "").trim(),
    strengths_to_highlight: Array.isArray(analysis.strengths_to_highlight)
      ? analysis.strengths_to_highlight.map((s) => String(s)).filter(Boolean).slice(0, 8)
      : [],
    reasons: Array.isArray(analysis.reasons) ? analysis.reasons.map((s) => String(s)).filter(Boolean).slice(0, 10) : [],
    concerns: Array.isArray(analysis.concerns) ? analysis.concerns.map((s) => String(s)).filter(Boolean).slice(0, 10) : [],
    subscores,
    personas,
    implied_company_needs,
    candidate_hidden_value,
    questions_to_validate
  };
}

async function extractResumeWithBackend(bytes, fileName, mimeType, backend) {
  const base = normalizeApiBaseUrl(backend.apiBaseUrl);
  const url = `${base}/v1/resume/extract`;
  const headers = {};
  if (backend.apiToken) headers.Authorization = `Bearer ${backend.apiToken}`;

  const form = new FormData();
  const blob = new Blob([bytes], { type: mimeType || "application/octet-stream" });
  form.append("file", blob, fileName || "resume");

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: form
  });

  if (res.status === 401) {
    await clearBackendToken();
    throw new Error("Session expired. Please sign in again.");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Backend resume extract failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json().catch(() => null);
  const text = data && typeof data === "object" ? data.text : "";
  return String(text || "");
}

function shortlistKeyForJob(job) {
  const url = normalizeUrl(job.url || "");
  return url || `${job.source || "unknown"}:${job.title || ""}:${job.company || ""}`.slice(0, 300);
}

function linkedInJobIdFromUrl(u) {
  const path = String(u.pathname || "").toLowerCase();
  const m = path.match(/\/jobs\/view\/(\d+)/);
  if (m && m[1]) return m[1];

  const knownKeys = new Set(["currentjobid", "selectedjobid", "viewjobid", "jobid", "jobpostingid", "jobpostid"]);
  let genericJobId = "";
  for (const [name, value] of u.searchParams.entries()) {
    const key = String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const v = String(value || "").trim();
    if (!v || v.length > 120) continue;
    if (knownKeys.has(key)) return v;
    if (!genericJobId && key.includes("job") && key.includes("id")) genericJobId = v;
  }

  return genericJobId;
}

function analysisCacheKeyForJob(job) {
  const url = normalizeUrl(job.url || "");
  const source = String(job.source || "").toLowerCase();
  if (!url) return "";

  try {
    const u = new URL(url);
    const path = String(u.pathname || "").toLowerCase();
    const segs = path.split("/").filter(Boolean);

    if (source === "linkedin") {
      const id = linkedInJobIdFromUrl(u);
      if (id) return `linkedin:${id}`;
      return `linkedin:${u.origin}${u.pathname}`;
    }

    if (source === "lever") {
      const id = String(segs[1] || "");
      if (id) return `lever:${id}`;
      return `lever:${u.origin}${u.pathname}`;
    }

    if (source === "x") {
      const idx = segs.indexOf("status");
      const id = idx >= 0 ? String(segs[idx + 1] || "") : "";
      if (id) return `x:${id}`;
      return `x:${u.origin}${u.pathname}`;
    }

    if (source === "wellfound" || source === "otta") {
      const idx = segs.indexOf("jobs");
      const id = idx >= 0 ? String(segs[idx + 1] || "") : "";
      if (id) return `${source}:${id}`;
      return `${source}:${u.origin}${u.pathname}`;
    }

    if (source === "ashby") {
      const id = String(segs[1] || "");
      if (id) return `ashby:${id}`;
      return `ashby:${u.origin}${u.pathname}`;
    }

    if (source === "greenhouse") {
      const idx = segs.indexOf("jobs");
      const id = idx >= 0 ? String(segs[idx + 1] || "") : "";
      if (id) return `greenhouse:${id}`;
      return `greenhouse:${u.origin}${u.pathname}`;
    }

    if (source === "workday") {
      const idx = segs.indexOf("job");
      const id = idx >= 0 ? String(segs[segs.length - 1] || "") : "";
      if (id) return `workday:${u.hostname}:${id}`;
      return `workday:${u.origin}${u.pathname}`;
    }

    if (source === "ultipro") {
      const id = u.searchParams.get("opportunityId") || u.searchParams.get("opportunityid") || "";
      if (id) return `ultipro:${id}`;
      return `ultipro:${u.origin}${u.pathname}`;
    }

    // Default: keep query in the key (normalizeUrl already strips common tracking params).
    return `${source || "url"}:${u.toString()}`;
  } catch {
    return `${source || "url"}:${url}`;
  }
}

async function upsertShortlistItem(job, analysis) {
  const state = await getState();
  const key = shortlistKeyForJob(job);
  const idx = state.shortlist.findIndex((it) => it && it.key === key);
  const storedJob = sanitizeJobForStorage(job, LOCAL_JOB_DESC_MAX);
  const existingSavedAt = idx >= 0 && state.shortlist[idx] ? String(state.shortlist[idx].savedAt || "") : "";
  const item = {
    key,
    // Preserve the original "date added" for updates; this makes sorting stable.
    savedAt: existingSavedAt || nowIso(),
    job: storedJob,
    analysis
  };

  const shortlist = [...state.shortlist];
  if (idx >= 0) shortlist[idx] = { ...shortlist[idx], ...item };
  else shortlist.unshift(item);

  await storageSet({ [STORAGE_KEYS.shortlist]: shortlist });
  return { key, item };
}

function buildRemoteShortlistItem(job, analysis, baseItem) {
  return {
    key: String(baseItem?.key || shortlistKeyForJob(job)),
    savedAt: String(baseItem?.savedAt || nowIso()),
    job: sanitizeJobForStorage(job, REMOTE_JOB_DESC_MAX),
    analysis
  };
}

async function isShortlisted(job) {
  const state = await getState();
  const key = shortlistKeyForJob(job);
  return state.shortlist.some((it) => it && it.key === key);
}

async function analyzeJob(job) {
  const state = await getState();
  if (!backendIsAuthed(state.backend)) {
    throw new Error("Sign in / create an account to start scoring.");
  }

  const jobKey = analysisCacheKeyForJob(job) || shortlistKeyForJob(job);
  const cached = jobKey ? state.cache[jobKey] : null;
  if (cached && cached.v === CACHE_VERSION && cached.analysis && cached.analyzedAt) {
    return { analysis: cached.analysis, cached: true };
  }

  const analysis = await analyzeWithBackend(job, state.backend);

  const nextCache = jobKey ? { ...state.cache, [jobKey]: { v: CACHE_VERSION, analysis, analyzedAt: nowIso() } } : { ...state.cache };
  await storageSet({ [STORAGE_KEYS.cache]: nextCache });

  return { analysis, cached: false };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || typeof msg !== "object") {
      sendResponse({ ok: false, error: "Invalid message." });
      return;
    }

    if (msg.type === "SHORTLISTR_GET_STATE") {
      let state = await getState();
      let remoteShortlistCount = null;
      let remoteQuota = null;
      if (backendIsAuthed(state.backend)) {
        try {
          const remote = await pullStateFromBackend(state.backend);
          remoteShortlistCount = Number(remote.shortlistCount) || 0;
          remoteQuota = remote.quota || null;
          const profile = { ...DEFAULT_PROFILE, ...(remote.profile || {}) };
          const settings = { ...DEFAULT_SETTINGS, ...(remote.settings || {}) };
          const resumeText = typeof remote.resumeText === "string" ? remote.resumeText : "";
          await storageSet({
            [STORAGE_KEYS.profile]: profile,
            [STORAGE_KEYS.settings]: settings,
            [STORAGE_KEYS.resumeText]: resumeText
          });
          state = { ...state, profile, settings, resumeText };
        } catch {
          // Best-effort; fall back to local state.
        }
      }
      sendResponse({
        ok: true,
        profile: state.profile,
        settings: state.settings,
        backend: { ...state.backend, apiToken: state.backend.apiToken ? "set" : "" },
        resumeTextLen: (state.resumeText || "").length,
        shortlistCount: remoteShortlistCount !== null ? remoteShortlistCount : state.shortlist.length,
        quota: remoteQuota
      });
      return;
    }

    if (msg.type === "SHORTLISTR_GET_RESUME_TEXT") {
      const state = await getState();
      sendResponse({ ok: true, resumeText: state.resumeText || "" });
      return;
    }

    if (msg.type === "SHORTLISTR_SAVE_PROFILE") {
      const state = await getState();
      if (!backendIsAuthed(state.backend)) throw new Error("Sign in to edit your profile.");
      const profile = { ...DEFAULT_PROFILE, ...(msg.profile || {}) };
      await storageSet({ [STORAGE_KEYS.profile]: profile });
      await pushStateToBackend(state.backend, { profile });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "SHORTLISTR_SAVE_SETTINGS") {
      const state = await getState();
      if (!backendIsAuthed(state.backend)) throw new Error("Sign in to edit your settings.");
      const settings = { ...DEFAULT_SETTINGS, ...(msg.settings || {}) };
      await storageSet({ [STORAGE_KEYS.settings]: settings });
      await pushStateToBackend(state.backend, { settings });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "SHORTLISTR_SAVE_BACKEND") {
      const current = (await getState()).backend;
      const incoming = msg.backend || {};
      const backend = { ...current, ...incoming };
      const baseUrlChanged =
        typeof incoming.apiBaseUrl === "string" &&
        incoming.apiBaseUrl.trim() &&
        String(incoming.apiBaseUrl).trim() !== String(current.apiBaseUrl || "");
      if (baseUrlChanged && (!incoming.apiToken || String(incoming.apiToken).trim() === "")) {
        backend.apiToken = "";
      } else if (typeof incoming.apiToken === "string" && incoming.apiToken.trim() === "") {
        backend.apiToken = current.apiToken || "";
      }
      const normalized = { ...DEFAULT_BACKEND, ...backend };
      await storageSet({ [STORAGE_KEYS.backend]: normalized });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "SHORTLISTR_CLEAR_BACKEND_TOKEN") {
      const current = (await getState()).backend;
      await storageSet({ [STORAGE_KEYS.backend]: { ...current, apiToken: "" } });
      await storageRemove([
        STORAGE_KEYS.profile,
        STORAGE_KEYS.settings,
        STORAGE_KEYS.resumeText,
        STORAGE_KEYS.shortlist,
        STORAGE_KEYS.cache
      ]);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "SHORTLISTR_AUTH_SIGNUP" || msg.type === "SHORTLISTR_AUTH_LOGIN") {
      const state = await getState();

      const email = String(msg.email || "").trim();
      const password = String(msg.password || "");
      if (!email) throw new Error("Email required.");
      if (!password) throw new Error("Password required.");

      const mode = msg.type === "SHORTLISTR_AUTH_SIGNUP" ? "signup" : "login";
      const { token } = await authWithBackend(state.backend, mode, email, password);
      const authedBackend = { ...state.backend, apiToken: token };
      await storageSet({ [STORAGE_KEYS.backend]: authedBackend });
      await storageRemove([
        STORAGE_KEYS.profile,
        STORAGE_KEYS.settings,
        STORAGE_KEYS.resumeText,
        STORAGE_KEYS.shortlist,
        STORAGE_KEYS.cache
      ]);

      let remoteState = null;
      let remoteStateOk = false;
      try {
        remoteState = await pullStateFromBackend(authedBackend);
        remoteStateOk = true;
      } catch {
        remoteState = null;
      }

      let remoteShortlist = null;
      let remoteShortlistOk = false;
      try {
        remoteShortlist = await pullShortlistFromBackend(authedBackend);
        remoteShortlistOk = true;
      } catch {
        remoteShortlist = null;
      }

      const toStore = {};
      if (remoteStateOk && remoteState && typeof remoteState === "object") {
        toStore[STORAGE_KEYS.profile] = { ...DEFAULT_PROFILE, ...(remoteState.profile || {}) };
        toStore[STORAGE_KEYS.settings] = { ...DEFAULT_SETTINGS, ...(remoteState.settings || {}) };
        toStore[STORAGE_KEYS.resumeText] = String(remoteState.resumeText || "");
      }
      if (remoteShortlistOk && Array.isArray(remoteShortlist)) {
        toStore[STORAGE_KEYS.shortlist] = sanitizeShortlistForLocal(remoteShortlist);
      }
      if (Object.keys(toStore).length > 0) await storageSet(toStore);

      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "SHORTLISTR_SAVE_RESUME_TEXT") {
      const state = await getState();
      if (!backendIsAuthed(state.backend)) throw new Error("Sign in to save your resume.");
      const resumeText = typeof msg.resumeText === "string" ? msg.resumeText : "";
      await storageSet({ [STORAGE_KEYS.resumeText]: resumeText });
      await pushStateToBackend(state.backend, { resumeText });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "SHORTLISTR_EXTRACT_RESUME") {
      const state = await getState();
      if (!backendIsAuthed(state.backend)) throw new Error("Sign in to extract your resume.");
      const bytes = msg.bytes;
      if (!(bytes instanceof ArrayBuffer)) throw new Error("Missing resume bytes.");
      const text = await extractResumeWithBackend(bytes, msg.fileName || "resume", msg.mimeType || "", state.backend);
      sendResponse({ ok: true, text });
      return;
    }

    if (msg.type === "SHORTLISTR_SITES_LIST") {
      const sites = await getEnabledSites();
      sendResponse({ ok: true, sites });
      return;
    }

    if (msg.type === "SHORTLISTR_SITE_ENABLE") {
      const origin = normalizeOriginPattern(msg.origin || "");
      if (!origin || !/^https?:\/\//i.test(origin)) throw new Error("Invalid origin.");

      const prev = await getEnabledSites();
      const sites = await setEnabledSites([...prev, origin]);

      await registerSiteContentScript(origin);
      const tabId = Number(msg.tabId);
      if (Number.isFinite(tabId) && tabId > 0) {
        await injectShortlistrIntoTab(tabId).catch(() => {});
      }

      sendResponse({ ok: true, sites });
      return;
    }

    if (msg.type === "SHORTLISTR_SITE_DISABLE") {
      const origin = normalizeOriginPattern(msg.origin || "");
      if (!origin || !/^https?:\/\//i.test(origin)) throw new Error("Invalid origin.");

      const prev = await getEnabledSites();
      const sites = await setEnabledSites(prev.filter((s) => s !== origin));

      await unregisterSiteContentScript(origin);
      sendResponse({ ok: true, sites });
      return;
    }

    if (msg.type === "SHORTLISTR_EXTRACT_JOB_FROM_TAB") {
      const tabId = Number(msg.tabId);
      if (!Number.isFinite(tabId) || tabId <= 0) throw new Error("Missing tabId.");
      const job = await extractJobFromTab(tabId);
      sendResponse({ ok: true, job });
      return;
    }

    if (msg.type === "SHORTLISTR_ANALYZE_JOB") {
      const job = msg.job || {};
      if (!job.url && sender?.tab?.url) job.url = sender.tab.url;
      job.url = normalizeUrl(job.url || "");

      const { analysis, cached } = await analyzeJob(job);
      const state = await getState();
      const action = actionForScore(analysis.score, state.settings);
      const key = shortlistKeyForJob(job);
      const existing = state.shortlist.find((it) => it && it.key === key);
      let saved_via =
        existing && existing.analysis && typeof existing.analysis.saved_via === "string" ? String(existing.analysis.saved_via) : "";
      const alreadySaved = Boolean(existing);

      let saved = false;
      let updated = false;
      let saveError = "";
      if (!alreadySaved && action === "auto_shortlist") {
        const localAnalysis = { ...analysis, action, saved_via: "auto" };
        try {
          if (!backendIsAuthed(state.backend)) throw new Error("Sign in to save roles.");
          const remoteItem = buildRemoteShortlistItem(job, localAnalysis, null);
          await upsertShortlistToBackend(state.backend, remoteItem);
          await upsertShortlistItem(job, localAnalysis);
          saved = true;
          saved_via = "auto";
        } catch (e) {
          const msg = e && typeof e === "object" && "message" in e ? String(e.message || "") : String(e || "");
          saveError = msg || "Failed to auto-save.";
        }
      }

      // If it's already in your shortlist and we produced a fresh analysis (not cached), update the stored analysis.
      // This lets you clear cache / rescore after editing your profile or resume and see it reflected in the Inbox.
      if (alreadySaved && !cached) {
        try {
          if (!backendIsAuthed(state.backend)) throw new Error("Sign in to update saved roles.");
          const updatedAnalysis = { ...analysis, action, saved_via };
          const remoteItem = buildRemoteShortlistItem(job, updatedAnalysis, existing);
          await upsertShortlistToBackend(state.backend, remoteItem);
          await upsertShortlistItem(job, updatedAnalysis);
          updated = true;
        } catch {
          // Best-effort: analysis still returns to the UI even if we can't update storage.
        }
      }

      sendResponse({ ok: true, analysis: { ...analysis, action, saved_via }, cached, saved, alreadySaved, updated, saveError });
      return;
    }

    if (msg.type === "SHORTLISTR_SAVE_JOB") {
      const job = msg.job || {};
      const analysis = msg.analysis || {};
      if (!job.url && sender?.tab?.url) job.url = sender.tab.url;
      job.url = normalizeUrl(job.url || "");

      const state = await getState();
      if (!backendIsAuthed(state.backend)) throw new Error("Sign in to save roles.");
      const action = actionForScore(Number(analysis.score) || 0, state.settings);
      const localAnalysis = { ...analysis, action, saved_via: "manual" };
      const remoteItem = buildRemoteShortlistItem(job, localAnalysis, null);
      await upsertShortlistToBackend(state.backend, remoteItem);
      const result = await upsertShortlistItem(job, localAnalysis);
      sendResponse({ ok: true, key: result.key });
      return;
    }

    if (msg.type === "SHORTLISTR_GET_SHORTLIST") {
      const state = await getState();
      if (!backendIsAuthed(state.backend)) throw new Error("Sign in to view your Shortlist Inbox.");
      let shortlist = [];

      try {
        const remote = await pullShortlistFromBackend(state.backend);
        shortlist = sanitizeShortlistForLocal(remote);
        await storageSet({ [STORAGE_KEYS.shortlist]: shortlist });
      } catch {
        shortlist = sanitizeShortlistForLocal(state.shortlist);
      }

      sendResponse({ ok: true, shortlist });
      return;
    }

    if (msg.type === "SHORTLISTR_DELETE_SHORTLIST_ITEM") {
      const key = String(msg.key || "");
      const state = await getState();
      if (!backendIsAuthed(state.backend)) throw new Error("Sign in to edit your Shortlist Inbox.");
      await deleteShortlistFromBackend(state.backend, key);
      const shortlist = state.shortlist.filter((it) => it && it.key !== key);
      await storageSet({ [STORAGE_KEYS.shortlist]: shortlist });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "SHORTLISTR_CLEAR_SHORTLIST") {
      const state = await getState();
      if (!backendIsAuthed(state.backend)) throw new Error("Sign in to edit your Shortlist Inbox.");
      await clearShortlistOnBackend(state.backend);
      await storageSet({ [STORAGE_KEYS.shortlist]: [] });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "SHORTLISTR_CLEAR_CACHE") {
      await storageRemove([STORAGE_KEYS.cache]);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "SHORTLISTR_RESET_DAILY_QUOTA") {
      const state = await getState();
      if (!backendIsAuthed(state.backend)) throw new Error("Sign in to continue.");
      await backendJson(state.backend, "/v1/quota/reset", { method: "POST", body: {} });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "SHORTLISTR_CLEAR_JOB_CACHE") {
      const state = await getState();
      const job = msg.job && typeof msg.job === "object" ? msg.job : {};
      const key = analysisCacheKeyForJob(job) || shortlistKeyForJob(job);
      if (!key) {
        sendResponse({ ok: true, cleared: 0 });
        return;
      }

      const cache = state.cache && typeof state.cache === "object" ? { ...state.cache } : {};
      const had = Object.prototype.hasOwnProperty.call(cache, key);
      if (had) delete cache[key];
      await storageSet({ [STORAGE_KEYS.cache]: cache });
      sendResponse({ ok: true, cleared: had ? 1 : 0 });
      return;
    }

    if (msg.type === "SHORTLISTR_OPEN_OPTIONS") {
      if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
      else chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "SHORTLISTR_OPEN_INBOX") {
      chrome.tabs.create({ url: chrome.runtime.getURL("inbox.html") });
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type." });
  })().catch((err) => {
    sendResponse({ ok: false, error: err?.message || String(err) });
  });

  return true;
});
