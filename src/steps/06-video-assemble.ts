import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { mkdir, writeFile, readdir, copyFile, unlink } from "node:fs/promises";
import { promisify } from "node:util";
import sharp from "sharp";
import type { Presentation, Config, Slide } from "../types/index.js";
import { startStep, succeedStep, info, warn } from "../lib/logger.js";

const execFile = promisify(execFileCb);

const VIDEO_WIDTH = 1920;
const VIDEO_HEIGHT = 1080;
const SLIDE_GAP_SECONDS = 1.5;

interface VideoAssembleOptions {
  pptxPath: string;
  imagePaths: string[];
  audioPaths: string[];
  actualDurations: number[];
  presentation: Presentation;
  config: Config;
  tempDir: string;
}

export async function assembleVideo(
  options: VideoAssembleOptions,
): Promise<{ videoPath: string; silentVideoPath: string }> {
  const {
    pptxPath,
    imagePaths,
    audioPaths,
    actualDurations,
    presentation,
    config,
    tempDir,
  } = options;

  startStep("Assembling video...");

  const videoDir = path.join(tempDir, "video");
  await mkdir(videoDir, { recursive: true });

  // Step 1: Generate slide images (LibreOffice or sharp fallback)
  const slideImages = await generateSlideImages(
    pptxPath,
    imagePaths,
    presentation,
    config,
    videoDir,
  );

  // Step 2: Concatenate audio files
  const concatAudioPath = path.join(videoDir, "audio-concat.mp3");
  await concatenateAudio(audioPaths, concatAudioPath, videoDir);

  // Step 3: Build ffmpeg concat file and produce video
  const concatFilePath = path.join(videoDir, "concat.txt");
  await writeConcatFile(concatFilePath, slideImages, actualDurations);

  const outputPath = path.join(tempDir, "video.mp4");
  await runFfmpeg(concatFilePath, concatAudioPath, outputPath);

  // Generate a silent copy (video track only, no audio)
  const silentOutputPath = path.join(tempDir, "video-silent.mp4");
  await execFile("ffmpeg", ["-y", "-i", outputPath, "-c:v", "copy", "-an", silentOutputPath], {
    timeout: 300_000,
  });

  succeedStep("Video assembled");
  return { videoPath: outputPath, silentVideoPath: silentOutputPath };
}

// ---------------------------------------------------------------------------
// Tool availability checks
// ---------------------------------------------------------------------------

async function isLibreOfficeAvailable(): Promise<boolean> {
  try {
    await execFile("which", ["libreoffice"]);
    return true;
  } catch {
    return false;
  }
}

