import { z } from "zod";

export const SlideSchema = z.object({
  slideTitle: z.string(),
  narration: z.string(),
  bulletPoints: z.array(z.string()).min(1).max(6),
  keyQuote: z.string().optional().describe("A key quote or line from the source material to display prominently"),
  subheading: z.string().optional().describe("A short subheading or contextual line under the title"),
  layoutStyle: z.enum(["standard", "quote-focus", "full-image", "two-column", "key-point"]).default("standard").describe("Visual layout style for this slide"),
  imageQuery: z.string(),
  durationSeconds: z.number().min(10).max(180),
});

export const PresentationSchema = z.object({
  title: z.string(),
  slides: z.array(SlideSchema).min(3).max(25),
  totalDurationSeconds: z.number(),
});
