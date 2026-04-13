import path from "node:path";
import { mkdir, writeFile, copyFile, access } from "node:fs/promises";
import sharp from "sharp";
import type { Slide, TemplateManifest } from "../types/index.js";
import { startStep, succeedStep, failStep, warn } from "../lib/logger.js";
import { sanitizeTopic } from "../lib/sanitize-topic.js";
import { getLayoutById } from "../lib/template-manifest.js";

interface ImageFetchOptions {
  slides: Slide[];
  tempDir: string;
  brandColors: {
    primary: string;
    secondary: string;
    background: string;
    text: string;
  };
  topic: string;
  templateManifest?: TemplateManifest;
}

function slideNeedsImage(
  slide: Slide,
  manifest: TemplateManifest | undefined,
): boolean {
  if (!manifest) return true;
  if (!slide.templateLayoutId) return true;
  const layout = getLayoutById(manifest, slide.templateLayoutId);
  if (!layout) return true;
  return layout.placeholders.some((p) => p.type === "image");
}

function getOutputImagesDir(topic: string): string {
  return path.resolve("output", sanitizeTopic(topic), "images");
}

const IMAGE_WIDTH = 1280;
const IMAGE_HEIGHT = 720;
const MAX_CONCURRENCY = 3;

export async function fetchImages(
  options: ImageFetchOptions,
): Promise<string[]> {
  const { slides, tempDir, brandColors } = options;
  const imagesDir = path.join(tempDir, "images");
  await mkdir(imagesDir, { recursive: true });

  startStep(`Fetching images (0/${slides.length})...`);

  const paths: string[] = new Array(slides.length);
  let completed = 0;

  // Simple semaphore for concurrency limiting
  let running = 0;
  const queue: Array<() => void> = [];

  function acquire(): Promise<void> {
    if (running < MAX_CONCURRENCY) {
      running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      queue.push(() => {
        running++;
        resolve();
      });
    });
  }

  function release(): void {
    running--;
    const next = queue.shift();
    if (next) next();
  }

  const tasks = slides.map(async (slide, index) => {
    if (!slideNeedsImage(slide, options.templateManifest)) {
      paths[index] = "";
      completed++;
      startStep(`Fetching images (${completed}/${slides.length})...`);
      return;
    }
    await acquire();
    try {
      const outputPath = path.join(imagesDir, `slide-${index}.jpg`);
      paths[index] = outputPath;

      const cachedImagesDir = getOutputImagesDir(options.topic);
      await mkdir(cachedImagesDir, { recursive: true });
      const cachedPath = path.join(cachedImagesDir, `slide-${index}.jpg`);

      // Check cache first
      let usedCache = false;
      try {
        await access(cachedPath);
        await copyFile(cachedPath, outputPath);
        usedCache = true;
      } catch {
        // No cache, fetch from Unsplash
      }

      if (!usedCache) {
        try {
          const imageBuffer = await fetchUnsplashImage(slide.imageQuery);
          await sharp(imageBuffer)
            .resize(IMAGE_WIDTH, IMAGE_HEIGHT, { fit: "cover" })
            .jpeg({ quality: 85 })
            .toFile(outputPath);
          // Persist to cache
          await copyFile(outputPath, cachedPath);
        } catch (err) {
          warn(`Image fetch failed for slide ${index} ("${slide.imageQuery}"), using placeholder`);
          await generatePlaceholder(outputPath, brandColors.secondary);
        }
      }

      completed++;
      startStep(`Fetching images (${completed}/${slides.length})...`);
    } finally {
      release();
    }
  });

  await Promise.all(tasks);

  succeedStep(`Fetched ${slides.length} images`);
  return paths;
}

async function fetchUnsplashImage(query: string): Promise<Buffer> {
  const apiKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!apiKey) {
    throw new Error("UNSPLASH_ACCESS_KEY not set");
  }

  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", "landscape");
  url.searchParams.set("per_page", "1");

  const searchResponse = await fetch(url.toString(), {
    headers: { Authorization: `Client-ID ${apiKey}` },
  });

  if (!searchResponse.ok) {
    throw new Error(`Unsplash search failed: ${searchResponse.status}`);
  }

  const data = (await searchResponse.json()) as {
    results: Array<{ urls: { regular: string } }>;
  };

  if (!data.results || data.results.length === 0) {
    throw new Error(`No Unsplash results for query: "${query}"`);
  }

  const imageUrl = data.results[0].urls.regular;
  const imageResponse = await fetch(imageUrl);

  if (!imageResponse.ok) {
    throw new Error(`Image download failed: ${imageResponse.status}`);
  }

  const arrayBuffer = await imageResponse.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function generatePlaceholder(
  outputPath: string,
  backgroundColor: string,
): Promise<void> {
  await sharp({
    create: {
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      channels: 3,
      background: backgroundColor,
    },
  })
    .jpeg({ quality: 85 })
    .toFile(outputPath);
}
