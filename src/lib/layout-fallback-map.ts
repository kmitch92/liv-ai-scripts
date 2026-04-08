/** Default mapping from layoutStyle enum values to template layout IDs. */
const LAYOUT_FALLBACK_MAP: Record<string, string> = {
  "standard": "content-with-image",
  "quote-focus": "quote-centered",
  "full-image": "full-bleed-image",
  "two-column": "two-column-content",
  "key-point": "key-point-emphasis",
};

export { LAYOUT_FALLBACK_MAP };

/** Get the template layout ID for a given layoutStyle, or undefined if no mapping exists. */
export function getTemplateLayoutForStyle(layoutStyle: string): string | undefined {
  return LAYOUT_FALLBACK_MAP[layoutStyle];
}

/** Get all layout style values that have fallback mappings. */
export function getMappedStyles(): string[] {
  return Object.keys(LAYOUT_FALLBACK_MAP);
}

/** Get all template layout IDs used in fallback mappings. */
export function getMappedTemplateIds(): string[] {
  return Object.values(LAYOUT_FALLBACK_MAP);
}
