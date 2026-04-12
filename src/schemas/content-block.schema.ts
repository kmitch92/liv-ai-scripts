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

const TableBlockSchema = z.object({
  type: z.literal("table"),
  headers: z.array(z.string()).min(1).max(10),
  rows: z.array(z.array(z.string()).max(10)).min(1).max(20),
});

export const ContentBlockSchema = z
  .discriminatedUnion("type", [
    BulletListBlockSchema,
    QuoteBlockSchema,
    DefinitionBlockSchema,
    CalloutBlockSchema,
    ParagraphBlockSchema,
    TableBlockSchema,
  ])
  .refine(
    (block) =>
      block.type !== "table" ||
      block.rows.every((row) => row.length === block.headers.length),
    {
      message: "Each table row must have exactly the same number of cells as there are headers",
      path: ["rows"],
    },
  );
