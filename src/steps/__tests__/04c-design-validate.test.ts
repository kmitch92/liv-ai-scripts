import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Presentation, Config } from "../../types/index.js";

vi.mock("../../lib/logger.js", () => ({
  startStep: vi.fn(),
  succeedStep: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import {
  validateDesign,
  type DesignValidateOptions,
} from "../04c-design-validate.js";
import * as logger from "../../lib/logger.js";

function makeConfig(overrides?: {
  colors?: Partial<Config["branding"]["colors"]>;
}): Config {
  return {
    branding: {
      logo: "logo.png",
      assetsDir: "./assets",
      colors: {
        primary: "#1B3A4B",
        secondary: "#3A7CA5",
        background: "#FFFFFF",
        text: "#1A2E35",
        ...overrides?.colors,
      },
      fonts: { heading: "Arial", body: "Calibri" },
    },
    elevenlabs: {
      voiceId: "test",
      modelId: "test",
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0,
      speed: 1,
      useSpeakerBoost: true,
    },
    script: {
      speakerIdentity: "tutor",
      targetAudience: "students",
      systemPrompt: "teach",
      contextFiles: [],
      phoneticsOverrides: [],
      durationMinutes: 8,
    },
    pipeline: {
      useIterativeContent: false,
      enableCritic: false,
      enableDesignValidation: false,
      useTemplateEngine: false,
    },
  };
}

function makePresentation(overrides?: {
  slideCount?: number;
  slideOverrides?: Array<Partial<Presentation["slides"][number]>>;
}): Presentation {
  const count = overrides?.slideCount ?? 5;
  const layouts = [
    "standard",
    "quote-focus",
    "full-image",
    "two-column",
    "key-point",
  ] as const;

  return {
    title: "Test",
    slides: Array.from({ length: count }, (_, i) => ({
      slideTitle: `Slide ${i + 1}`,
      narration: `Narration ${i + 1}`,
      bulletPoints: ["Point 1", "Point 2"],
      layoutStyle: layouts[i % 5],
      imageQuery: "test",
      durationSeconds: 60,
      ...overrides?.slideOverrides?.[i],
    })),
    totalDurationSeconds: count * 60,
  };
}

describe("validateDesign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("clean presentation with no violations", () => {
    it("returns presentation with designMetadata attached and empty violations", () => {
      const presentation = makePresentation();
      const config = makeConfig();

      const result = validateDesign({ presentation, config });

      for (const slide of result.slides) {
        expect(slide.designMetadata).toBeDefined();
        expect(slide.designMetadata!.violations).toEqual([]);
      }
    });

    it("preserves all original slide content", () => {
      const presentation = makePresentation();
      const config = makeConfig();

      const result = validateDesign({ presentation, config });

      expect(result.title).toBe("Test");
      expect(result.slides).toHaveLength(5);
      for (let i = 0; i < result.slides.length; i++) {
        expect(result.slides[i].narration).toBe(`Narration ${i + 1}`);
        expect(result.slides[i].imageQuery).toBe("test");
      }
    });
  });

  describe("bullet density violation with auto-fix", () => {
    it("detects bullet density violation and fixes to 5 bullets", () => {
      const presentation = makePresentation({
        slideOverrides: [
          {
            bulletPoints: [
              "One",
              "Two",
              "Three",
              "Four",
              "Five",
              "Six",
            ],
          },
        ],
      });
      const config = makeConfig();

      const result = validateDesign({ presentation, config });

      expect(result.slides[0].bulletPoints).toHaveLength(5);
      expect(result.slides[0].bulletPoints).toEqual([
        "One",
        "Two",
        "Three",
        "Four",
        "Five",
      ]);
    });

    it("records bullet-density violation in designMetadata", () => {
      const presentation = makePresentation({
        slideOverrides: [
          {
            bulletPoints: [
              "One",
              "Two",
              "Three",
              "Four",
              "Five",
              "Six",
            ],
          },
        ],
      });
      const config = makeConfig();

      const result = validateDesign({ presentation, config });

      const violations = result.slides[0].designMetadata!.violations;
      expect(violations.length).toBeGreaterThanOrEqual(1);
      expect(violations).toContainEqual(
        expect.stringContaining("bullet-density"),
      );
    });
  });

  describe("layout variety violation with auto-fix", () => {
    it("detects 3 consecutive same layouts and changes the middle slide", () => {
      const presentation = makePresentation({
        slideCount: 5,
        slideOverrides: [
          { layoutStyle: "standard" },
          { layoutStyle: "standard" },
          { layoutStyle: "standard" },
          { layoutStyle: "quote-focus" },
          { layoutStyle: "two-column" },
        ],
      });
      const config = makeConfig();

      const result = validateDesign({ presentation, config });

      const layouts = result.slides.map((s) => s.layoutStyle);
      const hasConsecutiveTriple =
        layouts[0] === layouts[1] && layouts[1] === layouts[2];
      expect(hasConsecutiveTriple).toBe(false);
    });

    it("records layout-variety violation in designMetadata for affected slide", () => {
      const presentation = makePresentation({
        slideCount: 5,
        slideOverrides: [
          { layoutStyle: "standard" },
          { layoutStyle: "standard" },
          { layoutStyle: "standard" },
          { layoutStyle: "quote-focus" },
          { layoutStyle: "two-column" },
        ],
      });
      const config = makeConfig();

      const result = validateDesign({ presentation, config });

      const slideWithViolation = result.slides[2];
      expect(slideWithViolation.designMetadata).toBeDefined();
      expect(slideWithViolation.designMetadata!.violations).toContainEqual(
        expect.stringContaining("layout-variety"),
      );
    });
  });

  describe("text density violation without auto-fix", () => {
    it("detects text density violation but does not modify content", () => {
      const longTitle = "A".repeat(100);
      const longBullets = Array.from({ length: 5 }, () => "B".repeat(80));
      const longQuote = "C".repeat(60);
      const longSubheading = "D".repeat(50);

      const presentation = makePresentation({
        slideOverrides: [
          {
            slideTitle: longTitle,
            bulletPoints: longBullets,
            keyQuote: longQuote,
            subheading: longSubheading,
          },
        ],
      });
      const config = makeConfig();

      const result = validateDesign({ presentation, config });

      expect(result.slides[0].slideTitle).toBe(longTitle);
      expect(result.slides[0].bulletPoints).toEqual(longBullets);
      expect(result.slides[0].keyQuote).toBe(longQuote);
      expect(result.slides[0].subheading).toBe(longSubheading);

      expect(result.slides[0].designMetadata!.violations).toContainEqual(
        expect.stringContaining("text-density"),
      );
    });
  });

  describe("contrast ratio violation without auto-fix", () => {
    it("detects low contrast as error-severity violation", () => {
      const presentation = makePresentation();
      const config = makeConfig({
        colors: { background: "#CCCCCC", text: "#999999" },
      });

      const result = validateDesign({ presentation, config });

      for (const slide of result.slides) {
        expect(slide.designMetadata!.violations).toContainEqual(
          expect.stringContaining("contrast-ratio"),
        );
      }
    });
  });

  describe("designMetadata attached to every slide", () => {
    it("every slide in output has designMetadata with violations array", () => {
      const presentation = makePresentation({ slideCount: 8 });
      const config = makeConfig();

      const result = validateDesign({ presentation, config });

      for (const slide of result.slides) {
        expect(slide.designMetadata).toBeDefined();
        expect(slide.designMetadata).toHaveProperty("violations");
        expect(Array.isArray(slide.designMetadata!.violations)).toBe(true);
        expect(slide.designMetadata).toHaveProperty("whitespaceRatio");
        expect(slide.designMetadata).toHaveProperty("contrastScore");
        expect(slide.designMetadata).toHaveProperty("textDensity");
      }
    });
  });

  describe("summary logging", () => {
    it("calls logger.startStep at the beginning", () => {
      const presentation = makePresentation();
      const config = makeConfig();

      validateDesign({ presentation, config });

      expect(logger.startStep).toHaveBeenCalled();
    });

    it("calls logger.succeedStep at the end with summary", () => {
      const presentation = makePresentation();
      const config = makeConfig();

      validateDesign({ presentation, config });

      expect(logger.succeedStep).toHaveBeenCalled();
    });

    it("calls logger.warn for slides that have violations", () => {
      const presentation = makePresentation({
        slideOverrides: [
          {
            bulletPoints: [
              "One",
              "Two",
              "Three",
              "Four",
              "Five",
              "Six",
            ],
          },
        ],
      });
      const config = makeConfig();

      validateDesign({ presentation, config });

      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("immutability", () => {
    it("does not mutate the input presentation", () => {
      const presentation = makePresentation({
        slideOverrides: [
          {
            bulletPoints: [
              "One",
              "Two",
              "Three",
              "Four",
              "Five",
              "Six",
            ],
          },
        ],
      });
      const config = makeConfig();
      const originalJson = JSON.stringify(presentation);

      validateDesign({ presentation, config });

      expect(JSON.stringify(presentation)).toBe(originalJson);
    });
  });

  describe("no layout-order enforcement", () => {
    it("does not enforce slide ordering (non-canonical sequence validates cleanly for order)", () => {
      // Deliberately non-canonical: a "reflect"-style slide first, a "header"-style last,
      // plus other layouts scrambled. Any hypothetical order rule (e.g. "header must be
      // first", "reflect must be last", "agenda must follow header") must NOT fire.
      const presentation = makePresentation({
        slideCount: 5,
        slideOverrides: [
          { layoutStyle: "key-point", slideTitle: "Reflect" },
          { layoutStyle: "two-column", slideTitle: "Body B" },
          { layoutStyle: "full-image", slideTitle: "Body A" },
          { layoutStyle: "quote-focus", slideTitle: "Agenda" },
          { layoutStyle: "standard", slideTitle: "Header" },
        ],
      });
      const config = makeConfig();

      const result = validateDesign({ presentation, config });

      const allViolations = result.slides.flatMap(
        (s) => s.designMetadata!.violations,
      );
      const orderRelated = allViolations.filter((v) =>
        /order|sequence|must be first|must be last|must follow|position/i.test(
          v,
        ),
      );
      expect(orderRelated).toEqual([]);
    });
  });

  describe("multiple violations per slide", () => {
    it("accumulates both bullet-density and text-density violations on one slide", () => {
      const longBullets = Array.from({ length: 6 }, () => "X".repeat(80));

      const presentation = makePresentation({
        slideOverrides: [
          {
            slideTitle: "A".repeat(100),
            bulletPoints: longBullets,
            keyQuote: "C".repeat(60),
            subheading: "D".repeat(50),
          },
        ],
      });
      const config = makeConfig();

      const result = validateDesign({ presentation, config });

      const violations = result.slides[0].designMetadata!.violations;
      expect(violations.length).toBeGreaterThanOrEqual(2);
      expect(violations).toContainEqual(
        expect.stringContaining("bullet-density"),
      );
      expect(violations).toContainEqual(
        expect.stringContaining("text-density"),
      );
    });
  });
});
