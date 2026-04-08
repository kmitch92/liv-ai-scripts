import { describe, it, expect } from "vitest";
import type { Slide } from "../../../types/index.js";
import type { DesignContext, DesignRule } from "../types.js";
import { layoutVariety } from "../rules/layout-variety.js";
import { bulletDensity } from "../rules/bullet-density.js";
import { textDensity } from "../rules/text-density.js";
import { contrastRatio } from "../rules/contrast-ratio.js";
import { whitespaceEstimate } from "../rules/whitespace-estimate.js";
import { allRules } from "../index.js";

function makeSlide(overrides?: Partial<Slide>): Slide {
  return {
    slideTitle: "Test Slide",
    narration: "Test narration text",
    bulletPoints: ["Point one", "Point two", "Point three"],
    layoutStyle: "standard",
    imageQuery: "test image",
    durationSeconds: 60,
    ...overrides,
  };
}

function makeContext(overrides?: Partial<DesignContext>): DesignContext {
  return {
    slideWidth: 13.333,
    slideHeight: 7.5,
    colors: {
      primary: "#1B3A4B",
      secondary: "#3A7CA5",
      background: "#FFFFFF",
      text: "#1A2E35",
    },
    fonts: { heading: "Arial", body: "Calibri" },
    slideIndex: 1,
    totalSlides: 10,
    precedingLayouts: ["standard"],
    followingLayouts: ["quote-focus"],
    ...overrides,
  };
}

describe("layoutVariety", () => {
  it("has correct rule metadata", () => {
    expect(layoutVariety.id).toBe("layout-variety");
    expect(layoutVariety.category).toBe("composition");
    expect(typeof layoutVariety.validate).toBe("function");
    expect(typeof layoutVariety.fix).toBe("function");
  });

  describe("validate", () => {
    it("returns no violations when layout differs from preceding slides", () => {
      const slide = makeSlide({ layoutStyle: "quote-focus" });
      const context = makeContext({
        precedingLayouts: ["standard", "two-column"],
      });

      const violations = layoutVariety.validate(slide, context);

      expect(violations).toEqual([]);
    });

    it("returns a warning when 2+ preceding slides share the same layout as current", () => {
      const slide = makeSlide({ layoutStyle: "standard" });
      const context = makeContext({
        precedingLayouts: ["standard", "standard"],
        slideIndex: 2,
      });

      const violations = layoutVariety.validate(slide, context);

      expect(violations).toHaveLength(1);
      expect(violations[0].ruleId).toBe("layout-variety");
      expect(violations[0].severity).toBe("warning");
      expect(violations[0].slideIndex).toBe(2);
    });

    it("returns no violations for the first slide with no preceding layouts", () => {
      const slide = makeSlide({ layoutStyle: "standard" });
      const context = makeContext({
        precedingLayouts: [],
        slideIndex: 0,
      });

      const violations = layoutVariety.validate(slide, context);

      expect(violations).toEqual([]);
    });

    it("returns no violations when only 1 preceding slide has the same layout", () => {
      const slide = makeSlide({ layoutStyle: "standard" });
      const context = makeContext({
        precedingLayouts: ["standard"],
        slideIndex: 1,
      });

      const violations = layoutVariety.validate(slide, context);

      expect(violations).toEqual([]);
    });
  });

  describe("fix", () => {
    it("returns a slide with a different layoutStyle from the repeated ones", () => {
      const slide = makeSlide({ layoutStyle: "standard" });
      const context = makeContext({
        precedingLayouts: ["standard", "standard"],
        slideIndex: 2,
      });

      const fixed = layoutVariety.fix!(slide, context);

      expect(fixed.layoutStyle).not.toBe("standard");
      expect(["quote-focus", "full-image", "two-column", "key-point"]).toContain(
        fixed.layoutStyle,
      );
    });
  });
});

