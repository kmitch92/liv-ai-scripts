import { describe, it, expect } from "vitest";
import { ContentBlockSchema } from "../content-block.schema.js";

describe("ContentBlockSchema", () => {
  describe("bullet-list variant", () => {
    it("parses valid bullet-list block", () => {
      const result = ContentBlockSchema.parse({
        type: "bullet-list",
        items: ["first", "second", "third"],
      });
      expect(result).toEqual({
        type: "bullet-list",
        items: ["first", "second", "third"],
      });
    });

    it("rejects empty items array", () => {
      const result = ContentBlockSchema.safeParse({
        type: "bullet-list",
        items: [],
      });
      expect(result.success).toBe(false);
    });

    it("rejects more than 6 items", () => {
      const result = ContentBlockSchema.safeParse({
        type: "bullet-list",
        items: ["a", "b", "c", "d", "e", "f", "g"],
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing items field", () => {
      const result = ContentBlockSchema.safeParse({
        type: "bullet-list",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("quote variant", () => {
    it("parses valid quote block with attribution", () => {
      const result = ContentBlockSchema.parse({
        type: "quote",
        text: "To be or not to be",
        attribution: "Shakespeare",
      });
      expect(result).toEqual({
        type: "quote",
        text: "To be or not to be",
        attribution: "Shakespeare",
      });
    });

    it("parses valid quote block without attribution", () => {
      const result = ContentBlockSchema.parse({
        type: "quote",
        text: "Some wise words",
      });
      expect(result).toEqual({
        type: "quote",
        text: "Some wise words",
      });
    });

    it("rejects missing text field", () => {
      const result = ContentBlockSchema.safeParse({
        type: "quote",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("definition variant", () => {
    it("parses valid definition block", () => {
      const result = ContentBlockSchema.parse({
        type: "definition",
        term: "Alliteration",
        definition: "Repetition of initial consonant sounds",
      });
      expect(result).toEqual({
        type: "definition",
        term: "Alliteration",
        definition: "Repetition of initial consonant sounds",
      });
    });

    it("rejects missing term field", () => {
      const result = ContentBlockSchema.safeParse({
        type: "definition",
        definition: "Some definition",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing definition field", () => {
      const result = ContentBlockSchema.safeParse({
        type: "definition",
        term: "Some term",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("callout variant", () => {
    it("parses valid callout with tip style", () => {
      const result = ContentBlockSchema.parse({
        type: "callout",
        text: "Remember this",
        style: "tip",
      });
      expect(result).toMatchObject({ type: "callout", style: "tip" });
    });

    it("parses valid callout with warning style", () => {
      const result = ContentBlockSchema.parse({
        type: "callout",
        text: "Be careful",
        style: "warning",
      });
      expect(result).toMatchObject({ type: "callout", style: "warning" });
    });

    it("parses valid callout with exam-technique style", () => {
      const result = ContentBlockSchema.parse({
        type: "callout",
        text: "Use PEE paragraphs",
        style: "exam-technique",
      });
      expect(result).toMatchObject({ type: "callout", style: "exam-technique" });
    });

    it("rejects invalid style value", () => {
      const result = ContentBlockSchema.safeParse({
        type: "callout",
        text: "Some text",
        style: "info",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing style field", () => {
      const result = ContentBlockSchema.safeParse({
        type: "callout",
        text: "Some text",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("paragraph variant", () => {
    it("parses valid paragraph block", () => {
      const result = ContentBlockSchema.parse({
        type: "paragraph",
        text: "A paragraph of explanatory text.",
      });
      expect(result).toEqual({
        type: "paragraph",
        text: "A paragraph of explanatory text.",
      });
    });

    it("rejects missing text field", () => {
      const result = ContentBlockSchema.safeParse({
        type: "paragraph",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("table variant", () => {
    it("parses valid table with headers and matching rows", () => {
      const result = ContentBlockSchema.parse({
        type: "table",
        headers: ["Device", "Effect"],
        rows: [
          ["Alliteration", "Creates emphasis"],
          ["Metaphor", "Creates imagery"],
        ],
      });
      expect(result).toEqual({
        type: "table",
        headers: ["Device", "Effect"],
        rows: [
          ["Alliteration", "Creates emphasis"],
          ["Metaphor", "Creates imagery"],
        ],
      });
    });

    it("rejects empty headers array", () => {
      const result = ContentBlockSchema.safeParse({
        type: "table",
        headers: [],
        rows: [["a"]],
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty rows array", () => {
      const result = ContentBlockSchema.safeParse({
        type: "table",
        headers: ["Device"],
        rows: [],
      });
      expect(result.success).toBe(false);
    });

    it("rejects more than 10 headers", () => {
      const headers = Array.from({ length: 11 }, (_, i) => `H${i}`);
      const row = Array.from({ length: 11 }, (_, i) => `c${i}`);
      const result = ContentBlockSchema.safeParse({
        type: "table",
        headers,
        rows: [row],
      });
      expect(result.success).toBe(false);
    });

    it("rejects more than 20 rows", () => {
      const rows = Array.from({ length: 21 }, () => ["x"]);
      const result = ContentBlockSchema.safeParse({
        type: "table",
        headers: ["H"],
        rows,
      });
      expect(result.success).toBe(false);
    });

    it("rejects more than 10 cells in a row", () => {
      const headers = Array.from({ length: 10 }, (_, i) => `H${i}`);
      const tooWideRow = Array.from({ length: 11 }, (_, i) => `c${i}`);
      const result = ContentBlockSchema.safeParse({
        type: "table",
        headers,
        rows: [tooWideRow],
      });
      expect(result.success).toBe(false);
    });

    it("rejects row whose cell count does not equal headers length", () => {
      const result = ContentBlockSchema.safeParse({
        type: "table",
        headers: ["A", "B", "C"],
        rows: [
          ["1", "2", "3"],
          ["1", "2"],
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const rowsIssue = result.error.issues.find((issue) =>
          issue.path.includes("rows"),
        );
        expect(rowsIssue).toBeDefined();
        expect(rowsIssue?.message).toMatch(
          /same number of cells as there are headers/i,
        );
      }
    });

    it("parses valid table alongside other variants in an array", () => {
      const blocks = [
        { type: "paragraph" as const, text: "Intro" },
        {
          type: "table" as const,
          headers: ["Term", "Meaning"],
          rows: [["Simile", "Comparison using like/as"]],
        },
        { type: "bullet-list" as const, items: ["first", "second"] },
      ];
      const results = blocks.map((block) => ContentBlockSchema.safeParse(block));
      expect(results.every((r) => r.success)).toBe(true);
    });
  });

  describe("discriminated union behaviour", () => {
    it("rejects invalid type string", () => {
      const result = ContentBlockSchema.safeParse({
        type: "invalid-type",
        text: "some text",
      });
      expect(result.success).toBe(false);
    });

    it("rejects object with missing type field", () => {
      const result = ContentBlockSchema.safeParse({
        text: "some text",
      });
      expect(result.success).toBe(false);
    });

    it("selects correct variant and validates its fields", () => {
      const quoteWithItems = ContentBlockSchema.safeParse({
        type: "quote",
        items: ["not", "valid", "for", "quote"],
      });
      expect(quoteWithItems.success).toBe(false);
    });
  });
});
