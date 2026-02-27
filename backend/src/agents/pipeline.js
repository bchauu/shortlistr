import { scoreToLabel } from "../scoring/labels.js";
import { capFitScore } from "../scoring/caps.js";
import { computePersonaLenses } from "../scoring/personas.js";
import { truncate } from "../utils/text.js";
import { agentSelectJobText } from "./postingSelector.js";
import { agentExtractJob } from "./jobExtractor.js";
import { agentExtractCandidate } from "./candidateExtractor.js";
import { agentHiringManager } from "./hiringManager.js";

function clampInt(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.round(x)));
}

function clamp0to5(n) {
  return clampInt(n, 0, 5);
}

function clamp0to100(n) {
  return clampInt(n, 0, 100);
}

const YEARS_RE =
  /\b(\d+)\s*\+?\s*(?:\+|plus)?\s*years?\b|\byears? of experience\b|\byoe\b|\bexperience\s*\(\s*\d+\s*\+\s*years?\s*\)/i;
const YEARS_NEG_RE =
  /(lack|lacks|lacking|missing|does not (meet|have|demonstrate)|doesn't (meet|have|demonstrate)|insufficient|not enough)/i;
const JOB_DEEMPHASIZES_YEARS_RE =
  /\bhire\b[\s\S]{0,160}\bdemonstrated\s+(capability|ability|impact)\b[\s\S]{0,160}\bnot\s+years?\b/i;
const SENIORITY_CONCERN_RE = /\b(years?|yoe|years? of experience|seniority|title|titles|level)\b/i;
const YEAR_PROXY_REASON_RE = /(years?\s+(?:requirements?|lines?)\s+are\s+often\s+a\s+proxy|scope reads like|years?\b.*proxy|\bproxy\b.*\byears?\b)/i;

function dedupeStrings(list) {
  const out = [];
  const seen = new Set();
  for (const v of Array.isArray(list) ? list : []) {
    const s = String(v || "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function sanitizeJobExtractForScoring(jobExtract) {
  if (!jobExtract || typeof jobExtract !== "object") return jobExtract;

  // Keep "hard_requirements" focused on true credentials/constraints (clearance, licenses, ex-MBB, etc.)
  // and avoid treating common tech stacks as hard gates.
  const CREDENTIAL_RE =
    /\b(security clearance|clearance|citizen|citizenship|work authorization|visa|sponsorship|licensed|license|certified|certification|degree|bachelor|master|phd|mba|ex[- ]?(mckinsey|bain|bcg)|top[- ]tier consulting)\b/i;
  const COMMON_TECH_RE =
    /\b(react|react native|typescript|javascript|node\.?js|express|next\.?js|python|java|golang|go\b|c\+\+|c#|aws|gcp|google cloud|azure|docker|kubernetes|mongodb|postgres|postgresql|mysql|graphql|webpack|vite)\b/i;

  const hardReqs = dedupeStrings(jobExtract.hard_requirements);
  const mustHaves = dedupeStrings(jobExtract.must_haves);

  const keepHard = [];
  const moveToMust = [];
  for (const r of hardReqs) {
    if (CREDENTIAL_RE.test(r)) {
      keepHard.push(r);
      continue;
    }
    if (COMMON_TECH_RE.test(r)) {
      moveToMust.push(r);
      continue;
    }
    // If it's not a clear credential, err on the side of NOT treating it as a hard gate.
    if (/\byears?\b/i.test(r)) {
      moveToMust.push(r);
      continue;
    }
    keepHard.push(r);
  }

  return {
    ...jobExtract,
    hard_requirements: dedupeStrings(keepHard),
    must_haves: dedupeStrings([...mustHaves, ...moveToMust])
  };
}

function normalizeConcerns(items) {
  const out = [];
  for (const v of Array.isArray(items) ? items : []) {
    const s = String(v || "").trim();
    if (!s) continue;
    if (YEARS_RE.test(s)) {
      out.push("Years requirements are often a proxy — treat missing exact years as a verify item, not an automatic blocker.");
    } else {
      out.push(s);
    }
  }
  return dedupeStrings(out);
}

function jobDeemphasizesYears(jobText) {
  const t = String(jobText || "");
  if (!t.trim()) return false;
  if (/demonstrated capability,\s*not years of experience/i.test(t)) return true;
  if (JOB_DEEMPHASIZES_YEARS_RE.test(t)) return true;
  return false;
}

function concernsAreMostlySeniorityUnknown(rawConcerns) {
  const cs = Array.isArray(rawConcerns) ? rawConcerns.map((c) => String(c || "").trim()).filter(Boolean) : [];
  if (cs.length === 0) return false;
  return cs.every((c) => SENIORITY_CONCERN_RE.test(c));
}

function signalLevel(signal) {
  const n = signal && typeof signal === "object" ? Number(signal.level) : Number(signal);
  return clamp0to5(n);
}

function maybeBoostScoreForHiddenTalent({ score, subscores, candidateExtract, jobExtract, capped, maxAllowedScore }) {
  const s = clamp0to100(score);
  if (capped) return s;
  if (s < 70 || s >= 79) return s;
  if (!subscores || typeof subscores !== "object") return s;

  const maxAllowed = clamp0to100(maxAllowedScore);

  const roleArchetype = String(jobExtract?.role_archetype || "").toLowerCase();
  if (roleArchetype.includes("consult") || roleArchetype.includes("pre_sales")) return s;

  const jobSignals = jobExtract && typeof jobExtract === "object" ? jobExtract.signals || {} : {};
  const candSignals = candidateExtract && typeof candidateExtract === "object" ? candidateExtract.signals || {} : {};

  const jobAi = signalLevel(jobSignals.llm_or_ai);
  const jobCustomer = signalLevel(jobSignals.customer_facing_delivery);
  const jobChange = signalLevel(jobSignals.change_management_adoption);
  if (jobChange >= 4) return s;

  const candLlm = signalLevel(candSignals.llm_orchestration);
  const candFullStack = signalLevel(candSignals.full_stack_engineering);
  const candCustomer = signalLevel(candSignals.customer_facing_delivery);
  const candAgency = signalLevel(candSignals.ambiguity_high_agency);

  if (jobAi < 2 || jobCustomer < 3) return s;
  if (candLlm < 3 || candFullStack < 3) return s;
  if (candCustomer < 2 && candAgency < 3) return s;

  const hardReqs = Array.isArray(jobExtract?.hard_requirements) ? jobExtract.hard_requirements.filter(Boolean) : [];
  if (hardReqs.length > 0) return s;

  const roleIntent = clamp0to5(subscores.role_intent_match);
  const responsibilities = clamp0to5(subscores.responsibilities_match);
  const environment = clamp0to5(subscores.environment_match);
  if (roleIntent < 3 || responsibilities < 3 || environment < 3) return s;

  return Math.min(maxAllowed, Math.max(s, 79));
}

function normalizeSubscores(subscoresRaw, candidateExtract) {
  if (!subscoresRaw || typeof subscoresRaw !== "object") return undefined;
  const s = subscoresRaw;

  const seniorityProxy = clamp0to5(candidateExtract?.experience?.seniority_proxy?.level);
  const seniorityMatch = Math.max(clamp0to5(s.seniority_match), seniorityProxy);

  return {
    role_intent_match: clamp0to5(s.role_intent_match),
    responsibilities_match: clamp0to5(s.responsibilities_match),
    environment_match: clamp0to5(s.environment_match),
    preference_match: clamp0to5(s.preference_match),
    seniority_match: seniorityMatch,
    confidence: clamp0to5(s.confidence)
  };
}

function scoreFromSubscores(subscores) {
  if (!subscores || typeof subscores !== "object") return null;
  const s = subscores;

  // Down-weight seniority/years: we want "can do the job" and "role intent" to dominate.
  const weights = {
    role_intent_match: 0.2,
    responsibilities_match: 0.33,
    environment_match: 0.25,
    preference_match: 0.18,
    seniority_match: 0.04
  };

  const base =
    clamp0to5(s.role_intent_match) * weights.role_intent_match +
    clamp0to5(s.responsibilities_match) * weights.responsibilities_match +
    clamp0to5(s.environment_match) * weights.environment_match +
    clamp0to5(s.preference_match) * weights.preference_match +
    clamp0to5(s.seniority_match) * weights.seniority_match;

  const scoreBase = Math.round((base / 5) * 100);
  let score = scoreBase;

  const conf = clamp0to5(s.confidence);
  // Confidence should affect the score (unknowns), but we avoid "ATS reject" behavior.
  // Only heavy uncertainty should meaningfully drag the score down.
  const confPenalty = conf <= 2 ? 10 : conf === 3 ? 3 : conf === 4 ? 1 : 0;
  score -= confPenalty;

  // Hidden-talent guardrail: if the work match is already in "Good shot" territory and the evidence isn't low-confidence,
  // don't let soft unknowns pull it down into "modest odds".
  if (conf >= 3 && scoreBase >= 79) score = Math.max(score, 79);

  return clamp0to100(score);
}

function stripYearNegativeSentences(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  const parts = t.split(/(?<=[.!?])\s+/g);
  const kept = parts
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .filter((p) => !(YEARS_RE.test(p) && YEARS_NEG_RE.test(p)));
  return kept.join(" ").trim();
}

function oneLine(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForMatch(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toSentence(s) {
  const t = oneLine(s);
  if (!t) return "";
  if (/[.!?]$/.test(t)) return t;
  return t + ".";
}

function shortClause(s, maxLen) {
  const t = oneLine(s);
  if (!t) return "";
  if (!maxLen || t.length <= maxLen) return t;
  const slice = t.slice(0, Math.min(t.length, maxLen + 1));
  const minCut = Math.max(0, Math.floor(maxLen * 0.6));

  const punctChars = [".", ";", "—", ")", "!", "?"];
  let punct = -1;
  for (const ch of punctChars) punct = Math.max(punct, slice.lastIndexOf(ch));
  if (punct >= minCut) return t.slice(0, punct + 1).trim();

  const space = slice.lastIndexOf(" ");
  const cut = space >= minCut ? space : maxLen;
  return t.slice(0, cut).trim() + "…";
}

function summarizeConcernForVerify(concernRaw) {
  const c = oneLine(concernRaw);
  if (!c) return "";
  const lc = c.toLowerCase();

  if (/(remote|fully remote|remote-first|on[- ]?site|in[- ]?office|hybrid|relocat|location mode)/i.test(lc)) {
    return "remote/onsite expectations";
  }
  if (/(actively build|hands[- ]?on).*(llm|genai|ai)|\b(llm|genai)\b.*(actively build|hands[- ]?on)|ai adjacent|ai strategy/i.test(lc)) {
    return "hands-on LLM building (not AI-adjacent)";
  }
  if (/(consult|transformation|change management|adoption|enablement)/i.test(lc)) {
    return "hands-on building vs consulting/adoption work";
  }
  if (/\btravel\b/i.test(lc)) return "travel expectations";
  if (/(security clearance|\bclearance\b)/i.test(lc)) return "clearance requirement";
  if (/(citizen|citizenship|work authorization|visa|sponsorship|sponsor)/i.test(lc)) return "work authorization / sponsorship";
  if (/(years? of experience|\byoe\b|seniority|title|level)/i.test(lc)) return "seniority/years screen (often fuzzy)";

  // Fallback: keep it short but complete (no mid-word cut). Prefer the first clause.
  const clause = c.split(/[.;—]/)[0]?.trim() || c;
  const words = clause.split(/\s+/g).filter(Boolean);
  const clipped = words.slice(0, 16).join(" ");
  return clipped || clause;
}

function pickTopNeed(implied_company_needs) {
  const items = Array.isArray(implied_company_needs) ? implied_company_needs : [];
  if (items.length === 0) return "";
  let best = items[0];
  for (const it of items) {
    const c0 = Number(best && typeof best === "object" ? best.confidence : NaN);
    const c1 = Number(it && typeof it === "object" ? it.confidence : NaN);
    if (Number.isFinite(c1) && (!Number.isFinite(c0) || c1 > c0)) best = it;
  }
  return shortClause(best && typeof best === "object" ? best.need : "", 140);
}

function pickEdgeValue(candidate_hidden_value, strengthsToHighlight, reasons) {
  const values = Array.isArray(candidate_hidden_value) ? candidate_hidden_value : [];
  const v0 = values.find((v) => v && typeof v === "object" && String(v.value || "").trim());
  if (v0) return shortClause(String(v0.value || ""), 180);

  const hs = dedupeStrings(strengthsToHighlight).filter(Boolean);
  if (hs.length > 0) return shortClause(hs.slice(0, 2).join(" + "), 180);

  const rs = dedupeStrings(reasons).filter(Boolean);
  const r0 = rs.find((r) => r && !YEAR_PROXY_REASON_RE.test(r) && !/unknown/i.test(r)) || rs[0] || "";
  return shortClause(r0, 180);
}

function buildTldr({ score, implied_company_needs, candidate_hidden_value, strengthsToHighlight, reasons, concerns }) {
  const s = clamp0to100(score);
  if (s < 70) return "";

  const need = pickTopNeed(implied_company_needs);
  const edge = pickEdgeValue(candidate_hidden_value, strengthsToHighlight, reasons);

  const cs = dedupeStrings(concerns).filter(Boolean);
  const verify = summarizeConcernForVerify(cs[0] || "");

  if (need && edge) {
    if (verify) {
      return `TL;DR: Your edge (${edge}) maps directly to the role’s core need (${need}), so ${verify} is likely a clarify, not a blocker.`;
    }
    return `TL;DR: Your edge (${edge}) maps directly to the role’s core need (${need}) — worth applying.`;
  }

  if (edge && verify) {
    return `TL;DR: Your edge (${edge}) is a strong match for the core work; ${verify} is the main thing to clarify — still worth applying.`;
  }
  if (edge) return `TL;DR: Your edge (${edge}) is a strong match for the core work — worth applying.`;
  return "";
}

function maybeBoostScoreForSeniorityUnknowns({ score, subscores, candidateExtract, rawConcerns, jobText, capped, maxAllowedScore }) {
  const s = clamp0to100(score);
  if (capped) return s;
  if (s < 70 || s >= 79) return s;
  if (!subscores || typeof subscores !== "object") return s;

  const maxAllowed = clamp0to100(maxAllowedScore);
  const wantsBiggerBoost = jobDeemphasizesYears(jobText);

  const seniorityProxy = clamp0to5(candidateExtract?.experience?.seniority_proxy?.level);
  if (seniorityProxy < 3) return s;

  const roleIntent = clamp0to5(subscores.role_intent_match);
  const responsibilities = clamp0to5(subscores.responsibilities_match);
  const environment = clamp0to5(subscores.environment_match);
  if (roleIntent < 3 || responsibilities < 3 || environment < 3) return s;

  // If the role explicitly says it hires on demonstrated capability (not years), treat years/title unknowns as low risk.
  // Otherwise, only bump borderline scores (avoid inflating everything).
  if (wantsBiggerBoost) return Math.min(maxAllowed, Math.max(s, 79));

  if (!concernsAreMostlySeniorityUnknown(rawConcerns)) return s;
  if (s >= 75) return Math.min(maxAllowed, Math.max(s, 79));

  return s;
}

function collectCandidateEvidenceSnippets(candidateExtract) {
  const out = [];
  const pushEvidence = (arr) => {
    for (const v of Array.isArray(arr) ? arr : []) {
      const s = String(v || "").trim();
      if (!s) continue;
      out.push(s);
    }
  };

  pushEvidence(candidateExtract?.experience?.years_as_engineer_estimate?.evidence);
  pushEvidence(candidateExtract?.experience?.seniority_proxy?.evidence);

  const signals = candidateExtract && typeof candidateExtract === "object" ? candidateExtract.signals : null;
  if (signals && typeof signals === "object") {
    for (const k of Object.keys(signals)) pushEvidence(signals?.[k]?.evidence);
  }

  const tech = candidateExtract && typeof candidateExtract === "object" ? candidateExtract.tech : null;
  if (tech && typeof tech === "object") {
    for (const cat of Object.keys(tech)) {
      const items = Array.isArray(tech?.[cat]) ? tech[cat] : [];
      for (const it of items) pushEvidence(it?.evidence);
    }
  }

  return dedupeStrings(out);
}

function deriveResumeOrCoverLetterTip({ score, profile, resumeText, candidateExtract }) {
  const s = clamp0to100(score);
  if (s < 70) return "";

  const workHighlightsRaw = String(profile?.workHighlights || "").trim();
  if (!workHighlightsRaw || workHighlightsRaw.length < 40) return "";

  const workHighlights = normalizeForMatch(workHighlightsRaw);
  const resume = normalizeForMatch(resumeText || "");
  const otherProfile = normalizeForMatch(
    [profile?.lookingFor, profile?.strengths, profile?.mustHaves, profile?.niceToHaves].filter(Boolean).join("\n")
  );

  const evidence = collectCandidateEvidenceSnippets(candidateExtract);
  const unique = [];
  for (const ev of evidence) {
    const evNorm = normalizeForMatch(ev);
    if (evNorm.length < 18) continue;
    if (!workHighlights.includes(evNorm)) continue;
    if (resume.includes(evNorm)) continue;
    if (otherProfile.includes(evNorm)) continue;
    unique.push(oneLine(ev));
  }

  if (unique.length === 0) return "";
  const snippet = shortClause(unique[0], 220);
  if (!snippet) return "";

  const intro =
    s >= 79
      ? "Resume/cover letter tip: This fit used a detail you wrote in Work highlights."
      : "Resume/cover letter tip: Strengthen your narrative with this Work highlights detail.";

  return `${intro} Add it to your resume bullet or cover letter for this role: ${snippet}`;
}

function buildUserFacingSummary({ score, reasons, concerns, capReason, strengthsToHighlight }) {
  const s = clamp0to100(score);
  const rs = dedupeStrings(reasons).filter(Boolean);
  const cs = dedupeStrings(concerns).filter(Boolean);

  const primaryWhy =
    rs.find((r) => r && !YEAR_PROXY_REASON_RE.test(r) && !/unknown/i.test(r)) ||
    rs.find((r) => r && !YEAR_PROXY_REASON_RE.test(r)) ||
    rs[0] ||
    "";

  const why = shortClause(primaryWhy, 140);
  const concernFull = shortClause(capReason || cs[0] || "", 140);
  const verifyItem = summarizeConcernForVerify(capReason || cs[0] || "");

  const highlights = dedupeStrings(strengthsToHighlight).filter(Boolean);
  const angleItemsSource = highlights.length > 0 ? highlights : rs;
  const angleItems = dedupeStrings(angleItemsSource)
    .filter((r) => r && !YEAR_PROXY_REASON_RE.test(r))
    .filter((r) => !/unknown/i.test(r))
    .slice(0, 2)
    .map((r) => shortClause(r, 120))
    .filter(Boolean);
  const angle = shortClause(angleItems.join(" + "), 220);

  const applyBecause = angle ? `Apply because you bring: ${angle}` : "";
  const verify = verifyItem ? `verify: ${verifyItem}` : "";
  const becauseAndVerify = [applyBecause, verify].filter(Boolean).join("; ");
  const secondSentence = becauseAndVerify ? `${toSentence(becauseAndVerify)}` : "";

  if (s >= 95) {
    const first = why ? `Bullseye — ${toSentence(why)}` : "Bullseye — strong match on responsibilities and success profile.";
    return `${first} Drop everything: apply + DM if you can.`;
  }
  if (s >= 87) {
    const first = why ? `Very strong — ${toSentence(why)}` : "Very strong fit — responsibilities and environment look aligned.";
    const second = secondSentence || (concernFull ? `Minor unknown: ${concernFull}.` : "Only minor unknowns to validate.");
    return `${first} ${second}`.trim();
  }
  if (s >= 79) {
    const first = why ? `Good shot — ${toSentence(why)}` : "Good shot — role intent and responsibilities look aligned.";
    const fallback = concernFull
      ? `Main verify: ${summarizeConcernForVerify(concernFull) || concernFull}; still worth applying — your implied strengths can outweigh the unknowns.`
      : "Still worth applying — your implied strengths can outweigh the unknowns.";
    const second = secondSentence || fallback;
    return `${first} ${second}`.trim();
  }
  if (s >= 70) {
    const first = why ? `Modest odds — ${toSentence(why)}` : "Modest odds — some alignment, but not a slam dunk.";
    const fallback = concernFull
      ? `Gap/unknown: ${summarizeConcernForVerify(concernFull) || concernFull}; apply if you like it and plan a tight narrative.`
      : "Apply if you like it and plan a tight narrative.";
    const second = secondSentence || fallback;
    return `${first} ${second}`.trim();
  }
  if (s >= 65) {
    const first = why ? `Long-shot — ${toSentence(why)}` : "Long-shot — partial overlap, but too many unknowns.";
    const fallback = concernFull
      ? `Biggest blocker/unknown: ${summarizeConcernForVerify(concernFull) || concernFull}; apply only if you love the company or domain.`
      : "Apply only if you love the company or domain.";
    const second = secondSentence || fallback;
    return `${first} ${second}`.trim();
  }

  const first = concernFull ? `Probably no — ${toSentence(concernFull)}` : "Probably no — clear mismatch on role intent, must-haves, or constraints.";
  return `${first} Only apply if there’s a special reason.`;
}

export async function runAgentPipeline({ apiKey, model, job, profile, resumeText, candidateExtract: candidateExtractOverride }) {
  let selected = null;
  let jobForExtraction = job;

  const candidates = Array.isArray(job?.descriptionCandidates) ? job.descriptionCandidates : [];
  function candidateSig(text) {
    const lower = String(text || "").trim().toLowerCase();
    if (!lower) return "";
    const head = lower.slice(0, 220);
    const tail = lower.slice(Math.max(0, lower.length - 220));
    return `${head}|${tail}|${lower.length}`;
  }

  function sourceKind(c) {
    return String(c?.source || "").trim().toLowerCase();
  }

  function hasHighSignalCandidate(cands) {
    return cands.some((c) => {
      const s = sourceKind(c);
      return s === "jsonld" || s === "selector" || s === "heading";
    });
  }

  function shouldUsePostingSelector(cands) {
    if (!Array.isArray(cands) || cands.length < 2) return false;
    // If we already have structured candidates (JSON-LD / selectors / headings), prefer deterministic merge (cheaper).
    if (hasHighSignalCandidate(cands)) return false;

    const top = cands[0] || {};
    const topSource = sourceKind(top);
    const topLen = String(top.text || "").length;
    const secondLen = String(cands[1]?.text || "").length;

    // For generic "body/main/article" candidates with close lengths, selection can help reduce irrelevant text.
    if (topSource === "body") return true;
    if ((topSource === "main" || topSource === "article") && secondLen >= Math.round(topLen * 0.88)) return true;
    // If the best candidate is short, selection may try to merge the right blocks.
    if (topLen > 0 && topLen < 700) return true;
    return false;
  }

  function mergeCandidatesText(cands, fallback) {
    const list = Array.isArray(cands) ? cands : [];
    const parts = [];
    const seen = new Set();

    const isSupplement = (c) => {
      const s = sourceKind(c);
      if (s === "heading") return true;
      const label = String(c?.label || "");
      return /(responsibilit|requirement|qualifications|about|benefits|perks)/i.test(label);
    };

    for (const c of list) {
      const t = String(c?.text || "").trim();
      if (t.length < 120) continue;
      const sig = candidateSig(t);
      if (!sig || seen.has(sig)) continue;
      if (parts.length === 0) {
        parts.push(t);
        seen.add(sig);
        continue;
      }
      if (!isSupplement(c)) continue;
      const label = String(c?.label || "").trim();
      const header = label ? `${label}\n` : "";
      parts.push(`${header}${t}`);
      seen.add(sig);
      if (parts.length >= 4) break;
    }

    if (parts.length === 0) {
      const f = String(fallback || "").trim();
      return f;
    }

    return parts.join("\n\n----\n\n").trim();
  }

  // Cheap deterministic merge for extraction; keeps the jobExtractor input stable and avoids selection when not needed.
  const mergedCandidateText = mergeCandidatesText(candidates, job?.description || "");
  if (mergedCandidateText) {
    jobForExtraction = {
      ...job,
      description: truncate(mergedCandidateText, 16000)
    };
  }

  if (shouldUsePostingSelector(candidates)) {
    try {
      selected = await agentSelectJobText({
        apiKey,
        model,
        jobMeta: job,
        descriptionCandidates: candidates
      });

      const ids = Array.isArray(selected?.selected_candidate_ids)
        ? selected.selected_candidate_ids.map((s) => String(s))
        : [];

      const byId = new Map(candidates.map((c, idx) => [String(c?.id || `c${idx}`), String(c?.text || "")]));
      const mergedFromIds = ids
        .map((id) => byId.get(id) || "")
        .filter(Boolean)
        .join("\n\n")
        .trim();

      const selectedTextModel = String(selected?.job_post_text || "").trim();
      let selectedText = selectedTextModel;
      if (mergedFromIds) {
        selectedText = mergedFromIds.length >= selectedTextModel.length ? mergedFromIds : selectedTextModel;
      }

      if (selectedText) {
        jobForExtraction = {
          ...job,
          description: truncate(selectedText, 16000)
        };
      }
    } catch {
      // Selection is best-effort; continue with deterministic merge / existing description.
      selected = null;
    }
  }

  const candidatePromise =
    candidateExtractOverride && typeof candidateExtractOverride === "object"
      ? Promise.resolve(candidateExtractOverride)
      : agentExtractCandidate({ apiKey, model, profile, resumeText });

  const [jobExtractRaw, candidateExtract] = await Promise.all([
    agentExtractJob({ apiKey, model, job: jobForExtraction }),
    candidatePromise
  ]);

  const jobExtract = sanitizeJobExtractForScoring(jobExtractRaw);

  const fit = await agentHiringManager({ apiKey, model, jobExtract, candidateExtract });
  const subscores = normalizeSubscores(fit?.subscores, candidateExtract);
  const scoreFromSubs = scoreFromSubscores(subscores);
  const scoreFallback = Number(fit?.score);
  const scoreRaw = Number.isFinite(scoreFromSubs) ? scoreFromSubs : scoreFallback;
  if (!Number.isFinite(scoreRaw)) throw new Error("Hiring-manager agent did not return a score.");

  const scored = capFitScore({
    score: scoreRaw,
    job: jobForExtraction,
    profile,
    resumeText,
    jobExtract,
    candidateExtract
  });

  const capped = Number.isFinite(scored.score) && Math.round(scored.score) !== Math.round(scoreRaw);
  const capReasons = Array.isArray(scored.capReasons) ? scored.capReasons.map((s) => String(s)).filter(Boolean) : [];
  const maxScore = Number(scored.maxScore);
  const maxAllowedScore = Number.isFinite(maxScore) ? Math.max(0, Math.min(100, Math.round(maxScore))) : 100;

  let analysisSummary = String(fit?.summary || "").trim();
  if (capped && capReasons.length > 0) {
    analysisSummary = capReasons[0];
  }

  const rawConcerns = Array.isArray(fit?.concerns) ? fit.concerns.map((s) => String(s)).filter(Boolean) : [];
  const yearsMentioned = rawConcerns.some((c) => YEARS_RE.test(c));

  // Remove overly ATS-like "lacks X years" phrasing from the summary; keep it as a verify item instead.
  if (!capped && yearsMentioned) {
    const cleaned = stripYearNegativeSentences(analysisSummary);
    if (cleaned) analysisSummary = cleaned;
    if (!analysisSummary) analysisSummary = "Years requirements are often a proxy — verify how strict the screen is if the role otherwise fits.";
  }

  const analysisReasons = Array.isArray(fit?.reasons) ? fit.reasons.map((s) => String(s)).filter(Boolean) : [];
  const analysisConcerns = normalizeConcerns(rawConcerns);
  if (capped && capReasons.length > 0) analysisConcerns.push(...capReasons);

  // If the job mentions years but scope evidence indicates mid/senior execution, encourage applying (without pretending we know exact years).
  const seniorityProxy = clamp0to5(candidateExtract?.experience?.seniority_proxy?.level);
  const seniorityEv = Array.isArray(candidateExtract?.experience?.seniority_proxy?.evidence)
    ? String(candidateExtract.experience.seniority_proxy.evidence[0] || "").trim()
    : "";
  if (yearsMentioned && seniorityProxy >= 3) {
    const roleIntent = clamp0to5(subscores?.role_intent_match);
    const responsibilities = clamp0to5(subscores?.responsibilities_match);
    if (roleIntent >= 3 && responsibilities >= 3) {
      const ev = seniorityEv ? ` (e.g., “${seniorityEv}”)` : "";
      const note = `Scope reads like mid/senior execution${ev} — years lines are often a proxy, so this can still be worth applying.`;
      // Keep this as a helpful note, but don't let it dominate the summary/first reason when we have stronger fit reasons.
      if (analysisReasons.length === 0) analysisReasons.unshift(note);
      else analysisReasons.splice(1, 0, note);
    }
  }

  let analysisScore = Math.max(0, Math.min(100, Math.round(scored.score)));
  analysisScore = maybeBoostScoreForSeniorityUnknowns({
    score: analysisScore,
    subscores,
    candidateExtract,
    rawConcerns,
    jobText: jobForExtraction?.description || "",
    capped,
    maxAllowedScore
  });
  analysisScore = maybeBoostScoreForHiddenTalent({
    score: analysisScore,
    subscores,
    candidateExtract,
    jobExtract,
    capped,
    maxAllowedScore
  });
  const analysisLabel = scoreToLabel(analysisScore);

  analysisSummary = buildUserFacingSummary({
    score: analysisScore,
    reasons: analysisReasons,
    concerns: analysisConcerns,
    capReason: capped && capReasons.length > 0 ? capReasons[0] : "",
    strengthsToHighlight:
      Array.isArray(fit?.strengths_to_highlight) && fit.strengths_to_highlight.length > 0
        ? fit.strengths_to_highlight
        : candidateExtract?.strengths_to_highlight
  });

  const personas = computePersonaLenses({
    baseScore: analysisScore,
    subscores,
    jobExtract,
    candidateExtract,
    maxScore: maxAllowedScore
  });

  const impliedNeedsFromJob = jobExtract && typeof jobExtract === "object" ? jobExtract.implied_company_needs : undefined;
  const impliedNeedsFromFit = fit && typeof fit === "object" ? fit.implied_company_needs : undefined;
  const implied_company_needs = Array.isArray(impliedNeedsFromJob) && impliedNeedsFromJob.length > 0 ? impliedNeedsFromJob : impliedNeedsFromFit;

  const candidate_hidden_value =
    fit && typeof fit === "object" && Array.isArray(fit.candidate_hidden_value) ? fit.candidate_hidden_value : undefined;
  const questions_to_validate =
    fit && typeof fit === "object" && Array.isArray(fit.questions_to_validate) ? fit.questions_to_validate : undefined;

  const resume_or_cover_letter_tip = deriveResumeOrCoverLetterTip({
    score: analysisScore,
    profile,
    resumeText,
    candidateExtract
  });

  const strengths_to_highlight = Array.isArray(fit?.strengths_to_highlight)
    ? fit.strengths_to_highlight.map((s) => String(s)).filter(Boolean).slice(0, 8)
    : [];

  const tldr = buildTldr({
    score: analysisScore,
    implied_company_needs,
    candidate_hidden_value,
    strengthsToHighlight: strengths_to_highlight.length ? strengths_to_highlight : candidateExtract?.strengths_to_highlight,
    reasons: analysisReasons,
    concerns: analysisConcerns
  });

  return {
    analysis: {
      score: analysisScore,
      label: analysisLabel,
      summary: analysisSummary,
      tldr,
      resume_or_cover_letter_tip,
      strengths_to_highlight,
      reasons: analysisReasons.slice(0, 10),
      concerns: analysisConcerns.slice(0, 10),
      subscores,
      personas,
      implied_company_needs,
      candidate_hidden_value,
      questions_to_validate
    },
    debug: { selected, jobExtract, candidateExtract }
  };
}
