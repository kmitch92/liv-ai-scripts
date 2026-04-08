import type { Slide } from "../../../types/index.js";
import type { DesignRule } from "../types.js";

const LAYOUT_STYLES = [
  "standard",
  "quote-focus",
  "full-image",
  "two-column",
  "key-point",
] as const;

export const layoutVariety: DesignRule = {
  id: "layout-variety",
  name: "Layout Variety",
  category: "composition",
  description:
    "Detects when three or more consecutive slides share the same layout style.",

  validate(slide: Slide, context) {
    const { precedingLayouts, slideIndex } = context;
    const last2 = precedingLayouts.slice(-2);

    if (
      last2.length >= 2 &&
      last2.every((l) => l === slide.layoutStyle)
    ) {
      return [
        {
          ruleId: this.id,
          ruleName: this.name,
          severity: "warning",
          message: `Layout "${slide.layoutStyle}" repeated for 3+ consecutive slides.`,
          suggestion:
            "Switch to a different layout style to maintain visual variety.",
          slideIndex,
        },
      ];
    }

    return [];
  },

  fix(slide: Slide, context) {
    const alternative = LAYOUT_STYLES.find(
      (s) => s !== slide.layoutStyle,
    );
    return { ...slide, layoutStyle: alternative ?? slide.layoutStyle };
  },
};
