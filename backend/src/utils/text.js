export function nowIso() {
  return new Date().toISOString();
}

export function normalizeSpace(s) {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function truncate(s, maxChars) {
  const t = normalizeSpace(s);
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars) + "\n\n[truncated]";
}

