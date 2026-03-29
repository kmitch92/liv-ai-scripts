import { z } from "zod";
import { ConfigSchema } from "../schemas/config.schema.js";
import {
  SlideSchema,
  PresentationSchema,
} from "../schemas/slide.schema.js";
import { CliArgsSchema } from "../schemas/cli.schema.js";

export type Config = z.infer<typeof ConfigSchema>;
export type Slide = z.infer<typeof SlideSchema>;
export type Presentation = z.infer<typeof PresentationSchema>;
export type CliArgs = z.infer<typeof CliArgsSchema>;

/** Pipeline context passed between steps */
export type PipelineContext = {
  args: CliArgs;
  config: Config;
  tempDir: string;
  contextText?: string;
  presentation?: Presentation;
  imagePaths?: string[];
  audioPaths?: string[];
  actualDurations?: number[];
  pptxPath?: string;
  videoPath?: string;
  archivePath?: string;
};

// Re-export schemas for convenience
export {
  ConfigSchema,
  SlideSchema,
  PresentationSchema,
  CliArgsSchema,
};
