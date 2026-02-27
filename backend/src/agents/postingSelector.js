import { truncate } from "../utils/text.js";
import { openaiChatJson } from "../openai/chatJson.js";

function normalizeCandidates(candidates) {
  const arr = Array.isArray(candidates) ? candidates : [];
  return arr
    .map((c, idx) => ({
      id: String(c?.id || `c${idx}`),
      label: String(c?.label || ""),
      source: String(c?.source || ""),
      selector: String(c?.selector || ""),
      text: truncate(String(c?.text || ""), 9000)
    }))
    .filter((c) => c.text.length >= 80);
}

export async function agentSelectJobText({ apiKey, model, jobMeta, descriptionCandidates }) {
  const candidates = normalizeCandidates(descriptionCandidates);
  if (candidates.length === 0) {
    return { job_post_text: "", selected_candidate_ids: [], confidence: 0, notes: "No candidates provided." };
  }

  const meta = {
    source: jobMeta?.source || "",
    url: jobMeta?.url || "",
    title: jobMeta?.title || "",
    company: jobMeta?.company || "",
    location: jobMeta?.location || ""
  };

  const payload = {
    meta,
    candidates: candidates.map((c) => ({
      id: c.id,
      label: c.label,
      source: c.source,
      selector: c.selector,
      length: c.text.length,
      text: c.text
    }))
  };

  return openaiChatJson({
    apiKey,
    name: "postingSelector",
    model,
    temperature: 0,
    maxTokens: 700,
    messages: [
      {
        role: "system",
        content:
          "You are a job-post text selector agent for Shortlistr. Return ONLY JSON. Choose which extracted block(s) are the actual job posting content, including role overview, responsibilities, requirements/qualifications, and any 'About the company' / benefits / culture section written on the listing page. Ignore nav, sidebars, comments, trackers, and unrelated text. If the posting is split across multiple blocks, merge them into one clean job_post_text."
      },
      {
        role: "user",
        content: [
          "Return ONLY JSON with keys:",
          "{",
          '  "selected_candidate_ids": ["..."],',
          '  "job_post_text": "",',
          '  "confidence": 0,',
          '  "notes": ""',
          "}",
          "",
          "Guidance:",
          "- Prefer selecting candidate IDs (and keep them minimal) over rewriting.",
          "- If you include job_post_text, keep it close to the source and include all key sections (responsibilities, requirements, about company, benefits) when present.",
          "",
          "Input:",
          JSON.stringify(payload, null, 2)
        ].join("\n")
      }
    ]
  });
}
