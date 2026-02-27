import { truncate } from "../utils/text.js";
import { openaiChatJson } from "../openai/chatJson.js";

export async function agentExtractJob({ apiKey, model, job }) {
  const payload = {
    source: job.source || "",
    url: job.url || "",
    title: job.title || "",
    company: job.company || "",
    location: job.location || "",
    description: truncate(job.description || "", 14000)
  };

  return openaiChatJson({
    apiKey,
    name: "jobExtractor",
    model,
    temperature: 0,
    maxTokens: 1050,
    messages: [
      {
        role: "system",
        content:
          [
            "You are a job-post extractor agent for Shortlistr.",
            "Return ONLY JSON (no markdown, no backticks).",
            "",
            "Rules:",
            "- Be evidence-based: only use information present in the provided job post payload.",
            "- Do NOT invent requirements or infer company details that aren't in the text.",
            "- Distinguish between explicit requirements (hard_requirements / must_haves) and implied signals (implied_success_profile).",
            "- role_archetype must be based on responsibilities, not the title.",
            "- For each signal: choose level 0–5 and include 1–3 short evidence snippets (verbatim phrases).",
            "- For implied_company_needs: infer the underlying problems the role is likely solving, but keep it grounded in the posting language. Include confidence 0–1 + evidence snippets.",
            "- Keep lists short and high-signal."
          ].join("\n")
      },
      {
        role: "user",
        content: [
          "Return JSON with keys:",
          "{",
          '  "role_summary": "",',
          '  "role_archetype": "",',
          '  "coding_intensity": 0,',
          '  "consulting_intensity": 0,',
          '  "seniority": "",',
          '  "location_mode": "",',
          '  "company_context": {',
          '    "stage": "unknown",',
          '    "size": "unknown",',
          '    "sector": "unknown",',
          '    "motion": "unknown"',
          "  },",
          '  "signals": {',
          '    "llm_or_ai": { "level": 0, "evidence": [""] },',
          '    "integrations_data_pipelines": { "level": 0, "evidence": [""] },',
          '    "enterprise_systems": { "level": 0, "evidence": [""] },',
          '    "customer_facing_delivery": { "level": 0, "evidence": [""] },',
          '    "change_management_adoption": { "level": 0, "evidence": [""] }',
          "  },",
          '  "responsibilities": ["", ""],',
          '  "hard_requirements": ["", ""],',
          '  "must_haves": ["", ""],',
          '  "nice_to_haves": ["", ""],',
          '  "keywords": ["", ""],',
          '  "fuzzy_role_interpretation": "",',
          '  "implied_success_profile": ["", ""],',
          '  "implied_company_needs": [',
          '    { "need": "", "confidence": 0, "evidence": [""] }',
          "  ],",
          '  "red_flags": ["", ""],',
          '  "unknowns": ["", ""]',
          "}",
          "",
          "Notes:",
          '- role_archetype should be one of: "hands_on_builder", "consulting_transformation", "pre_sales", "implementation", "other".',
          "- coding_intensity: 0–5 (0 = almost no coding, 5 = heavy hands-on coding).",
          "- consulting_intensity: 0–5 (0 = none, 5 = very consulting/change-management heavy).",
          "- company_context rules: ONLY fill fields if the posting explicitly indicates them; otherwise keep as \"unknown\". Do not guess.",
          "  - stage: one of [unknown, seed, series_a, series_b, series_c, public, enterprise, nonprofit, gov, other]",
          "  - size: one of [unknown, 1-20, 21-100, 101-500, 501-2000, 2000+, other]",
          "  - sector: one of [unknown, b2b_saas, consumer, fintech, health, gov, marketplace, infra, other]",
          "  - motion: one of [unknown, product_engineering, enterprise_delivery, consulting_transformation, pre_sales, implementation, other]",
          "- hard_requirements are explicit background/credential asks or hard constraints (e.g., ex-consulting requirement, security clearance, domain license, specific location/visa constraint).",
          "- Do NOT put common tech skills (JavaScript/TypeScript/React/Node/AWS/etc.) into hard_requirements; those belong in must_haves unless the posting frames them as a strict credential/constraint.",
          "- implied_company_needs rules: 2–5 items. Each need is a concise, real-world problem statement (not a buzzword). Confidence is 0–1. Evidence snippets must be short verbatim phrases from the posting.",
          "",
          "Job post:",
          JSON.stringify(payload, null, 2)
        ].join("\n")
      }
    ]
  });
}
