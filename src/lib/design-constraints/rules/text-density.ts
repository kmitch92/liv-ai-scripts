import type { Slide } from "../../../types/index.js";
import type { DesignRule } from "../types.js";

const MAX_VISIBLE_CHARS = 500;

export const textDensity: DesignRule = {
  id: "text-density",
  name: "Text Density",
  category: "typography",
  description:
    "Warns when total visible text on a slide exceeds 500 characters.",

  validate(slide: Slide, context) {
    const total =
      slide.slideTitle.length +
      slide.bulletPoints.join("").length +
      (slide.keyQuote ?? "").length +
      (slide.subheading ?? "").length;

    if (total > MAX_VISIBLE_CHARS) {
      return [
        {
          ruleId: this.id,
          ruleName: this.name,
          severity: "warning",
          message: `Visible text is ${total} characters (max ${MAX_VISIBLE_CHARS}).`,
          suggestion:
            "Reduce text content or move detail to speaker notes.",
          slideIndex: context.slideIndex,
        },
      ];
    }
    return [];
  },
};