describe("bulletDensity", () => {
  it("has correct rule metadata", () => {
    expect(bulletDensity.id).toBe("bullet-density");
    expect(bulletDensity.category).toBe("typography");
    expect(typeof bulletDensity.validate).toBe("function");
    expect(typeof bulletDensity.fix).toBe("function");
  });

  describe("validate", () => {
    it("returns no violations for 3 bullets", () => {
      const slide = makeSlide({
        bulletPoints: ["One", "Two", "Three"],
      });
      const context = makeContext();

      const violations = bulletDensity.validate(slide, context);

      expect(violations).toEqual([]);
    });

    it("returns no violations for exactly 5 bullets", () => {
      const slide = makeSlide({
        bulletPoints: ["One", "Two", "Three", "Four", "Five"],
      });
      const context = makeContext();

      const violations = bulletDensity.validate(slide, context);

      expect(violations).toEqual([]);
    });

    it("returns a warning for 6 bullets", () => {
      const slide = makeSlide({
        bulletPoints: ["One", "Two", "Three", "Four", "Five", "Six"],
      });
      const context = makeContext();

      const violations = bulletDensity.validate(slide, context);

      expect(violations).toHaveLength(1);
      expect(violations[0].ruleId).toBe("bullet-density");
      expect(violations[0].severity).toBe("warning");
      expect(violations[0].slideIndex).toBe(context.slideIndex);
    });
  });

  describe("fix", () => {
    it("trims bullets to 5 when there are 6", () => {
      const slide = makeSlide({
        bulletPoints: ["One", "Two", "Three", "Four", "Five", "Six"],
      });
      const context = makeContext();

      const fixed = bulletDensity.fix!(slide, context);

      expect(fixed.bulletPoints).toHaveLength(5);
      expect(fixed.bulletPoints).toEqual(["One", "Two", "Three", "Four", "Five"]);
    });
  });
});

describe("textDensity", () => {
  it("has correct rule metadata", () => {
    expect(textDensity.id).toBe("text-density");
    expect(textDensity.category).toBe("typography");
    expect(typeof textDensity.validate).toBe("function");
    expect(textDensity.fix).toBeUndefined();
  });

  describe("validate", () => {
    it("returns no violations when total visible text is under 500 characters", () => {
      const slide = makeSlide({
        slideTitle: "Short Title",
        bulletPoints: ["Brief point"],
      });
      const context = makeContext();

      const violations = textDensity.validate(slide, context);

      expect(violations).toEqual([]);
    });

    it("returns a warning when total visible text exceeds 500 characters", () => {
      const longTitle = "A".repeat(100);
      const longBullets = Array.from({ length: 5 }, () => "B".repeat(80));
      const longQuote = "C".repeat(60);
      const longSubheading = "D".repeat(50);

      const slide = makeSlide({
        slideTitle: longTitle,
        bulletPoints: longBullets,
        keyQuote: longQuote,
        subheading: longSubheading,
      });
      const context = makeContext();

      const totalChars =
        longTitle.length +
        longBullets.join("").length +
        longQuote.length +
        longSubheading.length;
      expect(totalChars).toBeGreaterThan(500);

      const violations = textDensity.validate(slide, context);

      expect(violations).toHaveLength(1);
      expect(violations[0].ruleId).toBe("text-density");
      expect(violations[0].severity).toBe("warning");
      expect(violations[0].slideIndex).toBe(context.slideIndex);
    });

    it("includes keyQuote and subheading in text calculation", () => {
      const slide = makeSlide({
        slideTitle: "A".repeat(200),
        bulletPoints: ["B".repeat(100)],
        keyQuote: "C".repeat(150),
        subheading: "D".repeat(60),
      });
      const context = makeContext();

      const violations = textDensity.validate(slide, context);

      expect(violations).toHaveLength(1);
    });

    it("handles missing optional fields without error", () => {
      const slide = makeSlide({
        slideTitle: "Short",
        bulletPoints: ["One"],
      });
      const context = makeContext();

      const violations = textDensity.validate(slide, context);

      expect(violations).toEqual([]);
    });
  });
});

