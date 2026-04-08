import { describe, it, expect } from "vitest";
import {
  SlideSchema,
  PresentationSchema,
  DesignMetadataSchema,
} from "../slide.schema.js";

const minimalSlide = {
  slideTitle: "Introduction",
  narration: "Welcome to this presentation.",
  bulletPoints: ["Point one", "Point two"],
  imageQuery: "classroom learning",
  durationSeconds: 30,
};

const minimalPresentation = {
  title: "Test Presentation",
  slides: [
    { ...minimalSlide, slideTitle: "Slide 1" },
    { ...minimalSlide, slideTitle: "Slide 2" },
    { ...minimalSlide, slideTitle: "Slide 3" },
  ],
  totalDurationSeconds: 90,
};

describe("SlideSchema", () => {
  describe("backwards compatibility", () => {
    it("parses existing slide data without new optional fields", () => {
      const result = SlideSchema.parse(minimalSlide);
      expect(result.slideTitle).toBe("Introduction");
      expect(result.narrativeNotes).toBeUndefined();
      expect(result.contentBlocks).toBeUndefined();
      expect(result.templateLayoutId).toBeUndefined();
      expect(result.imageConcept).toBeUndefined();
      expect(result.designMetadata).toBeUndefined();
    });

    it("parses slide with only bulletPoints and no contentBlocks", () => {
      const result = SlideSchema.parse(minimalSlide);
      expect(result.bulletPoints).toEqual(["Point one", "Point two"]);
      expect(result.contentBlocks).toBeUndefined();
    });

    it("parses slide with only layoutStyle and no templateLayoutId", () => {
      const result = SlideSchema.parse({
        ...minimalSlide,
        layoutStyle: "quote-focus",
      });
      expect(result.layoutStyle).toBe("quote-focus");
      expect(result.templateLayoutId).toBeUndefined();
    });
  });

  describe("new optional fields", () => {
    it("parses slide with all new optional fields", () => {
      const result = SlideSchema.parse({
        ...minimalSlide,
        narrativeNotes: "Transition from intro to main point",
        contentBlocks: [
          { type: "paragraph", text: "An introductory paragraph" },
        ],
        templateLayoutId: "intro-layout",
        imageConcept: "warm classroom scene with students engaged",
        designMetadata: {
          whitespaceRatio: 0.4,
          contrastScore: 7.5,
          textDensity: 120,
          violations: [],
        },
      });
      expect(result.narrativeNotes).toBe("Transition from intro to main point");
      expect(result.templateLayoutId).toBe("intro-layout");
      expect(result.imageConcept).toBe("warm classroom scene with students engaged");
      expect(result.designMetadata?.whitespaceRatio).toBe(0.4);
    });

    it("parses slide with contentBlocks containing mixed block types", () => {
      const result = SlideSchema.parse({
        ...minimalSlide,
        contentBlocks: [
          { type: "paragraph", text: "Introduction text" },
          { type: "bullet-list", items: ["item 1", "item 2"] },
          { type: "quote", text: "A famous quote", attribution: "Author" },
          { type: "definition", term: "Key Term", definition: "Its meaning" },
          { type: "callout", text: "Watch out", style: "warning" },
        ],
      });
      expect(result.contentBlocks).toHaveLength(5);
    });

    it("parses slide with both bulletPoints and contentBlocks", () => {
      const result = SlideSchema.parse({
        ...minimalSlide,
        contentBlocks: [
          { type: "paragraph", text: "Extra structured content" },
        ],
      });
      expect(result.bulletPoints).toHaveLength(2);
      expect(result.contentBlocks).toHaveLength(1);
    });

    it("parses slide with templateLayoutId set", () => {
      const result = SlideSchema.parse({
        ...minimalSlide,
        templateLayoutId: "two-col-layout",
      });
      expect(result.templateLayoutId).toBe("two-col-layout");
    });
  });

  describe("layoutStyle default", () => {
    it("defaults layoutStyle to standard when omitted", () => {
      const result = SlideSchema.parse(minimalSlide);
      expect(result.layoutStyle).toBe("standard");
    });
  });
});

describe("DesignMetadataSchema", () => {
  it("parses valid design metadata", () => {
    const result = DesignMetadataSchema.parse({
      whitespaceRatio: 0.35,
      contrastScore: 8.2,
      textDensity: 95,
      violations: ["text too small"],
    });
    expect(result.violations).toEqual(["text too small"]);
  });

  it("parses design metadata with empty violations array", () => {
    const result = DesignMetadataSchema.parse({
      whitespaceRatio: 0.5,
      contrastScore: 7.0,
      textDensity: 80,
      violations: [],
    });
    expect(result.violations).toHaveLength(0);
  });

  it("rejects missing whitespaceRatio", () => {
    const result = DesignMetadataSchema.safeParse({
      contrastScore: 7.0,
      textDensity: 80,
      violations: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing contrastScore", () => {
    const result = DesignMetadataSchema.safeParse({
      whitespaceRatio: 0.5,
      textDensity: 80,
      violations: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing violations", () => {
    const result = DesignMetadataSchema.safeParse({
      whitespaceRatio: 0.5,
      contrastScore: 7.0,
      textDensity: 80,
    });
    expect(result.success).toBe(false);
  });
});

describe("PresentationSchema", () => {
  it("parses valid presentation without narrativeArc", () => {
    const result = PresentationSchema.parse(minimalPresentation);
    expect(result.title).toBe("Test Presentation");
    expect(result.slides).toHaveLength(3);
    expect(result.narrativeArc).toBeUndefined();
  });

  it("parses valid presentation with narrativeArc", () => {
    const result = PresentationSchema.parse({
      ...minimalPresentation,
      narrativeArc: "Introduction -> Core concepts -> Application -> Summary",
    });
    expect(result.narrativeArc).toBe(
      "Introduction -> Core concepts -> Application -> Summary"
    );
  });

  it("rejects presentation with fewer than 3 slides", () => {
    const result = PresentationSchema.safeParse({
      ...minimalPresentation,
      slides: [minimalSlide, minimalSlide],
    });
    expect(result.success).toBe(false);
  });
});
