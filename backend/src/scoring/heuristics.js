import { normalizeSpace } from "../utils/text.js";
import { scoreToLabel } from "./labels.js";

export function scoreWithHeuristics(job, profile) {
  const jobText = `${job.title || ""}\n${job.company || ""}\n${job.location || ""}\n\n${job.description || ""}`.toLowerCase();
  const wantText = `${profile.lookingFor || ""}\n${profile.strengths || ""}\n${profile.workHighlights || ""}\n${profile.mustHaves || ""}\n${profile.niceToHaves || ""}`.toLowerCase();
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

  const fuzzyBoostTerms = [
    "forward deployed",
    "solutions engineer",
    "sales engineer",
    "customer engineer",
    "applied ai",
    "applied ml",
    "machine learning",
    "llm",
    "genai",
    "generative ai",
    "agent",
    "ai engineer",
    "ml engineer"
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
  if (consultingHits > 0 && !wantConsulting) reasons.push("Detected consulting/transformation signals; penalized due to your target profile.");
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
    strengths_to_highlight: normalizeSpace(profile.strengths || "")
      .split(/\n+/g)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 6),
    reasons,
    concerns: [
      ...(avoidHits > 0 ? ["May conflict with your avoid list."] : []),
      ...(consultingHits > 0 && !wantConsulting ? ["May be more consulting/transformation than hands-on engineering."] : [])
    ]
  };
}
