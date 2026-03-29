import path from "node:path";
import { access, readFile, writeFile } from "node:fs/promises";
import PptxGenJS from "pptxgenjs";
import PizZip from "pizzip";
import type { Config, Presentation } from "../types/index.js";
import { info, startStep, succeedStep, warn } from "../lib/logger.js";

// pptxgenjs types declare the default export as both a class and a namespace.
// Under NodeNext resolution the import resolves to the module namespace object,
// which makes `new PptxGenJS()` and namespace member access (PptxGenJS.Slide)
// fail at the type level. At runtime the default export IS the class constructor.
// We cast through `unknown` to bridge the gap.

/** The PptxGenJS class constructor type (extracted from the .d.ts declaration). */
interface PptxClass {
  new (): PptxInstance;
}

/** Minimal instance shape we rely on (matches the declared class). */
interface PptxInstance {
  layout: string;
  title: string;
  author: string;
  defineSlideMaster(opts: Record<string, unknown>): void;
  addSlide(opts?: { masterName?: string }): PptxSlide;
  writeFile(opts: { fileName: string }): Promise<string>;
}

/** Slide methods we use. */
interface PptxSlide {
  addNotes(notes: string): void;
  addText(
    text: string | Array<{ text: string; options?: Record<string, unknown> }>,
    opts?: Record<string, unknown>,
  ): PptxSlide;
  addImage(opts: Record<string, unknown>): PptxSlide;
  addShape(name: string, opts?: Record<string, unknown>): PptxSlide;
}

const Pptx = PptxGenJS as unknown as PptxClass;

export interface PptxOptions {
  presentation: Presentation;
  imagePaths: string[];
  config: Config;
  tempDir: string;
}

