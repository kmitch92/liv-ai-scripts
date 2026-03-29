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

    // Speaker notes
    pptxSlide.addNotes(slideData.narration);

    if (isFirst) {
      addTitleSlide(pptxSlide, slideData, imagePath, config);
    } else {
      addContentSlide(pptxSlide, slideData, imagePath, config);
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

  // Subtitle line below the title
  slide.addText(`Presented by ${config.script.speakerIdentity}`, {
    x: 1.0,
    y: 5.0,
    w: 11.333,
    h: 0.8,
    fontSize: 18,
    fontFace: config.branding.fonts.body,
    color: imagePath
      ? "FFFFFF"
      : bareHex(config.branding.colors.secondary),
    align: "center",
    valign: "top",
  });
}

// ── Content slide ────────────────────────────────────────────────────────

function addContentSlide(
  slide: PptxSlide,
  data: Presentation["slides"][number],
  imagePath: string | undefined,
  config: Config,
): void {
  // Title background band — secondary color behind the title area
  slide.addShape("rect", {
    x: 0,
    y: 0.15,
    w: "100%",
    h: 1.1,
    fill: { color: bareHex(config.branding.colors.secondary) },
  });

  // Title text (on top of the background band)
  slide.addText(data.slideTitle, {
    x: 0.5,
    y: 0.3,
    w: 12.333,
    h: 1.0,
    fontSize: 24,
    fontFace: config.branding.fonts.heading,
    color: bareHex(config.branding.colors.primary),
    bold: true,
    valign: "middle",
  });

  // Bullet points — left column, vertically distributed in content area
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
      y: 1.8,
      w: 6.0,
      h: 5.0,
      valign: "top",
    });
  }

  // Image — right column, vertically centered in content area
  if (imagePath) {
    slide.addImage({
      path: imagePath,
      x: 7.3,
      y: 1.6,
      w: 5.5,
      h: 5.2,
      rounding: true,
      sizing: { type: "cover", w: 5.5, h: 5.2 },
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