describe("contrastRatio", () => {
  it("has correct rule metadata", () => {
    expect(contrastRatio.id).toBe("contrast-ratio");
    expect(contrastRatio.category).toBe("colour");
    expect(typeof contrastRatio.validate).toBe("function");
    expect(contrastRatio.fix).toBeUndefined();
  });

  describe("validate", () => {
    it("returns no violations for dark text on white background (high contrast)", () => {
      const slide = makeSlide();
      const context = makeContext({
        colors: {
          primary: "#1B3A4B",
          secondary: "#3A7CA5",
          background: "#FFFFFF",
          text: "#1A2E35",
        },
      });

      const violations = contrastRatio.validate(slide, context);

      expect(violations).toEqual([]);
    });

    it("returns an error for low contrast text on background", () => {
      const slide = makeSlide();
      const context = makeContext({
        colors: {
          primary: "#1B3A4B",
          secondary: "#3A7CA5",
          background: "#CCCCCC",
          text: "#999999",
        },
      });

      const violations = contrastRatio.validate(slide, context);

      expect(violations).toHaveLength(1);
      expect(violations[0].ruleId).toBe("contrast-ratio");
      expect(violations[0].severity).toBe("error");
      expect(violations[0].slideIndex).toBe(context.slideIndex);
    });

    it("passes for #767676 on #FFFFFF (ratio ~4.54:1, just above 4.5)", () => {
      const slide = makeSlide();
      const context = makeContext({
        colors: {
          primary: "#1B3A4B",
          secondary: "#3A7CA5",
          background: "#FFFFFF",
          text: "#767676",
        },
      });

      const violations = contrastRatio.validate(slide, context);

      expect(violations).toEqual([]);
    });

    it("fails for #777777 on #FFFFFF (ratio ~4.48:1, just below 4.5)", () => {
      const slide = makeSlide();
      const context = makeContext({
        colors: {
          primary: "#1B3A4B",
          secondary: "#3A7CA5",
          background: "#FFFFFF",
          text: "#777777",
        },
      });

      const violations = contrastRatio.validate(slide, context);

      expect(violations).toHaveLength(1);
      expect(violations[0].severity).toBe("error");
    });
  });
});

describe("whitespaceEstimate", () => {
  it("has correct rule metadata", () => {
    expect(whitespaceEstimate.id).toBe("whitespace-estimate");
    expect(whitespaceEstimate.category).toBe("spacing");
    expect(typeof whitespaceEstimate.validate).toBe("function");
    expect(whitespaceEstimate.fix).toBeUndefined();
  });

  describe("validate", () => {
    it("returns no violations for a sparse slide with minimal content", () => {
      const slide = makeSlide({
        slideTitle: "Short",
        bulletPoints: ["One", "Two"],
      });
      const context = makeContext();

      const violations = whitespaceEstimate.validate(slide, context);

      expect(violations).toEqual([]);
    });

    it("returns a warning when estimated content exceeds 85% of slide area", () => {
      const slide = makeSlide({
        slideTitle: "A Very Long Title That Takes Up Significant Space On The Slide",
        bulletPoints: [
          "This is an extremely long bullet point that contains a lot of text to fill up space on the slide layout",
          "Another very long bullet point with extensive detail about an important topic that requires many words",
          "Yet another verbose bullet point that contributes to excessive content density on this slide layout",
          "A fourth long bullet with lots of words to push the content density over the acceptable threshold",
          "Fifth bullet point that adds even more text density to this already crowded slide presentation",
          "Sixth and final long bullet point that should push the total well beyond the acceptable whitespace limit",
        ],
        keyQuote:
          "This is a very long key quote that takes up additional space on the slide and contributes to density",
        subheading:
          "An extended subheading with extra context that further reduces the available whitespace ratio",
      });
      const context = makeContext();

      const violations = whitespaceEstimate.validate(slide, context);

      expect(violations).toHaveLength(1);
      expect(violations[0].ruleId).toBe("whitespace-estimate");
      expect(violations[0].severity).toBe("warning");
      expect(violations[0].slideIndex).toBe(context.slideIndex);
    });

    it("accounts for full-image layout having different content area estimation", () => {
      const slide = makeSlide({
        layoutStyle: "full-image",
        slideTitle: "Short",
        bulletPoints: ["One", "Two"],
      });
      const context = makeContext();

      const violations = whitespaceEstimate.validate(slide, context);

      expect(Array.isArray(violations)).toBe(true);
    });
  });
});

describe("allRules barrel export", () => {
  it("exports an array of exactly 5 rules", () => {
    expect(Array.isArray(allRules)).toBe(true);
    expect(allRules).toHaveLength(5);
  });

  it("contains rules with unique ids", () => {
    const ids = allRules.map((rule: DesignRule) => rule.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(5);
  });

  it("contains all expected rules by id", () => {
    const ids = allRules.map((rule: DesignRule) => rule.id);

    expect(ids).toContain("layout-variety");
    expect(ids).toContain("bullet-density");
    expect(ids).toContain("text-density");
    expect(ids).toContain("contrast-ratio");
    expect(ids).toContain("whitespace-estimate");
  });

  it("exports each rule individually by name", () => {
    expect(layoutVariety).toBeDefined();
    expect(bulletDensity).toBeDefined();
    expect(textDensity).toBeDefined();
    expect(contrastRatio).toBeDefined();
    expect(whitespaceEstimate).toBeDefined();
  });
});
