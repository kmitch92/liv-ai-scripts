import { z } from "zod";

export const PromptSourceSchema = z.union([
  z.object({ kind: z.literal("config"), jsonPath: z.string() }),
  z.object({ kind: z.literal("file"), relPath: z.string() }),
]);

export const PromptEntrySchema = z.object({
  id: z.string(),
  label: z.string(),
  purpose: z.string(),
  pipelineStep: z.string(),
  source: PromptSourceSchema,
  variables: z.array(z.string()).optional(),
  content: z.string(),
});
export type PromptEntry = z.infer<typeof PromptEntrySchema>;

export const PromptListSchema = z.array(PromptEntrySchema);

export const ConfigMetaSchema = z.object({
  name: z.string(),
  mtime: z.number(),
});
export type ConfigMeta = z.infer<typeof ConfigMetaSchema>;

export const ConfigListSchema = z.array(ConfigMetaSchema);

// Loose config — full shape validated server-side.
export const ConfigSchema = z.record(z.unknown());
export type ConfigDoc = z.infer<typeof ConfigSchema>;

export const RunMetaSchema = z.object({
  id: z.string(),
  runId: z.string().optional(),
  configName: z.string().optional(),
  topic: z.string().optional(),
  status: z.string(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  exitCode: z.number().nullable().optional(),
  archivePath: z.string().nullable().optional(),
  output: z.string().optional(),
  recutPaths: z.object({
    video: z.string(),
    silentVideo: z.string(),
  }).optional(),
}).passthrough();
export type RunMeta = z.infer<typeof RunMetaSchema>;

export const RunListSchema = z.array(RunMetaSchema);

export const RunDetailSchema = RunMetaSchema.extend({
  log: z.array(z.object({
    type: z.enum(["stdout", "stderr", "exit"]),
    line: z.string().optional(),
    code: z.number().nullable().optional(),
    timestamp: z.string().optional(),
  })).optional(),
}).passthrough();
export type RunDetail = z.infer<typeof RunDetailSchema>;

export const RunStartResponseSchema = z.object({
  runId: z.string(),
});

export const SseEventSchema = z.object({
  type: z.enum(["stdout", "stderr", "exit"]),
  line: z.string().optional(),
  code: z.number().nullable().optional(),
  timestamp: z.string().optional(),
});
export type SseEvent = z.infer<typeof SseEventSchema>;

export const SettingsSchema = z.object({
  keys: z.record(z.boolean()),
  deps: z.record(z.boolean()),
  outputPath: z.string(),
  libreOfficeInstallUrl: z.string(),
  libreOfficeInstallHint: z.string(),
  isElectron: z.boolean(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DepsSchema = z.record(z.boolean());
export type Deps = z.infer<typeof DepsSchema>;
