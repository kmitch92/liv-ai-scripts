import { z } from "zod";

export const CritiqueScoreSchema = z.object({
  contentDensity: z
    .number()
    .min(0)
    .max(10)
    .describe("How substantial is the slide content? 10 = very rich"),
  narrationAlignment: z
    .number()
    .min(0)
    .max(10)
    .describe("How well do slides reflect narration? 10 = perfect"),
  visualVariety: z
    .number()
    .min(0)
    .max(10)
    .describe("How varied are layouts? 10 = excellent variety"),
  informationHierarchy: z
    .number()
    .min(0)
    .max(10)
    .describe("How clear is the info hierarchy? 10 = very clear"),
  quoteCoverage: z
    .number()
    .min(0)
    .max(10)
    .describe("How well are source quotes used? 10 = excellent"),
});

export const CritiqueSuggestionSchema = z.object({
  slideIndex: z.number(),
  issue: z.string(),
  suggestion: z.string(),
});

export const CritiqueSchema = z.object({
  scores: CritiqueScoreSchema,
  overallScore: z.number().min(0).max(10),
  suggestions: z.array(CritiqueSuggestionSchema),
  summary: z.string(),
});
