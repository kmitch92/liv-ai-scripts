import { resolve } from "node:path";
import type { CliArgs, Config, Presentation } from "./types/index.js";
import { createTempDir } from "./lib/temp-dir.js";
import * as logger from "./lib/logger.js";
import { extractContext } from "./steps/01-context-extract.js";
import { generateScript } from "./steps/02-script-generate.js";
import { fetchImages } from "./steps/03-image-fetch.js";
import { phoneticsPass } from "./steps/02c-phonetics-pass.js";
import { generateTts } from "./steps/04-tts-generate.js";
import { designSlideContent } from "./steps/04b-slide-content-design.js";
import { generatePptx } from "./steps/05-pptx-generate.js";
import { assembleVideo } from "./steps/06-video-assemble.js";
import { createArchive } from "./steps/07-archive.js";

interface PipelineOptions {
  args: CliArgs;
  config: Config;
}

export async function runPipeline(options: PipelineOptions): Promise<string> {
  const { args, config } = options;
  const startTime = Date.now();

  const { path: tempDir, cleanup } = await createTempDir();
  logger.info(`Temp directory: ${tempDir}`);

  try {
    // 1. Extract context files
    let contextText: string;
    try {
      contextText = await extractContext(config.script.contextFiles);
    } catch (err) {
      logger.failStep("Context extraction failed");
      throw err;
    }

    // 2. Generate script
    let presentation: Presentation;
    try {
      presentation = await generateScript({
        topic: args.topic,
        contextText,
        speakerIdentity: config.script.speakerIdentity,
        targetAudience: config.script.targetAudience,
        systemPrompt: config.script.systemPrompt,
        durationMinutes: config.script.durationMinutes,
      });
    } catch (err) {
      logger.failStep("Script generation failed");
      throw err;
    }

    // 2b. Phonetics pass for TTS
    let ttsPresentation: Presentation;
    try {
      ttsPresentation = await phoneticsPass(presentation, config.script.phoneticsOverrides ?? []);
    } catch {
      logger.warn("Phonetics pass failed, using original narration for TTS");
      ttsPresentation = presentation;
    }

    // 3. Fetch images
    let imagePaths: string[];
    try {
      imagePaths = await fetchImages({
        slides: presentation.slides,
        tempDir,
        brandColors: config.branding.colors,
        topic: args.topic,
      });
    } catch (err) {
      logger.failStep("Image fetching failed");
      throw err;
    }

    // 4. Generate TTS
    let audioPaths: string[];
    let actualDurations: number[];
    try {
      const ttsResult = await generateTts({
        slides: ttsPresentation.slides,
        tempDir,
        elevenlabs: config.elevenlabs,
      });
      audioPaths = ttsResult.audioPaths;
      actualDurations = ttsResult.actualDurations;
    } catch (err) {
      logger.failStep("TTS generation failed");
      throw err;
    }

    // 4b. Design slide visual content
    let pptxPresentation: Presentation;
    try {
      pptxPresentation = await designSlideContent(presentation, contextText);
    } catch {
      logger.warn("Slide content design failed, using original content");
      pptxPresentation = presentation;
    }

    // 5. Generate PPTX
    let pptxPath: string;
    try {
      pptxPath = await generatePptx({
        presentation: pptxPresentation,
        imagePaths,
        config,
        tempDir,
      });
    } catch (err) {
      logger.failStep("PPTX generation failed");
      throw err;
    }

    // 6. Assemble video
    let videoPath: string;
    try {
      videoPath = await assembleVideo({
        pptxPath,
        imagePaths,
        audioPaths,
        actualDurations,
        presentation,
        config,
        tempDir,
      });
    } catch (err) {
      logger.failStep("Video assembly failed");
      throw err;
    }

    // 7. Create archive
    let archivePath: string;
    try {
      archivePath = await createArchive({
        presentation,
        pptxPath,
        videoPath,
        audioPaths,
        topic: args.topic,
        outputPath: args.output,
      });
    } catch (err) {
      logger.failStep("Archive creation failed");
      throw err;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.success(`Pipeline complete in ${elapsed}s`);

    return archivePath;
  } finally {
    await cleanup();
  }
}
