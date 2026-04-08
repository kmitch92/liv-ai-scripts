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
      expect(result.style).toBe("tip");
    });

    it("parses valid callout with warning style", () => {
      const result = ContentBlockSchema.parse({
        type: "callout",
        text: "Be careful",
        style: "warning",
      });
      expect(result.style).toBe("warning");
    });

    it("parses valid callout with exam-technique style", () => {
      const result = ContentBlockSchema.parse({
        type: "callout",
        text: "Use PEE paragraphs",
        style: "exam-technique",
      });
      expect(result.style).toBe("exam-technique");
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