async function isPdftoppmAvailable(): Promise<boolean> {
  try {
    await execFile("which", ["pdftoppm"]);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Slide image generation orchestrator
// ---------------------------------------------------------------------------

export async function generateSlideImages(
  pptxPath: string,
  imagePaths: string[],
  presentation: Presentation,
  config: Config,
  videoDir: string,
): Promise<string[]> {
  const slidesDir = path.join(videoDir, "slides");
  await mkdir(slidesDir, { recursive: true });

  const hasLibreOffice = await isLibreOfficeAvailable();
  const hasPdftoppm = await isPdftoppmAvailable();

  if (hasLibreOffice && hasPdftoppm) {
    try {
      return await generateWithLibreOffice(
        pptxPath,
        slidesDir,
        presentation.slides.length,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warn(`LibreOffice export failed (${msg}), falling back to sharp`);
    }
  } else {
    if (!hasLibreOffice) warn("LibreOffice not found");
    if (!hasPdftoppm) warn("pdftoppm not found (install poppler-utils)");
    warn("Using sharp fallback for slide images");
  }

  return generateWithSharp(imagePaths, presentation, config, slidesDir);
}

// ---------------------------------------------------------------------------
// LibreOffice PPTX -> PDF -> pdftoppm pipeline
// ---------------------------------------------------------------------------

export async function generateWithLibreOffice(
  pptxPath: string,
  outputDir: string,
  expectedCount: number,
): Promise<string[]> {
  info("Using LibreOffice to export slide images (PPTX -> PDF -> PNG)");

  // 1. Export PPTX to PDF
  await execFile("libreoffice", [
    "--headless",
    "--convert-to",
    "pdf",
    "--outdir",
    outputDir,
    pptxPath,
  ]);

  // 2. Find the generated PDF (filename may differ from input)
  const dirFiles = await readdir(outputDir);
  const pdfFiles = dirFiles.filter((f) => f.toLowerCase().endsWith(".pdf"));

  if (pdfFiles.length === 0) {
    throw new Error("LibreOffice produced no PDF file");
  }

  const pdfPath = path.join(outputDir, pdfFiles[0]);
  const slidePrefix = path.join(outputDir, "slide");

  // 3. Run pdftoppm to rasterise each page as PNG
  await execFile("pdftoppm", ["-png", "-r", "150", pdfPath, slidePrefix]);

  // 4. Glob for slide-*.png, sort numerically
  const afterFiles = await readdir(outputDir);
  const pngFiles = afterFiles
    .filter((f) => f.startsWith("slide-") && f.endsWith(".png"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (pngFiles.length === 0) {
    throw new Error("pdftoppm produced no PNG files");
  }

  if (pngFiles.length !== expectedCount) {
    throw new Error(
      `pdftoppm produced ${pngFiles.length} images, expected ${expectedCount}`,
    );
  }

  // 5. Resize each to 1920x1080 with sharp
  const results: string[] = [];
  for (let i = 0; i < pngFiles.length; i++) {
    const srcPath = path.join(outputDir, pngFiles[i]);
    const destPath = path.join(outputDir, `frame-${i}.png`);

    await sharp(srcPath)
      .resize(VIDEO_WIDTH, VIDEO_HEIGHT, { fit: "contain", background: "#000" })
      .png()
      .toFile(destPath);

    results.push(destPath);
  }

  // Clean up intermediate PDF
  await unlink(pdfPath).catch(() => {});

  return results;
}

// ---------------------------------------------------------------------------
// Sharp fallback with rich SVG overlays
// ---------------------------------------------------------------------------

async function generateWithSharp(
  imagePaths: string[],
  presentation: Presentation,
  config: Config,
  outputDir: string,
): Promise<string[]> {
  info("Using sharp to composite slide images with text overlay");

  const results: string[] = [];

  for (let i = 0; i < presentation.slides.length; i++) {
    const slide = presentation.slides[i];
    const outputPath = path.join(outputDir, `frame-${i}.png`);

    // Use stock image if available, otherwise solid background
    let baseImage: sharp.Sharp;
    if (imagePaths[i]) {
      baseImage = sharp(imagePaths[i]).resize(VIDEO_WIDTH, VIDEO_HEIGHT, {
        fit: "cover",
      });
    } else {
      baseImage = sharp({
        create: {
          width: VIDEO_WIDTH,
          height: VIDEO_HEIGHT,
          channels: 3,
          background: config.branding.colors.background,
        },
      });
    }

    const svgOverlay = buildSlideOverlaySvg(slide, config);

    await baseImage
      .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
      .png()
      .toFile(outputPath);

    results.push(outputPath);
  }

  return results;
}

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

function getBulletFontSize(count: number): number {
  if (count <= 3) return 28;
  if (count <= 4) return 26;
  if (count <= 5) return 24;
  return 20;
}

function getLineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.5);
}

function getMaxCharsForFontSize(fontSize: number): number {
  if (fontSize >= 40) return 30;
  if (fontSize >= 36) return 35;
  if (fontSize >= 28) return 42;
  if (fontSize >= 24) return 50;
  if (fontSize >= 22) return 55;
  return 60;
}

function shadowFilterDef(): string {
  return `<defs>
    <filter id="shadow" x="-2%" y="-2%" width="104%" height="104%">
      <feDropShadow dx="1" dy="1" stdDeviation="2" flood-color="#000000" flood-opacity="0.7"/>
    </filter>
  </defs>`;
}

function svgOpen(): string {
  return `<svg width="${VIDEO_WIDTH}" height="${VIDEO_HEIGHT}" xmlns="http://www.w3.org/2000/svg">`;
}

/** Render a title bar at the top of the slide. */
function titleBarSvg(
  slide: Slide,
  config: Config,
  barHeight: number = 130,
): string {
  const fontFamily = config.branding.fonts.heading;
  const primaryColor = config.branding.colors.primary;
  let svg = `<rect x="0" y="0" width="${VIDEO_WIDTH}" height="${barHeight}" fill="${primaryColor}" fill-opacity="0.85"/>`;
  svg += `<text x="60" y="80" font-family="${fontFamily}, sans-serif" font-size="40" font-weight="bold" fill="#FFFFFF" filter="url(#shadow)">${escapeXml(slide.slideTitle)}</text>`;

  if (slide.subheading) {
    svg += `<text x="60" y="115" font-family="${fontFamily}, sans-serif" font-size="24" font-style="italic" fill="#FFFFFF" fill-opacity="0.8" filter="url(#shadow)">${escapeXml(slide.subheading)}</text>`;
  }

  return svg;
}

// ---------------------------------------------------------------------------
// SVG layout dispatcher
// ---------------------------------------------------------------------------

function buildSlideOverlaySvg(slide: Slide, config: Config): string {
  const layout = slide.layoutStyle ?? "standard";
  switch (layout) {
    case "quote-focus":
      return buildQuoteFocusSvg(slide, config);
    case "full-image":
      return buildFullImageSvg(slide, config);
    case "two-column":
      return buildTwoColumnSvg(slide, config);
    case "key-point":
      return buildKeyPointSvg(slide, config);
    default:
      return buildStandardSvg(slide, config);
  }
}

// ---------------------------------------------------------------------------
// Layout: standard
// ---------------------------------------------------------------------------

function buildStandardSvg(slide: Slide, config: Config): string {
  const bodyFont = config.branding.fonts.body;
  const secondaryColor = config.branding.colors.secondary;
  const bulletFontSize = getBulletFontSize(slide.bulletPoints.length);
  const lineHeight = getLineHeight(bulletFontSize);
  const maxChars = getMaxCharsForFontSize(bulletFontSize);

  // Compute wrapped bullets
  const wrappedBullets: string[][] = slide.bulletPoints.map((bp) =>
    wrapText(bp, maxChars),
  );
  const totalBulletLines = wrappedBullets.reduce((s, lines) => s + lines.length, 0);

  const bulletBoxY = 150;
  const bulletBoxPadY = 20;
  const bulletBoxHeight = totalBulletLines * lineHeight + bulletBoxPadY * 2;

  let bulletsSvg = "";
  let cursorY = bulletBoxY + bulletBoxPadY + bulletFontSize;
  for (const lines of wrappedBullets) {
    for (let j = 0; j < lines.length; j++) {
      const prefix = j === 0 ? "\u2022 " : "  ";
      bulletsSvg += `<text x="80" y="${cursorY}" font-family="${bodyFont}, sans-serif" font-size="${bulletFontSize}" fill="#FFFFFF" filter="url(#shadow)">${escapeXml(prefix + lines[j])}</text>\n    `;
      cursorY += lineHeight;
    }
  }

  // Key quote at bottom
  let quoteSvg = "";
  if (slide.keyQuote) {
    const quoteLines = wrapText(slide.keyQuote, 50);
    const quoteLineHeight = getLineHeight(30);
    const quoteBoxHeight = quoteLines.length * quoteLineHeight + 40;
    const quoteBoxY = VIDEO_HEIGHT - quoteBoxHeight - 30;
    quoteSvg += `<rect x="40" y="${quoteBoxY}" width="${VIDEO_WIDTH - 80}" height="${quoteBoxHeight}" rx="12" fill="${secondaryColor}" fill-opacity="0.6"/>`;
    let qy = quoteBoxY + 30 + 15;
    for (const ql of quoteLines) {
      quoteSvg += `<text x="80" y="${qy}" font-family="${bodyFont}, sans-serif" font-size="30" font-style="italic" fill="#FFFFFF" filter="url(#shadow)">\u201C${escapeXml(ql)}\u201D</text>\n    `;
      qy += quoteLineHeight;
    }
  }

  return `${svgOpen()}
  ${shadowFilterDef()}
  ${titleBarSvg(slide, config)}
  <rect x="40" y="${bulletBoxY}" width="900" height="${bulletBoxHeight}" rx="12" fill="rgba(0,0,0,0.5)"/>
    ${bulletsSvg}
  ${quoteSvg}
</svg>`;
}

// ---------------------------------------------------------------------------
// Layout: quote-focus
// ---------------------------------------------------------------------------

function buildQuoteFocusSvg(slide: Slide, config: Config): string {
  const bodyFont = config.branding.fonts.body;
  const quoteText = slide.keyQuote ?? slide.bulletPoints[0] ?? "";
  const quoteLines = wrapText(quoteText, 35);
  const quoteLineHeight = getLineHeight(36);
  const quoteBlockHeight = quoteLines.length * quoteLineHeight + 60;
  const quoteBoxY = Math.max(180, Math.round((VIDEO_HEIGHT - quoteBlockHeight) / 2) - 40);

  let quoteSvg = `<rect x="160" y="${quoteBoxY}" width="${VIDEO_WIDTH - 320}" height="${quoteBlockHeight}" rx="16" fill="rgba(0,0,0,0.55)"/>`;
  let qy = quoteBoxY + 50;
  for (let i = 0; i < quoteLines.length; i++) {
    const prefix = i === 0 ? "\u201C" : "";
    const suffix = i === quoteLines.length - 1 ? "\u201D" : "";
    quoteSvg += `<text x="${VIDEO_WIDTH / 2}" y="${qy}" text-anchor="middle" font-family="${bodyFont}, sans-serif" font-size="36" font-style="italic" fill="#FFFFFF" filter="url(#shadow)">${escapeXml(prefix + quoteLines[i] + suffix)}</text>\n    `;
    qy += quoteLineHeight;
  }

  // Small bullets at bottom
  let bulletsSvg = "";
  if (slide.bulletPoints.length > 0) {
    const bulletY = VIDEO_HEIGHT - 100;
    const bulletText = slide.bulletPoints.map((bp) => escapeXml(bp)).join("   \u2022   ");
    bulletsSvg = `<rect x="40" y="${bulletY - 30}" width="${VIDEO_WIDTH - 80}" height="60" rx="8" fill="rgba(0,0,0,0.4)"/>`;
    bulletsSvg += `<text x="${VIDEO_WIDTH / 2}" y="${bulletY + 8}" text-anchor="middle" font-family="${bodyFont}, sans-serif" font-size="22" fill="#FFFFFF" fill-opacity="0.9" filter="url(#shadow)">\u2022 ${bulletText}</text>`;
  }

  return `${svgOpen()}
  ${shadowFilterDef()}
  ${titleBarSvg(slide, config)}
  ${quoteSvg}
  ${bulletsSvg}
</svg>`;
}

// ---------------------------------------------------------------------------
// Layout: full-image
// ---------------------------------------------------------------------------

function buildFullImageSvg(slide: Slide, config: Config): string {
  const bodyFont = config.branding.fonts.body;
  const fontFamily = config.branding.fonts.heading;

  // Minimal title bar (dark semi-transparent)
  let titleSvg = `<rect x="0" y="0" width="${VIDEO_WIDTH}" height="100" fill="rgba(0,0,0,0.6)"/>`;
  titleSvg += `<text x="60" y="65" font-family="${fontFamily}, sans-serif" font-size="40" font-weight="bold" fill="#FFFFFF" filter="url(#shadow)">${escapeXml(slide.slideTitle)}</text>`;

  // Key quote centered if present
  let quoteSvg = "";
  if (slide.keyQuote) {
    const quoteLines = wrapText(slide.keyQuote, 35);
    const quoteLineHeight = getLineHeight(36);
    let qy = Math.round(VIDEO_HEIGHT / 2) - Math.round((quoteLines.length * quoteLineHeight) / 2);
    for (const ql of quoteLines) {
      quoteSvg += `<text x="${VIDEO_WIDTH / 2}" y="${qy}" text-anchor="middle" font-family="${bodyFont}, sans-serif" font-size="36" font-style="italic" fill="#FFFFFF" filter="url(#shadow)">\u201C${escapeXml(ql)}\u201D</text>\n    `;
      qy += quoteLineHeight;
    }
  }

  // Compact bullets at bottom
  let bulletsSvg = "";
  if (slide.bulletPoints.length > 0) {
    const bulletBarHeight = Math.min(slide.bulletPoints.length * 32 + 24, 180);
    const bulletBarY = VIDEO_HEIGHT - bulletBarHeight - 20;
    bulletsSvg += `<rect x="30" y="${bulletBarY}" width="${VIDEO_WIDTH - 60}" height="${bulletBarHeight}" rx="10" fill="rgba(0,0,0,0.5)"/>`;
    let by = bulletBarY + 28;
    for (const bp of slide.bulletPoints) {
      const lines = wrapText(bp, 55);
      for (let j = 0; j < lines.length; j++) {
        const prefix = j === 0 ? "\u2022 " : "  ";
        bulletsSvg += `<text x="60" y="${by}" font-family="${bodyFont}, sans-serif" font-size="22" fill="#FFFFFF" filter="url(#shadow)">${escapeXml(prefix + lines[j])}</text>\n      `;
        by += 30;
      }
    }
  }

  return `${svgOpen()}
  ${shadowFilterDef()}
  ${titleSvg}
  ${quoteSvg}
  ${bulletsSvg}
</svg>`;
}

// ---------------------------------------------------------------------------
// Layout: two-column
// ---------------------------------------------------------------------------

function buildTwoColumnSvg(slide: Slide, config: Config): string {
  const bodyFont = config.branding.fonts.body;
  const secondaryColor = config.branding.colors.secondary;
  const bulletFontSize = getBulletFontSize(slide.bulletPoints.length);
  const lineHeight = getLineHeight(bulletFontSize);
  const maxChars = 38; // narrower columns

  const midIdx = Math.ceil(slide.bulletPoints.length / 2);
  const leftBullets = slide.bulletPoints.slice(0, midIdx);
  const rightBullets = slide.bulletPoints.slice(midIdx);

  function renderColumn(bullets: string[], xOffset: number, startY: number): { svg: string; height: number } {
    let svg = "";
    let cursorY = startY;
    for (const bp of bullets) {
      const lines = wrapText(bp, maxChars);
      for (let j = 0; j < lines.length; j++) {
        const prefix = j === 0 ? "\u2022 " : "  ";
        svg += `<text x="${xOffset}" y="${cursorY}" font-family="${bodyFont}, sans-serif" font-size="${bulletFontSize}" fill="#FFFFFF" filter="url(#shadow)">${escapeXml(prefix + lines[j])}</text>\n    `;
        cursorY += lineHeight;
      }
    }
    return { svg, height: cursorY - startY };
  }

  // Key quote above columns if present
  let quoteSvg = "";
  let columnsStartY = 170;
  if (slide.keyQuote) {
    const quoteLines = wrapText(slide.keyQuote, 50);
    const quoteLineHeight = getLineHeight(28);
    const quoteBoxHeight = quoteLines.length * quoteLineHeight + 30;
    quoteSvg += `<rect x="40" y="150" width="${VIDEO_WIDTH - 80}" height="${quoteBoxHeight}" rx="10" fill="${secondaryColor}" fill-opacity="0.6"/>`;
    let qy = 175;
    for (const ql of quoteLines) {
      quoteSvg += `<text x="80" y="${qy}" font-family="${bodyFont}, sans-serif" font-size="28" font-style="italic" fill="#FFFFFF" filter="url(#shadow)">\u201C${escapeXml(ql)}\u201D</text>\n    `;
      qy += quoteLineHeight;
    }
    columnsStartY = 150 + quoteBoxHeight + 20;
  }

  const leftCol = renderColumn(leftBullets, 80, columnsStartY + bulletFontSize);
  const rightCol = renderColumn(rightBullets, 1000, columnsStartY + bulletFontSize);
  const colHeight = Math.max(leftCol.height, rightCol.height) + 30;

  const colBgSvg =
    `<rect x="40" y="${columnsStartY}" width="880" height="${colHeight}" rx="12" fill="rgba(0,0,0,0.5)"/>` +
    `<rect x="960" y="${columnsStartY}" width="920" height="${colHeight}" rx="12" fill="rgba(0,0,0,0.5)"/>`;

  return `${svgOpen()}
  ${shadowFilterDef()}
  ${titleBarSvg(slide, config)}
  ${quoteSvg}
  ${colBgSvg}
  ${leftCol.svg}
  ${rightCol.svg}
</svg>`;
}

// ---------------------------------------------------------------------------
// Layout: key-point
// ---------------------------------------------------------------------------

function buildKeyPointSvg(slide: Slide, config: Config): string {
  const bodyFont = config.branding.fonts.body;
  const primaryColor = config.branding.colors.primary;
  const secondaryColor = config.branding.colors.secondary;

  const keyPoint = slide.bulletPoints[0] ?? "";
  const remainingBullets = slide.bulletPoints.slice(1);

  // Big key point in center
  const keyLines = wrapText(keyPoint, 30);
  const keyLineHeight = getLineHeight(36);
  const keyBlockHeight = keyLines.length * keyLineHeight + 60;
  const keyBoxY = 180;

  let keySvg = `<rect x="100" y="${keyBoxY}" width="${VIDEO_WIDTH - 200}" height="${keyBlockHeight}" rx="16" fill="rgba(0,0,0,0.6)"/>`;
  let ky = keyBoxY + 50;
  for (const kl of keyLines) {
    keySvg += `<text x="${VIDEO_WIDTH / 2}" y="${ky}" text-anchor="middle" font-family="${bodyFont}, sans-serif" font-size="36" font-weight="bold" fill="${primaryColor}" filter="url(#shadow)">${escapeXml(kl)}</text>\n    `;
    ky += keyLineHeight;
  }

  // Remaining bullets below
  let bulletsSvg = "";
  if (remainingBullets.length > 0) {
    const bulletStartY = keyBoxY + keyBlockHeight + 30;
    let by = bulletStartY + 30;
    const bulletLines: string[] = [];
    for (const bp of remainingBullets) {
      const lines = wrapText(bp, 50);
      for (let j = 0; j < lines.length; j++) {
        bulletLines.push(j === 0 ? "\u2022 " + lines[j] : "  " + lines[j]);
      }
    }
    const bulletBoxHeight = bulletLines.length * getLineHeight(24) + 30;
    bulletsSvg += `<rect x="100" y="${bulletStartY}" width="${VIDEO_WIDTH - 200}" height="${bulletBoxHeight}" rx="10" fill="rgba(0,0,0,0.45)"/>`;
    for (const bl of bulletLines) {
      bulletsSvg += `<text x="140" y="${by}" font-family="${bodyFont}, sans-serif" font-size="24" fill="#FFFFFF" filter="url(#shadow)">${escapeXml(bl)}</text>\n    `;
      by += getLineHeight(24);
    }
  }

  // Key quote at bottom
  let quoteSvg = "";
  if (slide.keyQuote) {
    const quoteLines = wrapText(slide.keyQuote, 50);
    const quoteLineHeight = getLineHeight(26);
    const quoteBoxHeight = quoteLines.length * quoteLineHeight + 30;
    const quoteBoxY = VIDEO_HEIGHT - quoteBoxHeight - 30;
    quoteSvg += `<rect x="100" y="${quoteBoxY}" width="${VIDEO_WIDTH - 200}" height="${quoteBoxHeight}" rx="10" fill="${secondaryColor}" fill-opacity="0.5"/>`;
    let qy = quoteBoxY + 28;
    for (const ql of quoteLines) {
      quoteSvg += `<text x="140" y="${qy}" font-family="${bodyFont}, sans-serif" font-size="26" font-style="italic" fill="#FFFFFF" filter="url(#shadow)">\u201C${escapeXml(ql)}\u201D</text>\n    `;
      qy += quoteLineHeight;
    }
  }

  return `${svgOpen()}
  ${shadowFilterDef()}
  ${titleBarSvg(slide, config)}
  ${keySvg}
  ${bulletsSvg}
  ${quoteSvg}
</svg>`;
}

// ---------------------------------------------------------------------------
// Audio concatenation (unchanged)
// ---------------------------------------------------------------------------

export async function concatenateAudio(
  audioPaths: string[],
  outputPath: string,
  workDir: string,
): Promise<void> {
  if (audioPaths.length === 0) {
    throw new Error("No audio files to concatenate");
  }

  if (audioPaths.length === 1) {
    await copyFile(audioPaths[0], outputPath);
    return;
  }

  // Generate silence file to insert between slides
  const silencePath = path.join(workDir, "silence.mp3");
  await execFile("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `anullsrc=r=44100:cl=stereo`,
    "-t",
    String(SLIDE_GAP_SECONDS),
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    silencePath,
  ]);

  // Interleave silence between each audio file
  const entries: string[] = [];
  for (let i = 0; i < audioPaths.length; i++) {
    entries.push(`file '${audioPaths[i]}'`);
    if (i < audioPaths.length - 1) {
      entries.push(`file '${silencePath}'`);
    }
  }

  const listPath = path.join(workDir, "audio-list.txt");
  const lines = entries.join("\n");
  await writeFile(listPath, lines, "utf-8");

  await execFile("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    outputPath,
  ]);
}

// ---------------------------------------------------------------------------
// FFmpeg concat file + video render (unchanged)
// ---------------------------------------------------------------------------

export async function writeConcatFile(
  concatFilePath: string,
  slideImages: string[],
  durations: number[],
): Promise<void> {
  const lines: string[] = [];

  for (let i = 0; i < slideImages.length; i++) {
    lines.push(`file '${slideImages[i]}'`);
    const gap = i < slideImages.length - 1 ? SLIDE_GAP_SECONDS : 0;
    lines.push(`duration ${(durations[i] ?? 5) + gap}`);
  }

  // ffmpeg concat demuxer requires the last file repeated without duration
  if (slideImages.length > 0) {
    lines.push(`file '${slideImages[slideImages.length - 1]}'`);
  }

  await writeFile(concatFilePath, lines.join("\n"), "utf-8");
}

export async function runFfmpeg(
  concatFile: string,
  audioPath: string,
  outputPath: string,
): Promise<void> {
  await execFile(
    "ffmpeg",
    [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatFile,
      "-i",
      audioPath,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-shortest",
      outputPath,
    ],
    { timeout: 300_000 },
  );
}
