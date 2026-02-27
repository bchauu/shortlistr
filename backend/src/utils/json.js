export function safeJsonParse(text) {
  const raw = String(text || "");
  const trimmed = raw.trim();

  // Handle common "```json ... ```" wrappers.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    try {
      return { ok: true, value: JSON.parse(fenced[1]) };
    } catch (e) {
      // fall through to other strategies
    }
  }

  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (e) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return { ok: true, value: JSON.parse(trimmed.slice(start, end + 1)) };
      } catch (e2) {
        return { ok: false, error: e2 instanceof Error ? e2.message : String(e2 || "") };
      }
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e || "") };
  }
}
