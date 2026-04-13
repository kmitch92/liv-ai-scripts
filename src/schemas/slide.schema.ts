import { z } from "zod";
import { ContentBlockSchema } from "./content-block.schema.js";

export const DesignMetadataSchema = z.object({
  whitespaceRatio: z.number().describe("Ratio of empty space to content area (0-1)"),
  contrastScore: z.number().describe("Text-to-background contrast score"),
  textDensity: z.number().describe("Characters per visual unit area"),
  violations: z.array(z.string()).describe("Design constraint violations detected"),
});

export const SlideSchema = z.object({
  slideTitle: z.string(),
  narration: z.string(),
  bulletPoints: z.array(z.string()).min(1).max(6),
  keyQuote: z.string().optional().describe("A key quote or line from the source material to display prominently"),
  subheading: z.string().optional().describe("A short subheading or contextual line under the title"),
  layoutStyle: z.enum(["standard", "quote-focus", "full-image", "two-column", "key-point"]).default("standard").describe("Visual layout style for this slide"),
  imageQuery: z.string(),
  durationSeconds: z.number().min(10).max(180),
  narrativeNotes: z.string().optional().describe("Internal notes from narration stage, not rendered on slide"),
  contentBlocks: z.array(ContentBlockSchema).optional().describe("Typed content blocks replacing unstructured bullet points"),
  templateLayoutId: z.string().optional().describe("References a named layout in the template manifest"),
  imageConcept: z.string().optional().describe("Rich image description including mood, composition, and palette"),
  designMetadata: DesignMetadataSchema.optional().describe("Constraint validation results from design analysis"),
});

export const PresentationSchema = z.object({
  title: z.string(),
  slides: z.array(SlideSchema).min(3).max(30),
  totalDurationSeconds: z.number(),
  narrativeArc: z.string().optional().describe("Summary of the pedagogical flow across all slides"),
});
