import { dirname, join, basename } from "node:path";
import { access } from "node:fs/promises";
import sharp from "sharp";
import PptxAutomizer from "pptx-automizer";
import type { ISlide, ShapeModificationCallback } from "pptx-automizer";
import type {
  Config,
  Presentation,
  Slide,
  TemplateManifest,
  TemplateLayout,
  Placeholder,
} from "../types/index.js";
import { getLayoutById } from "../lib/template-manifest.js";
import * as logger from "../lib/logger.js";

// pptx-automizer uses a CJS default export. Under NodeNext module resolution
// the namespace object is not directly constructable. We extract the named
// exports we need at runtime, mirroring the pattern used for PptxGenJS.
const { Automizer, modify } = PptxAutomizer as unknown as {
  Automizer: typeof PptxAutomizer.Automizer;
  modify: typeof PptxAutomizer.modify;
};

export interface PptxGenerateV2Options {
  presentation: Presentation;
  imagePaths: string[];
  config: Config;
  tempDir: string;
  templatePptxPath: string;
  templateManifest: TemplateManifest;
}

/** Sanitize a string for use as a filename. */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 100);
}

/** Check if a file exists at the given path. */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve which template layout to use for a slide.
 * Requires slide.templateLayoutId to map to a layout in the manifest.
 * Throws a descriptive error if the layout cannot be resolved.
 */
function resolveLayout(
  slide: Slide,
  manifest: TemplateManifest,
  slideIndex: number,
): TemplateLayout {
  const id = slide.templateLayoutId;
  if (id) {
    const layout = getLayoutById(manifest, id);
    if (layout) return layout;
  }
  throw new Error(
    `Slide ${slideIndex + 1} has no resolvable template layout (templateLayoutId="${id ?? "unset"}"; not found in manifest).`,
  );
}

/**
 * Get the 1-based slide number in the template for a given layout.
 * Convention: layout index in manifest.layouts + 1.
 */
function getSlideNumberForLayout(
  layout: TemplateLayout,
  manifest: TemplateManifest,
): number {
  const index = manifest.layouts.findIndex((l) => l.id === layout.id);
  return index >= 0 ? index + 1 : 1;
}

/**
 * Get the text content to populate a placeholder based on its type.
 */
