import { truncate } from "../utils/text.js";
import { openaiChatJson } from "../openai/chatJson.js";

export async function agentExtractCandidate({ apiKey, model, profile, resumeText }) {
  const payload = {
    looking_for: profile.lookingFor || "",
    strengths: profile.strengths || "",
    work_highlights: truncate(profile.workHighlights || "", 12000),
    must_haves: profile.mustHaves || "",
    nice_to_haves: profile.niceToHaves || "",
    avoid: profile.avoid || "",
    resume_text: truncate(resumeText || "", 22000)
  };

  return openaiChatJson({
    apiKey,
    name: "candidateExtractor",
    model,
    temperature: 0,
    maxTokens: 1300,
    messages: [
      {
        role: "system",
        content:
          [
            "You are a candidate-profile extractor agent for Shortlistr.",
            "Return ONLY JSON (no markdown, no backticks).",
            "",
            "Rules:",
            "- Be evidence-based: only use information present in the provided payload.",
            "- Do NOT invent experience. If something is not stated, put it in `unknowns`.",
            "- Absence of a skill mention is NOT proof the candidate lacks it; treat as unknown unless explicitly stated.",
            "- Separate:",
            "  - hard_constraints: true dealbreakers (explicitly stated in avoid or resume)",
            "  - preferences.strong: important wants (typically from must_haves)",
            "  - preferences.nice: softer wants (typically from nice_to_haves)",
            "- For each signal: choose level 0–5 and include 1–3 short evidence snippets (verbatim phrases).",
            "- Explicitly extract key tech skills (languages/frameworks/databases/tools) from resume_text into `tech` with evidence snippets.",
            "- Extract seniority evidence and a rough years-of-experience estimate into `experience` (range + confidence). If dates are missing/unclear, keep the estimate low-confidence and add an unknown.",
            "- You may use `work_highlights` as additional evidence (it’s the candidate describing standout work in their own words). If something appears only in work_highlights (not resume_text), treat it as self-reported and reflect that in confidence/unknowns when appropriate.",
            "- Keep lists short and high-signal."
          ].join("\n")
      },
      {
        role: "user",
        content: [
          "Return JSON with this shape:",
          "{",
          '  "candidate_summary": "",',
          '  "target_roles": ["", ""],',
          '  "experience": {',
          '    "years_as_engineer_estimate": { "min": 0, "max": 0, "confidence": 0, "evidence": [""] },',
          '    "seniority_proxy": { "level": 0, "evidence": [""] }',
          "  },",
          '  "tech": {',
          '    "languages": [ { "name": "", "level": 0, "evidence": [""] } ],',
          '    "frameworks": [ { "name": "", "level": 0, "evidence": [""] } ],',
          '    "databases": [ { "name": "", "level": 0, "evidence": [""] } ],',
          '    "cloud_and_infra": [ { "name": "", "level": 0, "evidence": [""] } ],',
          '    "ai_and_llm": [ { "name": "", "level": 0, "evidence": [""] } ],',
          '    "testing_and_tooling": [ { "name": "", "level": 0, "evidence": [""] } ]',
          "  },",
          '  "signals": {',
          '    "llm_orchestration": { "level": 0, "evidence": [""] },',
          '    "full_stack_engineering": { "level": 0, "evidence": [""] },',
          '    "integrations_data_pipelines": { "level": 0, "evidence": [""] },',
          '    "enterprise_systems": { "level": 0, "evidence": [""] },',
          '    "customer_facing_delivery": { "level": 0, "evidence": [""] },',
          '    "ambiguity_high_agency": { "level": 0, "evidence": [""] }',
          "  },",
          '  "strengths_to_highlight": ["", ""],',
          '  "capabilities": ["", ""],',
          '  "hard_constraints": ["", ""],',
          '  "preferences": { "strong": ["", ""], "nice": ["", ""] },',
          '  "avoid": ["", ""],',
          '  "keywords": ["", ""],',
          '  "unknowns": ["", ""]',
          "}",
          "",
          "Tech extraction rules:",
          "- For each tech list, include up to 6 items (prefer: JavaScript, TypeScript, React/React Native, Node/Express, MongoDB/Postgres, OpenAI API, Docker, AWS, Jest/Supertest, etc.).",
          "- Each item must be present verbatim (or near-verbatim) in the payload; otherwise omit it.",
          "- level 0–5 should reflect strength implied by wording like Strong/Experienced/Used-in-production, not just mention.",
          "- Evidence snippets must be short verbatim phrases from resume_text / strengths / work_highlights.",
          "",
          "Experience extraction rules:",
          "- years_as_engineer_estimate is a rough professional SWE time range derived from any date ranges present (e.g., 2021–2022).",
          "- Use confidence 0–1 (0.2 if unclear, 0.7+ if dates are explicit).",
          "- seniority_proxy level 0–5 should reflect scope markers (ownership, shipped product, senior titles, mentorship, systems design), not just years.",
          "- Evidence snippets must be short verbatim phrases from the resume_text/strengths/work_highlights.",
          "",
          "Candidate info:",
          JSON.stringify(payload, null, 2)
        ].join("\n")
      }
    ]
  });
}
