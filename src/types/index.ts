import { z } from "zod";
import { ConfigSchema } from "../schemas/config.schema.js";
import {
  SlideSchema,
  PresentationSchema,
  DesignMetadataSchema,
} from "../schemas/slide.schema.js";
import { CliArgsSchema } from "../schemas/cli.schema.js";
import { ContentBlockSchema } from "../schemas/content-block.schema.js";
import {
  PlaceholderSchema,
  TemplateLayoutSchema,
  TemplateManifestSchema,
} from "../schemas/template-manifest.schema.js";

export type Config = z.infer<typeof ConfigSchema>;
export type Slide = z.infer<typeof SlideSchema>;
export type Presentation = z.infer<typeof PresentationSchema>;
export type CliArgs = z.infer<typeof CliArgsSchema>;
export type ContentBlock = z.infer<typeof ContentBlockSchema>;
export type DesignMetadata = z.infer<typeof DesignMetadataSchema>;
export type Placeholder = z.infer<typeof PlaceholderSchema>;
export type TemplateLayout = z.infer<typeof TemplateLayoutSchema>;
export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;

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
  DesignMetadataSchema,
  CliArgsSchema,
  ContentBlockSchema,
  PlaceholderSchema,
  TemplateLayoutSchema,
  TemplateManifestSchema,
};