/** Hex color without the leading '#' — pptxgenjs expects bare hex. */
function bareHex(color: string): string {
  return color.replace(/^#/, "");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function generatePptx(options: PptxOptions): Promise<string> {
  const { presentation, imagePaths, config, tempDir } = options;
  const { slides } = presentation;

  startStep("Generating PowerPoint...");

  const pptx = new Pptx();
  pptx.layout = "LAYOUT_WIDE"; // 13.333" x 7.5"
  pptx.title = presentation.title;
  pptx.author = "Teaching Materials Generator";

  // Resolve logo to absolute path (pptxgenjs requires absolute)
  const logoPath = path.resolve(config.branding.assetsDir, config.branding.logo);
  const hasLogo = await fileExists(logoPath);
  if (!hasLogo) {
    warn(`Logo not found at ${logoPath}, skipping logo placement`);
  }

  // ── Master slide definition ──────────────────────────────────────────
  const masterName = "BRANDED_MASTER";
  pptx.defineSlideMaster({
    title: masterName,
    background: { color: bareHex(config.branding.colors.secondary) },
    objects: [
      // Top accent bar
      {
        rect: {
          x: 0,
          y: 0,
          w: "100%",
          h: 0.1,
          fill: { color: bareHex(config.branding.colors.primary) },
        },
      },
      // Bottom accent bar
      {
        rect: {
          x: 0,
          y: 7.4,
          w: "100%",
          h: 0.1,
          fill: { color: bareHex(config.branding.colors.primary) },
        },
      },
      // Logo bottom-right (only if file exists)
      ...(hasLogo
        ? [
            {
              image: {
                x: 10.8,
                y: 6.7,
                w: 2.2,
                h: 0.64,
                path: logoPath,
              },
            },
          ]
        : []),
    ],
  });

  // ── Build slides ─────────────────────────────────────────────────────
  for (let i = 0; i < slides.length; i++) {
    const slideData = slides[i];
    const imagePath = imagePaths[i] ?? undefined;
    const isFirst = i === 0;

    const pptxSlide = pptx.addSlide({ masterName });

    if (isFirst) {
      addTitleSlide(pptxSlide, slideData, imagePath, config);
    } else {
      switch (slideData.layoutStyle) {
        case "quote-focus":
          addQuoteFocusSlide(pptxSlide, slideData, imagePath, config);
          break;
        case "full-image":
          addFullImageSlide(pptxSlide, slideData, imagePath, config);
          break;
        case "two-column":
          addTwoColumnSlide(pptxSlide, slideData, imagePath, config);
          break;
        case "key-point":
          addKeyPointSlide(pptxSlide, slideData, imagePath, config);
          break;
        default:
          addContentSlide(pptxSlide, slideData, imagePath, config);
      }
    }
  }

  // ── Write file ───────────────────────────────────────────────────────
  const outputPath = path.join(
    tempDir,
    `${sanitizeFilename(presentation.title)}.pptx`,
  );
  await pptx.writeFile({ fileName: outputPath });

  // Apply template branding if configured
  if (config.branding.templatePptx) {
    const templatePath = path.resolve(config.branding.templatePptx);
    if (await fileExists(templatePath)) {
      try {
        await applyTemplate(outputPath, templatePath);
        info("Template PPTX applied");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warn(`Template application failed (${msg}), using generated styling`);
      }
    } else {
      warn(`Template PPTX not found at ${templatePath}, skipping`);
    }
  }

  succeedStep(`PowerPoint saved: ${path.basename(outputPath)}`);
  return outputPath;
}

// ── Title slide (first slide) ────────────────────────────────────────────

function addTitleSlide(
  slide: PptxSlide,
  data: Presentation["slides"][number],
  imagePath: string | undefined,
  config: Config,
): void {
  // Full-bleed background image if available
  if (imagePath) {
    slide.addImage({
      path: imagePath,
      x: 0,
      y: 0,
      w: "100%",
      h: "100%",
      sizing: { type: "cover", w: 13.333, h: 7.5 },
    });

    // Full-slide semi-transparent overlay for text readability (40% transparency)
    slide.addShape("rect", {
      x: 0,
      y: 0,
      w: "100%",
      h: "100%",
      fill: { color: bareHex(config.branding.colors.background), transparency: 40 },
    });
  }

  // Centered title — vertically centered on slide
  slide.addText(data.slideTitle, {
    x: 1.0,
    y: 2.5,
    w: 11.333,
    h: 2.5,
    fontSize: 36,
    fontFace: config.branding.fonts.heading,
    color: bareHex(config.branding.colors.primary),
    bold: true,
    align: "center",
    valign: "middle",
  });

  // Subheading if present
  if (data.subheading) {
    slide.addText(data.subheading, {
      x: 1.0,
      y: 5.0,
      w: 11.333,
      h: 0.8,
      fontSize: 18,
      fontFace: config.branding.fonts.body,
      color: imagePath
        ? "FFFFFF"
        : bareHex(config.branding.colors.primary),
      italic: true,
      align: "center",
      valign: "top",
    });
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────

type SlideData = Presentation["slides"][number];

/** Add title band with optional subheading. Returns the y-position after the title area. */
function addTitleBand(
  slide: PptxSlide,
  data: SlideData,
  config: Config,
): number {
  const hasSubheading = !!data.subheading;
  const bandHeight = hasSubheading ? 1.4 : 1.1;

  slide.addShape("rect", {
    x: 0,
    y: 0.15,
    w: "100%",
    h: bandHeight,
    fill: { color: bareHex(config.branding.colors.secondary) },
  });

  slide.addText(data.slideTitle, {
    x: 0.5,
    y: 0.2,
    w: 12.333,
    h: hasSubheading ? 0.8 : 1.0,
    fontSize: 24,
    fontFace: config.branding.fonts.heading,
    color: bareHex(config.branding.colors.primary),
    bold: true,
    valign: "middle",
  });

  if (hasSubheading) {
    slide.addText(data.subheading!, {
      x: 0.5,
      y: 1.0,
      w: 12.333,
      h: 0.5,
      fontSize: 16,
      fontFace: config.branding.fonts.body,
      color: bareHex(config.branding.colors.secondary),
      italic: true,
      valign: "top",
    });
  }

  return 0.15 + bandHeight + 0.3;
}

/** Add a key quote block at the given position. Returns the y-position after the quote. */
function addKeyQuoteBlock(
  slide: PptxSlide,
  quote: string,
  y: number,
  config: Config,
  opts?: { w?: number; x?: number; fontSize?: number; h?: number },
): number {
  const x = opts?.x ?? 0.7;
  const w = opts?.w ?? 11.5;
  const fontSize = opts?.fontSize ?? 22;
  const h = opts?.h ?? 1.0;

  slide.addText(`\u201C${quote}\u201D`, {
    x,
    y,
    w,
    h,
    fontSize,
    fontFace: config.branding.fonts.body,
    color: bareHex(config.branding.colors.primary),
    italic: true,
    align: "center",
    valign: "middle",
  });

  return y + h + 0.15;
}

// ── Content slide (standard layout) ─────────────────────────────────────

function addContentSlide(
  slide: PptxSlide,
  data: SlideData,
  imagePath: string | undefined,
  config: Config,
): void {
  slide.addNotes(data.narration);

  const contentY = addTitleBand(slide, data, config);

  let bulletY = contentY;

  // Key quote above bullets if present
  if (data.keyQuote) {
    bulletY = addKeyQuoteBlock(slide, data.keyQuote, contentY, config, {
      w: 6.0,
      x: 0.7,
      fontSize: 18,
      h: 0.8,
    });
  }

  // Bullet points — left column
  if (data.bulletPoints.length > 0) {
    const bullets = data.bulletPoints.map((point) => ({
      text: point,
      options: {
        fontSize: 18,
        fontFace: config.branding.fonts.body,
        color: bareHex(config.branding.colors.text),
        bullet: true,
        breakLine: true,
        lineSpacingMultiple: 1.6,
        paraSpaceAfter: 12,
      },
    }));

    slide.addText(bullets, {
      x: 0.7,
      y: bulletY,
      w: 6.0,
      h: 7.0 - bulletY,
      valign: "top",
    });
  }

  // Image — right column
  if (imagePath) {
    slide.addImage({
      path: imagePath,
      x: 7.3,
      y: contentY,
      w: 5.5,
      h: 7.0 - contentY,
      rounding: true,
      sizing: { type: "cover", w: 5.5, h: 7.0 - contentY },
    });
  }
}

// ── Quote-focus layout ──────────────────────────────────────────────────

function addQuoteFocusSlide(
  slide: PptxSlide,
  data: SlideData,
  imagePath: string | undefined,
  config: Config,
): void {
  slide.addNotes(data.narration);

  // Subtle background image with high transparency
  if (imagePath) {
    slide.addImage({
      path: imagePath,
      x: 0,
      y: 0,
      w: "100%",
      h: "100%",
      sizing: { type: "cover", w: 13.333, h: 7.5 },
    });
    slide.addShape("rect", {
      x: 0,
      y: 0,
      w: "100%",
      h: "100%",
      fill: { color: bareHex(config.branding.colors.background), transparency: 50 },
    });
  }

  // Title at top
  slide.addText(data.slideTitle, {
    x: 0.5,
    y: 0.3,
    w: 12.333,
    h: 0.8,
    fontSize: 24,
    fontFace: config.branding.fonts.heading,
    color: bareHex(config.branding.colors.primary),
    bold: true,
    align: "center",
    valign: "middle",
  });

  // Subheading below title
  if (data.subheading) {
    slide.addText(data.subheading, {
      x: 0.5,
      y: 1.1,
      w: 12.333,
      h: 0.5,
      fontSize: 16,
      fontFace: config.branding.fonts.body,
      color: bareHex(config.branding.colors.secondary),
      italic: true,
      align: "center",
      valign: "top",
    });
  }

  // Large centered quote
  const quoteText = data.keyQuote ?? data.bulletPoints[0] ?? "";
  slide.addText(`\u201C${quoteText}\u201D`, {
    x: 1.0,
    y: 2.2,
    w: 11.333,
    h: 2.5,
    fontSize: 28,
    fontFace: config.branding.fonts.body,
    color: bareHex(config.branding.colors.primary),
    italic: true,
    align: "center",
    valign: "middle",
  });

  // Bullets at bottom, smaller and horizontal
  if (data.bulletPoints.length > 0) {
    const bullets = data.bulletPoints.map((point) => ({
      text: point,
      options: {
        fontSize: 14,
        fontFace: config.branding.fonts.body,
        color: bareHex(config.branding.colors.text),
        bullet: true,
        breakLine: true,
        lineSpacingMultiple: 1.4,
        paraSpaceAfter: 6,
      },
    }));

    slide.addText(bullets, {
      x: 0.7,
      y: 5.0,
      w: 11.5,
      h: 2.0,
      valign: "top",
    });
  }
}

// ── Full-image layout ───────────────────────────────────────────────────

function addFullImageSlide(
  slide: PptxSlide,
  data: SlideData,
  imagePath: string | undefined,
  config: Config,
): void {
  slide.addNotes(data.narration);

  // Full-bleed background image
  if (imagePath) {
    slide.addImage({
      path: imagePath,
      x: 0,
      y: 0,
      w: "100%",
      h: "100%",
      sizing: { type: "cover", w: 13.333, h: 7.5 },
    });
    // Semi-transparent overlay for text readability (45%)
    slide.addShape("rect", {
      x: 0,
      y: 0,
      w: "100%",
      h: "100%",
      fill: { color: bareHex(config.branding.colors.background), transparency: 45 },
    });
  }

  // Title overlaid at top
  slide.addText(data.slideTitle, {
    x: 0.5,
    y: 0.3,
    w: 12.333,
    h: 0.9,
    fontSize: 28,
    fontFace: config.branding.fonts.heading,
    color: bareHex(config.branding.colors.primary),
    bold: true,
    valign: "middle",
  });

  // Subheading
  if (data.subheading) {
    slide.addText(data.subheading, {
      x: 0.5,
      y: 1.2,
      w: 12.333,
      h: 0.5,
      fontSize: 16,
      fontFace: config.branding.fonts.body,
      color: "FFFFFF",
      italic: true,
      valign: "top",
    });
  }

  // Key quote large and centered if present
  if (data.keyQuote) {
    slide.addText(`\u201C${data.keyQuote}\u201D`, {
      x: 1.0,
      y: 2.5,
      w: 11.333,
      h: 2.0,
      fontSize: 26,
      fontFace: config.branding.fonts.body,
      color: "FFFFFF",
      italic: true,
      align: "center",
      valign: "middle",
    });
  }

  // Bullet points overlaid in bottom-left
  if (data.bulletPoints.length > 0) {
    const bullets = data.bulletPoints.map((point) => ({
      text: point,
      options: {
        fontSize: 16,
        fontFace: config.branding.fonts.body,
        color: "FFFFFF",
        bullet: true,
        breakLine: true,
        lineSpacingMultiple: 1.5,
        paraSpaceAfter: 8,
      },
    }));

    slide.addText(bullets, {
      x: 0.7,
      y: data.keyQuote ? 4.8 : 2.5,
      w: 8.0,
      h: data.keyQuote ? 2.2 : 4.5,
      valign: "top",
    });
  }
}

// ── Two-column layout ───────────────────────────────────────────────────

function addTwoColumnSlide(
  slide: PptxSlide,
  data: SlideData,
  imagePath: string | undefined,
  config: Config,
): void {
  slide.addNotes(data.narration);

  const contentY = addTitleBand(slide, data, config);

  let columnsY = contentY;

  // Key quote above columns if present
  if (data.keyQuote) {
    columnsY = addKeyQuoteBlock(slide, data.keyQuote, contentY, config, {
      w: 11.5,
      x: 0.7,
      fontSize: 20,
      h: 0.9,
    });
  }

  // Split bullets into two columns
  const midpoint = Math.ceil(data.bulletPoints.length / 2);
  const leftBullets = data.bulletPoints.slice(0, midpoint);
  const rightBullets = data.bulletPoints.slice(midpoint);

  const makeBullets = (points: string[]) =>
    points.map((point) => ({
      text: point,
      options: {
        fontSize: 18,
        fontFace: config.branding.fonts.body,
        color: bareHex(config.branding.colors.text),
        bullet: true,
        breakLine: true,
        lineSpacingMultiple: 1.6,
        paraSpaceAfter: 12,
      },
    }));

  const columnHeight = 6.8 - columnsY;

  // Left column
  if (leftBullets.length > 0) {
    slide.addText(makeBullets(leftBullets), {
      x: 0.7,
      y: columnsY,
      w: 5.5,
      h: columnHeight,
      valign: "top",
    });
  }

  // Right column
  if (rightBullets.length > 0) {
    slide.addText(makeBullets(rightBullets), {
      x: 7.0,
      y: columnsY,
      w: 5.5,
      h: columnHeight,
      valign: "top",
    });
  }

  // Small centered image at bottom if available
  if (imagePath) {
    slide.addImage({
      path: imagePath,
      x: 5.167,
      y: 6.0,
      w: 3.0,
      h: 1.2,
      rounding: true,
      sizing: { type: "cover", w: 3.0, h: 1.2 },
    });
  }
}

// ── Key-point layout ────────────────────────────────────────────────────

function addKeyPointSlide(
  slide: PptxSlide,
  data: SlideData,
  imagePath: string | undefined,
  config: Config,
): void {
  slide.addNotes(data.narration);

  const contentY = addTitleBand(slide, data, config);

  // First bullet as the big key point
  const keyPoint = data.bulletPoints[0] ?? "";
  const remainingBullets = data.bulletPoints.slice(1);

  let keyPointEndY = contentY;

  // Large centered key point
  slide.addText(keyPoint, {
    x: 0.7,
    y: contentY,
    w: 8.5,
    h: 1.5,
    fontSize: 28,
    fontFace: config.branding.fonts.heading,
    color: bareHex(config.branding.colors.primary),
    bold: true,
    align: "center",
    valign: "middle",
  });
  keyPointEndY = contentY + 1.5;

  // Key quote below key point if present
  if (data.keyQuote) {
    keyPointEndY = addKeyQuoteBlock(slide, data.keyQuote, keyPointEndY, config, {
      w: 8.5,
      x: 0.7,
      fontSize: 18,
      h: 0.8,
    });
  }

  // Remaining bullets below
  if (remainingBullets.length > 0) {
    const bullets = remainingBullets.map((point) => ({
      text: point,
      options: {
        fontSize: 18,
        fontFace: config.branding.fonts.body,
        color: bareHex(config.branding.colors.text),
        bullet: true,
        breakLine: true,
        lineSpacingMultiple: 1.6,
        paraSpaceAfter: 12,
      },
    }));

    slide.addText(bullets, {
      x: 0.7,
      y: keyPointEndY + 0.2,
      w: 8.5,
      h: 7.0 - keyPointEndY - 0.2,
      valign: "top",
    });
  }

  // Image on right side, smaller
  if (imagePath) {
    slide.addImage({
      path: imagePath,
      x: 9.8,
      y: contentY,
      w: 3.0,
      h: 3.0,
      rounding: true,
      sizing: { type: "cover", w: 3.0, h: 3.0 },
    });
  }
}

// ── Template application ─────────────────────────────────────────────────

async function applyTemplate(
  generatedPath: string,
  templatePath: string,
): Promise<void> {
  const [generatedBuf, templateBuf] = await Promise.all([
    readFile(generatedPath),
    readFile(templatePath),
  ]);

  const generated = new PizZip(generatedBuf);
  const template = new PizZip(templateBuf);

  // Copy theme
  const themeFile = template.file("ppt/theme/theme1.xml");
  if (themeFile) {
    generated.file("ppt/theme/theme1.xml", themeFile.asUint8Array());
  }

  // Copy slide master and its relationships
  const masterFile = template.file("ppt/slideMasters/slideMaster1.xml");
  if (masterFile) {
    generated.file(
      "ppt/slideMasters/slideMaster1.xml",
      masterFile.asUint8Array(),
    );
  }
  const masterRels = template.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
  );
  if (masterRels) {
    generated.file(
      "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      masterRels.asUint8Array(),
    );
  }

  // Copy all slide layouts from template
  for (const entry of template.folder("ppt/slideLayouts").file(/.*/)) {
    if (!entry.dir) {
      generated.file(entry.name, entry.asUint8Array());
    }
  }
  // Copy slide layout relationships
  for (const entry of template
    .folder("ppt/slideLayouts/_rels")
    .file(/.*/)) {
    if (!entry.dir) {
      generated.file(entry.name, entry.asUint8Array());
    }
  }

  // Write back
  const output = generated.generate({ type: "nodebuffer" });
  await writeFile(generatedPath, output);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 100);
}
