import { z } from "zod";

export const AnalyzeSchema = z.object({
  model: z.string().optional(),
  tzOffsetMinutes: z.number().optional(),
  job: z
    .object({
      source: z.string().optional(),
      url: z.string().optional(),
      title: z.string().optional(),
      company: z.string().optional(),
      location: z.string().optional(),
      description: z.string().optional(),
      descriptionCandidates: z
        .array(
          z.object({
            id: z.string().optional(),
            label: z.string().optional(),
            source: z.string().optional(),
            selector: z.string().optional(),
            text: z.string().optional()
          })
        )
        .optional()
    })
    .default({}),
  profile: z
    .object({
      lookingFor: z.string().optional(),
      strengths: z.string().optional(),
      workHighlights: z.string().optional(),
      mustHaves: z.string().optional(),
      niceToHaves: z.string().optional(),
      avoid: z.string().optional()
    })
    .default({}),
  resumeText: z.string().optional()
});
