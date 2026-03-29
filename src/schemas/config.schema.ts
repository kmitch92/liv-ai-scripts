import { z } from "zod";

export const ConfigSchema = z.object({
  branding: z.object({
    logo: z.string().describe("Path to logo image, relative to assetsDir"),
    assetsDir: z.string().describe("Base directory for brand assets"),
    templatePptx: z.string().optional().describe("Path to a template PPTX file"),
    colors: z.object({
      primary: z.string(),
      secondary: z.string(),
      background: z.string().default("#FFFFFF"),
      text: z.string().default("#1A1A1A"),
    }),
    fonts: z.object({
      heading: z.string().default("Arial"),
      body: z.string().default("Calibri"),
    }),
  }),
  elevenlabs: z.object({
    voiceId: z.string(),
    modelId: z.string().default("eleven_multilingual_v2"),
    stability: z.number().min(0).max(1).default(0.5),
    similarityBoost: z.number().min(0).max(1).default(0.75),
    style: z.number().min(0).max(1).default(0).describe("Style exaggeration. Higher = more emotive delivery."),
    speed: z.number().min(0.5).max(2).default(1).describe("Speech speed. 1.0 = normal."),
    useSpeakerBoost: z.boolean().default(true).describe("Enhances clarity and presence of the speaker voice."),
  }),
  script: z.object({
    speakerIdentity: z.string().describe("Who the speaker is, e.g. 'an expert GCSE English Literature teacher'"),
    targetAudience: z.string().describe("Who the presentation is for, e.g. 'GCSE students aged 14-16' or 'senior software engineers'"),
    systemPrompt: z.string().describe("Purpose/style of the presentation"),
    contextFiles: z.array(z.string()).default([]).describe("Paths to context files (PDF, txt, md) to include as reference material"),
    phoneticsOverrides: z.record(z.string(), z.string()).default({}).describe("Manual word→phonetic mappings applied before and after the LLM phonetics pass"),
    durationMinutes: z.number().min(1).max(60).default(15),
  }),
});
