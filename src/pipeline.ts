import { resolve } from "node:path";
import type {
  CliArgs,
  Config,
  NarrationScript,
  Presentation,
  TemplateManifest,
} from "./types/index.js";
import { createTempDir } from "./lib/temp-dir.js";
import { loadTemplateManifest } from "./lib/template-manifest.js";
import * as logger from "./lib/logger.js";
import { extractContext } from "./steps/01-context-extract.js";
import { generateScript } from "./steps/02-script-generate.js";
import { generateNarration } from "./steps/02a-narration-generate.js";
import { extractSlideStructure } from "./steps/02b-slide-structure.js";
import { phoneticsPass } from "./steps/02c-phonetics-pass.js";
import { criticRefine } from "./steps/02d-critic-refine.js";
import { fetchImages } from "./steps/03-image-fetch.js";
import { generateTts } from "./steps/04-tts-generate.js";
import { designSlideContent } from "./steps/04b-slide-content-design.js";
import { validateDesign } from "./steps/04c-design-validate.js";
import { generatePptx } from "./steps/05-pptx-generate.js";
import { generatePptxV2 } from "./steps/05-pptx-generate-v2.js";
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

    // Load template manifest when template engine is enabled
    let templateManifest: TemplateManifest | undefined;
    if (config.pipeline.useTemplateEngine && config.branding.templateManifest) {
      try {
        templateManifest = await loadTemplateManifest(
          resolve(config.branding.assetsDir, config.branding.templateManifest),
        );
      } catch (err) {
        logger.failStep("Template manifest loading failed");
        throw err;
      }
    }

    // 2. Content generation (feature-flagged)
    let presentation: Presentation;
    let narrationScript: NarrationScript | undefined;

    if (config.pipeline.useIterativeContent) {
      // 2a. Generate narration script
      try {
        narrationScript = await generateNarration({
          topic: args.topic,
          contextText,
          speakerIdentity: config.script.speakerIdentity,
          targetAudience: config.script.targetAudience,
          systemPrompt: config.script.systemPrompt,
          durationMinutes: config.script.durationMinutes,
        });
      } catch (err) {
        logger.failStep("Narration generation failed");
        throw err;
      }

      // 2b. Extract slide structure from narration
      try {
        presentation = await extractSlideStructure({
          narrationScript,
          contextText,
          templateManifest,
          slideStructureNotes: config.script.slideStructureNotes,
        });
      } catch (err) {
        logger.failStep("Slide structure extraction failed");
        throw err;
      }

      // 2d. Critic refinement loop (optional)
      if (config.pipeline.enableCritic) {
        try {
          presentation = await criticRefine({
            presentation,
            narrationScript,
            contextText,
          });
        } catch (err) {
          logger.failStep("Critic refinement failed");
          throw err;
        }
      }
    } else {
      // Legacy path: single-shot script generation
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
    }

    // 2c. Phonetics pass for TTS
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

    // 4c. Design validation (feature-flagged)
    if (config.pipeline.enableDesignValidation) {
      try {
        pptxPresentation = validateDesign({
          presentation: pptxPresentation,
          config,
        });
      } catch (err) {
        logger.failStep("Design validation failed");
        throw err;
      }
    }

    // 5. Generate PPTX (feature-flagged)
    let pptxPath: string;
    if (
      config.pipeline.useTemplateEngine &&
      config.branding.templateManifest &&
      config.branding.templatePptx &&
      templateManifest
    ) {
      try {
        pptxPath = await generatePptxV2({
          presentation: pptxPresentation,
          imagePaths,
          config,
          tempDir,
          templatePptxPath: resolve(config.branding.assetsDir, config.branding.templatePptx),
          templateManifest,
        });
      } catch (err) {
        logger.failStep("PPTX generation (v2) failed");
        throw err;
      }
    } else {
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
