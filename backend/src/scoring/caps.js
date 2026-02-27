function safeLower(s) {
  return String(s || "").toLowerCase();
}

function profileWantText(profile = {}) {
  return safeLower(
    [profile.lookingFor, profile.strengths, profile.mustHaves, profile.niceToHaves].filter(Boolean).join("\n")
  );
}

function profileAvoidText(profile = {}) {
  return safeLower(profile.avoid || "");
}

function jobAllText(job = {}) {
  return safeLower([job.title, job.company, job.location, job.description].filter(Boolean).join("\n"));
}

function candidateAllText({ candidateExtract, resumeText }) {
  const resume = safeLower(resumeText || "");
  const extracted = safeLower(candidateExtract ? JSON.stringify(candidateExtract) : "");
  return `${extracted}\n${resume}`;
}

const CONSULTING_FIRMS_RE =
  /\b(mckinsey|bain|boston consulting group|bcg|oliver wyman|accenture|deloitte|pwc|pricewaterhousecoopers|ey|ernst\s*&\s*young)\b/i;
const CONSULTING_LANG_RE =
  /\b(enterprise transformation|strategic consulting|global consultanc|change management|behavior change|stakeholder buy[- ]?in|adoption|c-?suite|boardroom)\b/i;
const NOT_CAREER_CODER_RE = /\b(not a standard engineering role|not a career coder)\b/i;
const SALES_QUOTA_RE = /\b(quota|pipeline generation|sales target|pre-?sales)\b/i;

const WANTS_HANDS_ON_RE =
  /\b(hands?-on|build|building|ship|shipping|implementation|coding|engineer|backend|full[- ]?stack|orchestrat|llm|genai|ai system)\b/i;
const WANTS_CONSULTING_RE = /\b(consult|transformation|change management|adoption)\b/i;
const AVOIDS_CONSULTING_RE =
  /\b(consult|transformation|change management|adoption|enablement|stakeholder|boardroom)\b/i;
const HAS_CONSULTING_RE =
  /\b(consultant|consulting|mckinsey|bain|bcg|oliver wyman|accenture|deloitte|pwc|pricewaterhousecoopers|ey|ernst\s*&\s*young)\b/i;

/**
 * Deterministic caps to prevent "title match" false positives (e.g., "FDE" roles
 * that are actually consulting/transformation-heavy). This is intentionally
 * conservative: it only caps when the posting contains strong signals.
 */
export function capFitScore({ score, job, profile, resumeText, jobExtract, candidateExtract }) {
  const rawScore = Number(score);
  if (!Number.isFinite(rawScore)) return { score: rawScore, maxScore: 100, capReasons: [] };

  const jobText = jobAllText(job);
  const wantText = profileWantText(profile);
  const avoidText = profileAvoidText(profile);
  const candidateText = candidateAllText({ candidateExtract, resumeText });

  const candidateWantsHandsOn = WANTS_HANDS_ON_RE.test(wantText);
  const candidateWantsConsulting = WANTS_CONSULTING_RE.test(wantText);
  const candidateAvoidsConsulting = AVOIDS_CONSULTING_RE.test(avoidText);
  const candidateHasConsulting = HAS_CONSULTING_RE.test(candidateText);

  const jobHasConsultingFirms = CONSULTING_FIRMS_RE.test(jobText);
  const jobHasConsultingLang = CONSULTING_LANG_RE.test(jobText);
  const jobNotCareerCoder = NOT_CAREER_CODER_RE.test(jobText);
  const jobSalesQuota = SALES_QUOTA_RE.test(jobText);

  const roleArchetype = safeLower(jobExtract?.role_archetype || "");
  const consultingIntensity = Number(jobExtract?.consulting_intensity);
  const codingIntensity = Number(jobExtract?.coding_intensity);

  const capReasons = [];
  let maxScore = 100;

  // 1) Explicit consulting background expectations (strongest signal)
  if ((jobHasConsultingFirms || roleArchetype.includes("consult")) && !candidateHasConsulting) {
    maxScore = Math.min(maxScore, 45);
    capReasons.push("Posting signals a consulting-heavy background as a key requirement.");
  }

  // 2) You explicitly avoid consulting/transformation language, and the job is loaded with it
  if ((jobHasConsultingFirms || jobHasConsultingLang || roleArchetype.includes("consult")) && candidateAvoidsConsulting) {
    maxScore = Math.min(maxScore, 35);
    capReasons.push("Role reads like consulting/transformation + change management, which you listed to avoid.");
  }

  // 3) "Not a career coder" / low hands-on build signal vs a hands-on target
  const looksLowCoding =
    jobNotCareerCoder || (Number.isFinite(codingIntensity) && codingIntensity <= 2) || roleArchetype.includes("consult");
  const looksHighConsulting = (Number.isFinite(consultingIntensity) && consultingIntensity >= 4) || jobHasConsultingLang;
  if (looksLowCoding && looksHighConsulting && candidateWantsHandsOn && !candidateWantsConsulting) {
    maxScore = Math.min(maxScore, 55);
    capReasons.push("Posting emphasizes strategic/adoption work over hands-on building.");
  }

  // 4) Pre-sales / quota language vs non-sales targets
  if (jobSalesQuota && !candidateWantsConsulting) {
    maxScore = Math.min(maxScore, 55);
    capReasons.push("Posting includes pre-sales / quota language that often conflicts with builder roles.");
  }

  const capped = Math.min(rawScore, maxScore);
  return { score: capped, maxScore, capReasons };
}
