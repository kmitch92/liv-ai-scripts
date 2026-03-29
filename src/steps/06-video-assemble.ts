import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { mkdir, writeFile, readdir, copyFile } from "node:fs/promises";
import { promisify } from "node:util";
import sharp from "sharp";
import type { Presentation, Config } from "../types/index.js";
import { startStep, succeedStep, info, warn } from "../lib/logger.js";

const execFile = promisify(execFileCb);

const VIDEO_WIDTH = 1920;
const VIDEO_HEIGHT = 1080;

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
): Promise<string> {
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

  succeedStep("Video assembled");
  return outputPath;
}

async function isLibreOfficeAvailable(): Promise<boolean> {
  try {
    await execFile("which", ["libreoffice"]);
    return true;
  } catch {
    return false;
  }
}

async function generateSlideImages(
  pptxPath: string,
  imagePaths: string[],
  presentation: Presentation,
  config: Config,
  videoDir: string,
): Promise<string[]> {
  const slidesDir = path.join(videoDir, "slides");
  await mkdir(slidesDir, { recursive: true });

  if (await isLibreOfficeAvailable()) {
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
    warn("LibreOffice not found, using sharp fallback for slide images");
  }

  return generateWithSharp(imagePaths, presentation, config, slidesDir);
}

async function generateWithLibreOffice(
  pptxPath: string,
  outputDir: string,
  expectedCount: number,
): Promise<string[]> {
  info("Using LibreOffice to export slide images");

  await execFile("libreoffice", [
    "--headless",
    "--convert-to",
    "png",
    "--outdir",
    outputDir,
    pptxPath,
  ]);

  // LibreOffice naming can vary; glob for PNGs and sort
  const files = await readdir(outputDir);
  const pngFiles = files
    .filter((f) => f.endsWith(".png"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (pngFiles.length === 0) {
    throw new Error("LibreOffice produced no PNG files");
  }

  if (pngFiles.length !== expectedCount) {
    warn(
      `LibreOffice produced ${pngFiles.length} images, expected ${expectedCount}`,
    );
  }

  // Ensure all images are 1920x1080
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

  return results;
}

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

    const svgOverlay = buildTextOverlaySvg(
      slide.slideTitle,
      slide.bulletPoints,
      config,
    );

    await baseImage
      .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
      .png()
      .toFile(outputPath);

    results.push(outputPath);
  }

  return results;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildTextOverlaySvg(
  title: string,
  bulletPoints: string[],
  config: Config,
): string {
  const fontFamily = config.branding.fonts.heading;
  const bodyFont = config.branding.fonts.body;

  // Title bar at the top
  const titleBarHeight = 120;
  const bulletStartY = titleBarHeight + 60;
  const bulletLineHeight = 50;

  const bulletsSvg = bulletPoints
    .map((bp, idx) => {
      const y = bulletStartY + idx * bulletLineHeight;
      return `<text x="100" y="${y}" font-family="${bodyFont}, sans-serif" font-size="28" fill="#FFFFFF" filter="url(#shadow)">&#x2022; ${escapeXml(bp)}</text>`;
    })
    .join("\n    ");

  return `<svg width="${VIDEO_WIDTH}" height="${VIDEO_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-2%" y="-2%" width="104%" height="104%">
      <feDropShadow dx="1" dy="1" stdDeviation="2" flood-color="#000000" flood-opacity="0.7"/>
    </filter>
  </defs>
  <rect x="0" y="0" width="${VIDEO_WIDTH}" height="${titleBarHeight}" fill="rgba(0,0,0,0.65)"/>
  <text x="60" y="75" font-family="${fontFamily}, sans-serif" font-size="42" font-weight="bold" fill="#FFFFFF">${escapeXml(title)}</text>
  <rect x="60" y="${titleBarHeight + 10}" width="${VIDEO_WIDTH - 120}" height="${bulletPoints.length * bulletLineHeight + 40}" rx="12" fill="rgba(0,0,0,0.45)"/>
    ${bulletsSvg}
</svg>`;
}

async function concatenateAudio(
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

  const listPath = path.join(workDir, "audio-list.txt");
  const lines = audioPaths.map((p) => `file '${p}'`).join("\n");
  await writeFile(listPath, lines, "utf-8");

  await execFile("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    outputPath,
  ]);
}

async function writeConcatFile(
  concatFilePath: string,
  slideImages: string[],
  durations: number[],
): Promise<void> {
  const lines: string[] = [];

  for (let i = 0; i < slideImages.length; i++) {
    lines.push(`file '${slideImages[i]}'`);
    lines.push(`duration ${durations[i] ?? 5}`);
  }

  // ffmpeg concat demuxer requires the last file repeated without duration
  if (slideImages.length > 0) {
    lines.push(`file '${slideImages[slideImages.length - 1]}'`);
  }

  await writeFile(concatFilePath, lines.join("\n"), "utf-8");
}

async function runFfmpeg(
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
