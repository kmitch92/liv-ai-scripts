import { z } from "zod";

export const SlideSchema = z.object({
  slideTitle: z.string(),
  narration: z.string(),
  bulletPoints: z.array(z.string()).min(1).max(6),
  imageQuery: z.string(),
  durationSeconds: z.number().min(10).max(180),
});

export const PresentationSchema = z.object({
  title: z.string(),
  slides: z.array(SlideSchema).min(3).max(25),
  totalDurationSeconds: z.number(),
});
