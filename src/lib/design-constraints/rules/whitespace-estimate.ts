import type { Slide } from "../../../types/index.js";
import type { DesignRule } from "../types.js";

const MAX_CONTENT_RATIO = 0.85;
const CHARS_PER_LINE = 50;
const LINE_HEIGHT_INCHES = 0.35;

function imageAreaFraction(layout: string): number {
  switch (layout) {
    case "full-image":
      return 1.0;
    case "quote-focus":
      return 0.5;
    case "two-column":
      return 0.3;
    case "key-point":
      return 0.4;
    default:
      return 0.4;
  }
}

export const whitespaceEstimate: DesignRule = {
  id: "whitespace-estimate",
  name: "Whitespace Estimate",
  category: "spacing",
  description:
    "Warns when estimated content fills more than 85% of the slide area.",

  validate(slide: Slide, context) {
    const { slideWidth, slideHeight } = context;
    const slideArea = slideWidth * slideHeight;

    // Title band ~10% of height
    const titleArea = slideWidth * slideHeight * 0.1;

    // Bullet area: estimate lines from total chars
    const bulletChars = slide.bulletPoints.join("").length;
    const bulletLines = Math.ceil(bulletChars / CHARS_PER_LINE);
    const bulletArea = slideWidth * bulletLines * LINE_HEIGHT_INCHES;

    // Image area based on layout
    const imgFraction = imageAreaFraction(slide.layoutStyle);
    const imageArea = slideArea * imgFraction;

    // Optional elements
    let extraArea = 0;
    if (slide.keyQuote) {
      const quoteLines = Math.ceil(slide.keyQuote.length / CHARS_PER_LINE);
      extraArea += slideWidth * quoteLines * LINE_HEIGHT_INCHES;
    }
    if (slide.subheading) {
      extraArea += slideWidth * slideHeight * 0.05;
    }

    // Title text char-based contribution
    const titleChars = slide.slideTitle.length;
    const titleLines = Math.ceil(titleChars / CHARS_PER_LINE);
    const titleTextArea = slideWidth * titleLines * LINE_HEIGHT_INCHES;

    const totalContent =
      Math.max(titleArea, titleTextArea) +
      bulletArea +
      imageArea +
      extraArea;

    const contentRatio = totalContent / slideArea;

    if (contentRatio > MAX_CONTENT_RATIO) {
      return [
        {
          ruleId: this.id,
          ruleName: this.name,
          severity: "warning",
          message: `Estimated content fills ~${Math.round(contentRatio * 100)}% of the slide (max ${MAX_CONTENT_RATIO * 100}%).`,
          suggestion:
            "Reduce content or choose a layout with more whitespace.",
          slideIndex: context.slideIndex,
        },
      ];
    }
    return [];
  },
};
