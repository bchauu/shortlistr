import { truncate } from "./text.js";

const MAX_JOB_DESCRIPTION_CHARS = 16000;

export function normalizeUrl(url) {
  try {
    const u = new URL(String(url || ""));
    u.hash = "";
    const dropParams = [
      "trk",
      "trkInfo",
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
    return String(url || "");
  }
}

export function shortlistKeyForJob(job = {}) {
  const url = normalizeUrl(job.url || "");
  return url || `${job.source || "unknown"}:${job.title || ""}:${job.company || ""}`.slice(0, 300);
}

export function sanitizeJobForStorage(job = {}) {
  const storedJob = { ...job, url: normalizeUrl(job.url || "") };
  if (storedJob.descriptionCandidates) delete storedJob.descriptionCandidates;
  if (typeof storedJob.description === "string" && storedJob.description.length > MAX_JOB_DESCRIPTION_CHARS) {
    storedJob.description = truncate(storedJob.description, MAX_JOB_DESCRIPTION_CHARS);
  }
  return storedJob;
}
