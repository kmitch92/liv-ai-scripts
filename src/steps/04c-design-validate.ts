import type { Presentation, Config, Slide } from "../types/index.js";
import { allRules } from "../lib/design-constraints/index.js";
import type {
  DesignContext,
  DesignViolation,
} from "../lib/design-constraints/types.js";
import * as logger from "../lib/logger.js";

export type DesignValidateOptions = {
  presentation: Presentation;
  config: Config;
};

const SLIDE_WIDTH = 13.333;
const SLIDE_HEIGHT = 7.5;

/** Rules in the "spacing" category contribute to metadata only, not violations. */
const METADATA_ONLY_CATEGORIES = new Set(["spacing"]);

function computeTextDensity(slide: Slide): number {
  return (
    slide.slideTitle.length +
    slide.bulletPoints.join("").length +
    (slide.keyQuote ?? "").length +
    (slide.subheading ?? "").length
  );
}

function formatViolation(v: DesignViolation): string {
  return `[${v.ruleId}] ${v.message}`;
}

export function validateDesign(options: DesignValidateOptions): Presentation {
  const { presentation, config } = options;
  logger.startStep("Design validation");

  const colors = { ...config.branding.colors };
  const fonts = { ...config.branding.fonts };
  const totalSlides = presentation.slides.length;

  // Work on a deep copy of slides to avoid mutating input
  let slides: Slide[] = presentation.slides.map((s) => ({
    ...s,
    bulletPoints: [...s.bulletPoints],
  }));

  const violationsBySlide: string[][] = Array.from(
    { length: totalSlides },
    () => [],
  );

  let totalViolations = 0;

  for (let i = 0; i < totalSlides; i++) {
    const precedingLayouts = slides.slice(0, i).map((s) => s.layoutStyle);
    const followingLayouts = slides
      .slice(i + 1)
      .map((s) => s.layoutStyle);

    const context: DesignContext = {
      slideWidth: SLIDE_WIDTH,
      slideHeight: SLIDE_HEIGHT,
      colors,
      fonts,
      slideIndex: i,
      totalSlides,
      precedingLayouts,
      followingLayouts,
    };

    let currentSlide = slides[i];

    for (const rule of allRules) {
      const violations = rule.validate(currentSlide, context);

      // Spacing-category rules (whitespace-estimate) contribute to metadata
      // only; they do not produce user-facing violations.
      if (METADATA_ONLY_CATEGORIES.has(rule.category)) {
        continue;
      }

      if (violations.length > 0) {
        for (const v of violations) {
          violationsBySlide[i].push(formatViolation(v));
        }
        totalViolations += violations.length;

        if (rule.fix) {
          currentSlide = rule.fix(currentSlide, context);
        }
      }
    }

    // Persist fixes so subsequent slides see updated layouts
    slides[i] = currentSlide;
  }

  // Build final slides with designMetadata
  const resultSlides: Slide[] = slides.map((slide, i) => ({
    ...slide,
    bulletPoints: [...slide.bulletPoints],
    designMetadata: {
      violations: violationsBySlide[i],
      whitespaceRatio: 0,
      contrastScore: 0,
      textDensity: computeTextDensity(slide),
    },
  }));

  // Log warnings for slides with violations
  for (let i = 0; i < resultSlides.length; i++) {
    const violations = violationsBySlide[i];
    if (violations.length > 0) {
      logger.warn(
        `Slide ${i + 1} "${resultSlides[i].slideTitle}": ${violations.length} violation(s)`,
      );
    }
  }

  logger.succeedStep(
    `Design validation complete: ${totalViolations} violation(s) across ${totalSlides} slides`,
  );

  return {
    ...presentation,
    slides: resultSlides,
  };
}
