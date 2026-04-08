import type { Slide } from "../../../types/index.js";
import type { DesignRule } from "../types.js";

const MIN_CONTRAST_RATIO = 4.5;

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

function linearize(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(linearize);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function wcagContrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export const contrastRatio: DesignRule = {
  id: "contrast-ratio",
  name: "Contrast Ratio",
  category: "colour",
  description:
    "Errors when text-to-background contrast ratio falls below WCAG 2.1 AA (4.5:1).",

  validate(slide: Slide, context) {
    const ratio = wcagContrastRatio(
      context.colors.text,
      context.colors.background,
    );

    if (ratio < MIN_CONTRAST_RATIO) {
      return [
        {
          ruleId: this.id,
          ruleName: this.name,
          severity: "error",
          message: `Contrast ratio ${ratio.toFixed(2)}:1 is below the ${MIN_CONTRAST_RATIO}:1 minimum.`,
          suggestion:
            "Darken the text colour or lighten the background to meet WCAG AA.",
          slideIndex: context.slideIndex,
        },
      ];
    }
    return [];
  },
};
