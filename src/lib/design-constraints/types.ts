import type { Slide } from "../../types/index.js";

/** Classification for design rules. */
export type DesignRuleCategory =
  | "typography"
  | "spacing"
  | "colour"
  | "composition"
  | "consistency";

/** Severity levels for design violations. */
export type DesignViolationSeverity = "error" | "warning";

/** A single violation detected by a design rule. */
export interface DesignViolation {
  /** Unique identifier of the rule that was violated. */
  ruleId: string;
  /** Human-readable name of the violated rule. */
  ruleName: string;
  /** How severe the violation is. */
  severity: DesignViolationSeverity;
  /** Description of what went wrong. */
  message: string;
  /** Actionable suggestion for fixing the violation. */
  suggestion: string;
  /** Zero-based index of the slide where the violation was found. */
  slideIndex: number;
}

/**
 * Contextual information passed to each design rule during evaluation.
 * Provides slide dimensions, theme colours/fonts, and positional metadata.
 */
export interface DesignContext {
  /** Slide width in inches (e.g. 13.333 for LAYOUT_WIDE). */
  slideWidth: number;
  /** Slide height in inches (e.g. 7.5 for LAYOUT_WIDE). */
  slideHeight: number;
  /** Theme colour palette as hex strings. */
  colors: {
    primary: string;
    secondary: string;
    background: string;
    text: string;
  };
  /** Font family names for headings and body text. */
  fonts: {
    heading: string;
    body: string;
  };
  /** Zero-based index of the current slide. */
  slideIndex: number;
  /** Total number of slides in the presentation. */
  totalSlides: number;
  /** Layout style values of slides preceding the current one. */
  precedingLayouts: string[];
  /** Layout style values of slides following the current one. */
  followingLayouts: string[];
}

/**
 * A single design rule that can validate a slide and optionally auto-fix violations.
 * Implementations provide domain-specific checks (typography, spacing, etc.).
 */
export interface DesignRule {
  /** Unique identifier for this rule (e.g. "typo-min-font-size"). */
  id: string;
  /** Human-readable rule name. */
  name: string;
  /** Which design category this rule belongs to. */
  category: DesignRuleCategory;
  /** Explanation of what this rule checks. */
  description: string;
  /** Evaluate a slide and return any violations found. */
  validate(slide: Slide, context: DesignContext): DesignViolation[];
  /** Attempt to auto-correct violations. Returns the corrected slide. */
  fix?(slide: Slide, context: DesignContext): Slide;
}

/** Per-slide violation report. */
export interface SlideReport {
  /** Zero-based index of the slide. */
  slideIndex: number;
  /** Title or heading of the slide. */
  slideTitle: string;
  /** All violations found on this slide. */
  violations: DesignViolation[];
}

/** Aggregated design report for an entire presentation. */
export interface DesignReport {
  /** Individual report for each slide. */
  slideReports: SlideReport[];
  /** High-level violation counts. */
  summary: {
    totalViolations: number;
    errorCount: number;
    warningCount: number;
    fixableCount: number;
  };
}
