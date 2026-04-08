import type { Slide } from "../../../types/index.js";
import type { DesignRule } from "../types.js";

const MAX_BULLETS = 5;

export const bulletDensity: DesignRule = {
  id: "bullet-density",
  name: "Bullet Density",
  category: "typography",
  description: "Warns when a slide contains more than 5 bullet points.",

  validate(slide: Slide, context) {
    if (slide.bulletPoints.length > MAX_BULLETS) {
      return [
        {
          ruleId: this.id,
          ruleName: this.name,
          severity: "warning",
          message: `Slide has ${slide.bulletPoints.length} bullets (max ${MAX_BULLETS}).`,
          suggestion: `Reduce to ${MAX_BULLETS} or fewer bullet points.`,
          slideIndex: context.slideIndex,
        },
      ];
    }
    return [];
  },

  fix(slide: Slide, _context) {
    return {
      ...slide,
      bulletPoints: slide.bulletPoints.slice(0, MAX_BULLETS),
    };
  },
};
