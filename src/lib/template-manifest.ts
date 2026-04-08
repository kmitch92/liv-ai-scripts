import { readFile } from "node:fs/promises";
import { TemplateManifestSchema } from "../schemas/template-manifest.schema.js";
import type { TemplateManifest, TemplateLayout } from "../types/index.js";

/** Load and validate a template manifest from a JSON file path. */
export async function loadTemplateManifest(
  filePath: string,
): Promise<TemplateManifest> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    throw new Error(`Template manifest not found: ${filePath}`);
  }
  const json: unknown = JSON.parse(raw);
  return TemplateManifestSchema.parse(json);
}

/** Find a layout by its unique ID. Returns undefined if not found. */
export function getLayoutById(
  manifest: TemplateManifest,
  id: string,
): TemplateLayout | undefined {
  return manifest.layouts.find((layout) => layout.id === id);
}

/** Find layouts whose bestFor array includes the given intent. */
export function getLayoutsForIntent(
  manifest: TemplateManifest,
  intent: string,
): TemplateLayout[] {
  return manifest.layouts.filter((layout) => layout.bestFor.includes(intent));
}

/** Get all layouts from a manifest. */
export function getAllLayouts(manifest: TemplateManifest): TemplateLayout[] {
  return manifest.layouts;
}