function getPlaceholderContent(
  placeholder: Placeholder,
  slide: Slide,
): string | undefined {
  switch (placeholder.type) {
    case "title":
      return slide.slideTitle;
    case "subtitle":
      return slide.subheading ?? "";
    case "body":
      return slide.bulletPoints.join("\n");
    case "bullets":
      return slide.bulletPoints.map((bp) => `• ${bp}`).join("\n");
    case "quote":
      return slide.keyQuote ?? "";
    case "image":
      // Images handled separately
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Find the first table content block on a slide, if any.
 */
function findTableBlock(
  slideData: Slide,
): { headers: string[]; rows: string[][] } | undefined {
  const blocks = slideData.contentBlocks;
  if (!blocks) return undefined;
  const table = blocks.find((b) => b.type === "table");
  return table && table.type === "table"
    ? { headers: table.headers, rows: table.rows }
    : undefined;
}

/**
 * Populate a table placeholder by invoking pptx-automizer's setTable modifier.
 */
function populateTablePlaceholder(
  addedSlide: ISlide,
  placeholderName: string,
  table: { headers: string[]; rows: string[][] },
  slideIndex: number,
): void {
  const tableData = {
    header: [{ values: table.headers }],
    body: table.rows.map((row) => ({ values: row })),
  };
  try {
    addedSlide.modifyElement(
      placeholderName,
      modify.setTable(tableData) as unknown as ShapeModificationCallback,
    );
  } catch {
    logger.warn(
      `Table placeholder "${placeholderName}" not found on slide ${slideIndex + 1}, skipping`,
    );
  }
}

/**
 * Populate text placeholders on an added slide using the manifest layout definition.
 */
function populatePlaceholders(
  addedSlide: ISlide,
  layout: TemplateLayout,
  slideData: Slide,
  slideIndex: number,
): void {
  for (const placeholder of layout.placeholders) {
    if (placeholder.type === "image") {
      // Image placeholders handled separately
      continue;
    }

    if (placeholder.type === "table") {
      const table = findTableBlock(slideData);
      if (table) {
        populateTablePlaceholder(
          addedSlide,
          placeholder.name,
          table,
          slideIndex,
        );
      }
      continue;
    }

    const content = getPlaceholderContent(placeholder, slideData);
    if (content === undefined) continue;

    // Truncate to maxChars if specified
    const text =
      placeholder.maxChars && content.length > placeholder.maxChars
        ? content.substring(0, placeholder.maxChars - 1) + "\u2026"
        : content;

    try {
      addedSlide.modifyElement(placeholder.name, modify.setText(text));
    } catch {
      logger.warn(
        `Placeholder "${placeholder.name}" not found on slide ${slideIndex + 1}, skipping`,
      );
    }
  }
}

/**
 * Generate a PPTX by populating a designer-created template using pptx-automizer.
 *
 * Loads the template as both root and source, then for each presentation slide:
 * - Resolves which template layout to use
 * - Adds the corresponding template slide
 * - Populates text placeholders from slide data
 * - Attempts image replacement where applicable
 *
 * Returns the absolute path to the generated .pptx file.
 */
export async function generatePptxV2(
  options: PptxGenerateV2Options,
): Promise<string> {
  const {
    presentation,
    imagePaths,
    config: _config,
    tempDir,
    templatePptxPath,
    templateManifest,
  } = options;

  logger.startStep("Generating PPTX from template...");

  // Validate template file exists
  if (!(await fileExists(templatePptxPath))) {
    throw new Error(
      `Template PPTX not found: ${templatePptxPath}. Ensure the file exists and the path is correct.`,
    );
  }

  const templateDir = dirname(templatePptxPath);
  const templateFilename = basename(templatePptxPath);
  const outputFilename = `${sanitizeFilename(presentation.title)}.pptx`;

  // Initialize automizer
  const automizer = new Automizer({
    templateDir,
    outputDir: tempDir,
    removeExistingSlides: true,
  });

  // Load the template as both root (base presentation) and source (slide provider)
  automizer.loadRoot(templateFilename);
  automizer.load(templateFilename, "template");

  // Load media files for images that exist
  const loadedImages: Map<number, string> = new Map();
  for (let i = 0; i < imagePaths.length; i++) {
    const imgPath = imagePaths[i];
    if (imgPath && (await fileExists(imgPath))) {
      try {
        const imgDir = dirname(imgPath);
        const imgFilename = basename(imgPath);
        automizer.loadMedia(imgFilename, imgDir);
        loadedImages.set(i, imgFilename);
      } catch {
        logger.warn(`Failed to load media for slide ${i + 1}: ${imgPath}`);
      }
    }
  }

  // Generate a 1x1 transparent PNG as fallback for missing images
  const fallbackFilename = "transparent-1x1.png";
  await sharp({
    create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toFile(join(tempDir, fallbackFilename));
  automizer.loadMedia(fallbackFilename, tempDir);

  // Add slides
  for (let i = 0; i < presentation.slides.length; i++) {
    const slideData = presentation.slides[i];
    const layout = resolveLayout(slideData, templateManifest, i);
    const slideNumber = getSlideNumberForLayout(layout, templateManifest);
    const layoutId = layout.id;

    logger.info(
      `Slide ${i + 1}: using layout "${layoutId}" (template slide ${slideNumber})`,
    );

    automizer.addSlide("template", slideNumber, (addedSlide: ISlide) => {
      populatePlaceholders(addedSlide, layout, slideData, i);

      // Image replacement: find image placeholder and swap relation target
      const imagePlaceholder = layout.placeholders.find(
        (p) => p.type === "image",
      );
      if (imagePlaceholder) {
        const imageFilename = loadedImages.get(i) ?? fallbackFilename;
        try {
          addedSlide.modifyElement(
            imagePlaceholder.name,
            modify.setRelationTarget(imageFilename) as unknown as ShapeModificationCallback,
          );
        } catch {
          logger.warn(
            `Image placeholder "${imagePlaceholder.name}" not found on slide ${i + 1}`,
          );
        }
      }
    });
  }

  // Write the output file
  try {
    await automizer.write(outputFilename);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.failStep(`PPTX generation failed: ${msg}`);
    throw new Error(`Failed to write PPTX: ${msg}`);
  }

  const outputPath = join(tempDir, outputFilename);
  logger.succeedStep(`PPTX generated: ${outputPath}`);
  return outputPath;
}
