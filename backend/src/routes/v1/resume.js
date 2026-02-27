import { extractResumeText } from "../../resume/extractText.js";

export async function resumeExtractHandler(req, res) {
  const f = req.file;
  if (!f) {
    res.status(400).json({ error: "Missing file." });
    return;
  }

  try {
    console.log(
      "[resume] extract start",
      `name=${f.originalname || "resume"}`,
      `bytes=${f.size || 0}`,
      `type=${f.mimetype || ""}`
    );
    const text = await extractResumeText({
      buffer: f.buffer,
      filename: f.originalname || "resume",
      mimeType: f.mimetype || ""
    });

    if (!text) {
      res.status(400).json({ error: "Could not extract text from resume." });
      return;
    }

    console.log("[resume] extract ok", `chars=${text.length}`);
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
