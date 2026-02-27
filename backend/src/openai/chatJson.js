import crypto from "node:crypto";
import { safeJsonParse } from "../utils/json.js";

const OPENAI_DEBUG = /^(1|true|yes)$/i.test(String(process.env.OPENAI_DEBUG || process.env.DEBUG_OPENAI || ""));

function sha8(s) {
  return crypto.createHash("sha256").update(String(s || "")).digest("hex").slice(0, 8);
}

function preview(s, { head = 260, tail = 180 } = {}) {
  const t = String(s || "").replace(/\r/g, "");
  if (t.length <= head + tail + 10) return t;
  const start = t.slice(0, head);
  const end = t.slice(-tail);
  return `${start}\n…\n${end}`;
}

async function readTextSafe(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

export async function openaiChatJson({ apiKey, model, messages, temperature = 0, maxTokens = 900, name = "" }) {
  const tag = String(name || "").trim();
  const attempts = 2;

  const baseBody = {
    model,
    temperature,
    top_p: 1,
    max_tokens: maxTokens,
    // Strongly encourage strict JSON from the API when supported.
    response_format: { type: "json_object" },
    messages
  };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const isRetry = attempt > 1;
    const body = {
      ...baseBody,
      max_tokens: baseBody.max_tokens,
      messages: baseBody.messages
    };

    // Retry strategy:
    // - If we retry, append a strict "JSON only" reminder.
    // - If we hit truncation, bump max_tokens for the retry.
    if (isRetry) {
      body.messages = [
        ...messages,
        {
          role: "user",
          content: "Your previous response was not valid JSON. Return ONLY a valid JSON object that matches the requested shape. No markdown, no backticks."
        }
      ];
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    // Some models/environments might not support `response_format` in chat.completions yet.
    if (!res.ok) {
      const t = await readTextSafe(res);
      const isRespFormatError =
        res.status === 400 && /response_format/i.test(t) && attempt === 1;
      if (isRespFormatError) {
        console.warn("[openaiChatJson] response_format_unsupported", tag || "unknown", t.slice(0, 160));
        // Retry once without response_format.
        delete baseBody.response_format;
        continue;
      }
      throw new Error(`OpenAI failed${tag ? ` (${tag})` : ""} (${res.status}): ${t.slice(0, 250)}`);
    }

    const data = await res.json();
    const choice = data?.choices?.[0] || {};
    const finishReason = String(choice?.finish_reason || "");
    const content = choice?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error(`OpenAI response missing content${tag ? ` (${tag})` : ""}.`);
    }

    const parsed = safeJsonParse(content);
    const fingerprint = sha8(content);
    const usage = data?.usage && typeof data.usage === "object" ? data.usage : null;
    const usageLabel = usage
      ? `pt=${Number(usage.prompt_tokens) || 0} ct=${Number(usage.completion_tokens) || 0} tt=${Number(usage.total_tokens) || 0}`
      : "";

    if (parsed.ok) {
      if (OPENAI_DEBUG) {
        const keys =
          parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value) ? Object.keys(parsed.value).slice(0, 14) : [];
        console.log(
          "[openaiChatJson] ok",
          tag || "unknown",
          `attempt=${attempt}/${attempts}`,
          `finish=${finishReason || "unknown"}`,
          usageLabel,
          `len=${content.length}`,
          `sha=${fingerprint}`,
          keys.length ? `keys=${keys.join(",")}` : ""
        );
      }
      return parsed.value;
    }
    console.warn(
      "[openaiChatJson] parse_failed",
      tag || "unknown",
      `attempt=${attempt}/${attempts}`,
      `finish=${finishReason || "unknown"}`,
      usageLabel,
      `len=${content.length}`,
      `sha=${fingerprint}`,
      parsed && typeof parsed === "object" && "error" in parsed && parsed.error ? `err=${String(parsed.error).slice(0, 140)}` : ""
    );
    if (OPENAI_DEBUG) {
      console.warn("[openaiChatJson] raw", tag || "unknown", "\n" + preview(content));
    }

    // If OpenAI truncated the output, bump max_tokens and retry once.
    if (!isRetry && finishReason === "length") {
      baseBody.max_tokens = Math.min(4000, Math.max(maxTokens * 2, maxTokens + 800));
      continue;
    }
  }

  throw new Error(`Could not parse JSON from OpenAI response${tag ? ` (${tag})` : ""}.`);
}
