import { z } from "zod";

export const NarrationSectionSchema = z.object({
  sectionLabel: z
    .string()
    .describe(
      "Short label for this section, e.g. 'Introduction', 'Lines 1-4', 'Key Themes'",
    ),
  narration: z
    .string()
    .describe("The full spoken script for this section"),
  durationSeconds: z
    .number()
    .min(10)
    .max(180)
    .describe("Estimated spoken duration in seconds"),
});

export const NarrationScriptSchema = z.object({
  title: z.string().describe("Presentation title"),
  narrativeArc: z
    .string()
    .describe(
      "Summary of the pedagogical flow across all sections",
    ),
  sections: z.array(NarrationSectionSchema).min(3).max(25),
  totalDurationSeconds: z
    .number()
    .describe("Sum of all section durations"),
});
