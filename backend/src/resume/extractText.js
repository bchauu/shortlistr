import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import { normalizeSpace } from "../utils/text.js";

export async function extractResumeText({ buffer, filename, mimeType }) {
  const name = filename || "resume";
  const mime = mimeType || "";
  const ext = name.toLowerCase().split(".").pop() || "";

  let text = "";

  if (mime === "application/pdf" || ext === "pdf") {
    const data = await pdfParse(buffer);
    text = data?.text || "";
  } else if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || ext === "docx") {
    const out = await mammoth.extractRawText({ buffer });
    text = out?.value || "";
  } else {
    text = buffer.toString("utf8");
  }

  return normalizeSpace(text);
}

