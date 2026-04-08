export * from "./types.js";

export { layoutVariety } from "./rules/layout-variety.js";
export { bulletDensity } from "./rules/bullet-density.js";
export { textDensity } from "./rules/text-density.js";
export { contrastRatio } from "./rules/contrast-ratio.js";
export { whitespaceEstimate } from "./rules/whitespace-estimate.js";

import { layoutVariety } from "./rules/layout-variety.js";
import { bulletDensity } from "./rules/bullet-density.js";
import { textDensity } from "./rules/text-density.js";
import { contrastRatio } from "./rules/contrast-ratio.js";
import { whitespaceEstimate } from "./rules/whitespace-estimate.js";

import type { DesignRule } from "./types.js";

export const allRules: DesignRule[] = [
  layoutVariety,
  bulletDensity,
  textDensity,
  contrastRatio,
  whitespaceEstimate,
];
