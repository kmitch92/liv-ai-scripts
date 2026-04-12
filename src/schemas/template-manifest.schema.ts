import { z } from "zod";

export const PlaceholderSchema = z.object({
  name: z.string(),
  type: z.enum(["title", "subtitle", "body", "image", "quote", "bullets", "table"]),
  maxChars: z.number().optional().describe("Maximum character count for this placeholder"),
});

export const TemplateLayoutSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  placeholders: z.array(PlaceholderSchema),
  bestFor: z.array(z.string()).describe("Slide purposes this layout suits, e.g. 'introduction', 'comparison', 'key-point'"),
  maxBullets: z.number().optional(),
  hasImage: z.boolean(),
});

export const TemplateManifestSchema = z.object({
  layouts: z.array(TemplateLayoutSchema).min(1),
});
