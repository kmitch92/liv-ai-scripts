import { z } from "zod";

const BulletListBlockSchema = z.object({
  type: z.literal("bullet-list"),
  items: z.array(z.string()).min(1).max(6),
});

const QuoteBlockSchema = z.object({
  type: z.literal("quote"),
  text: z.string(),
  attribution: z.string().optional(),
});

const DefinitionBlockSchema = z.object({
  type: z.literal("definition"),
  term: z.string(),
  definition: z.string(),
});

const CalloutBlockSchema = z.object({
  type: z.literal("callout"),
  text: z.string(),
  style: z.enum(["tip", "warning", "exam-technique"]),
});

const ParagraphBlockSchema = z.object({
  type: z.literal("paragraph"),
  text: z.string(),
});

export const ContentBlockSchema = z.discriminatedUnion("type", [
  BulletListBlockSchema,
  QuoteBlockSchema,
  DefinitionBlockSchema,
  CalloutBlockSchema,
  ParagraphBlockSchema,
]);
