import { describe, it, expect } from "vitest";
import {
  PlaceholderSchema,
  TemplateLayoutSchema,
  TemplateManifestSchema,
} from "../template-manifest.schema.js";

const validPlaceholder = {
  name: "title",
  type: "title" as const,
};

const validLayout = {
  id: "intro-layout",
  name: "Introduction",
  description: "A standard introduction slide layout",
  placeholders: [validPlaceholder],
  bestFor: ["introduction", "overview"],
  hasImage: false,
};

describe("PlaceholderSchema", () => {
  it("parses valid placeholder without maxChars", () => {
    const result = PlaceholderSchema.parse(validPlaceholder);
    expect(result).toEqual({ name: "title", type: "title" });
  });

  it("parses valid placeholder with maxChars", () => {
    const result = PlaceholderSchema.parse({
      ...validPlaceholder,
      maxChars: 100,
    });
    expect(result.maxChars).toBe(100);
  });

  it("accepts all valid placeholder types", () => {
    const validTypes = ["title", "subtitle", "body", "image", "quote", "bullets"];
    for (const type of validTypes) {
      const result = PlaceholderSchema.safeParse({ name: "test", type });
      expect(result.success).toBe(true);
    }
  });

  it("accepts table placeholder type", () => {
    const result = PlaceholderSchema.safeParse({
      name: "comparisonTable",
      type: "table",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid placeholder type", () => {
    const result = PlaceholderSchema.safeParse({
      name: "test",
      type: "header",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown placeholder type 'chart' (guard against enum loosening)", () => {
    const result = PlaceholderSchema.safeParse({
      name: "test",
      type: "chart",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing name field", () => {
    const result = PlaceholderSchema.safeParse({ type: "title" });
    expect(result.success).toBe(false);
  });
});

describe("TemplateLayoutSchema", () => {
  it("parses valid layout without optional fields", () => {
    const result = TemplateLayoutSchema.parse(validLayout);
    expect(result.id).toBe("intro-layout");
    expect(result.maxBullets).toBeUndefined();
  });

  it("parses valid layout with maxBullets", () => {
    const result = TemplateLayoutSchema.parse({
      ...validLayout,
      maxBullets: 4,
    });
    expect(result.maxBullets).toBe(4);
  });

  it("rejects missing required fields", () => {
    const result = TemplateLayoutSchema.safeParse({
      id: "test",
    });
    expect(result.success).toBe(false);
  });
});

describe("TemplateManifestSchema", () => {
  it("parses valid manifest with multiple layouts", () => {
    const secondLayout = {
      ...validLayout,
      id: "quote-layout",
      name: "Quote Focus",
      description: "Layout emphasising a key quote",
      bestFor: ["quote", "key-point"],
      hasImage: true,
    };
    const result = TemplateManifestSchema.parse({
      layouts: [validLayout, secondLayout],
    });
    expect(result.layouts).toHaveLength(2);
  });

  it("rejects empty layouts array", () => {
    const result = TemplateManifestSchema.safeParse({
      layouts: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing layouts field", () => {
    const result = TemplateManifestSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
