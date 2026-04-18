import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getAppRoot } from "./paths.js";

export type PromptSource =
  | { kind: "config"; jsonPath: string }
  | { kind: "file"; relPath: string };

export interface PromptMeta {
  id: string;
  label: string;
  purpose: string;
  pipelineStep: string;
  source: PromptSource;
  variables?: string[];
}

export const PROMPT_REGISTRY: PromptMeta[] = [
  {
    id: "script.systemPrompt",
    label: "Narration system prompt",
    purpose:
      "Top-level style and structure charter for narration. Injected into the narration LLM call alongside speakerIdentity and targetAudience. Controls pedagogical goals, mandatory slide types, tone, and examiner-awareness.",
    pipelineStep: "config",
    source: { kind: "config", jsonPath: "script.systemPrompt" },
  },
  {
    id: "script.speakerIdentity",
    label: "Speaker identity",
    purpose:
      "The persona the narration LLM adopts — voice, warmth, expertise level, relationship to the student.",
    pipelineStep: "config",
    source: { kind: "config", jsonPath: "script.speakerIdentity" },
  },
  {
    id: "script.targetAudience",
    label: "Target audience",
    purpose:
      "Who the narration is addressed to. Shapes vocabulary, assumed knowledge, and reading level.",
    pipelineStep: "config",
    source: { kind: "config", jsonPath: "script.targetAudience" },
  },
  {
    id: "powerpoint-notes",
    label: "PowerPoint slide structure notes",
    purpose:
      "Required slide ordering and per-slide content rules. Read by step 02b when extracting slide structure from the narration.",
    pipelineStep: "02b",
    source: { kind: "file", relPath: "assets/prompts/powerpoint-notes.txt" },
  },
  {
    id: "02a-narration-generate",
    label: "02a — Narration generator",
    purpose:
      "Primary narration generator. Writes the draft spoken script for the lesson given the topic, source text, speaker identity, and audience. Runs before slide structure is decided.",
    pipelineStep: "02a",
    source: { kind: "file", relPath: "assets/prompts/02a-narration-generate.md" },
  },
  {
    id: "02b-slide-structure",
    label: "02b — Slide structure extractor",
    purpose:
      "Turns the narration script into a slide-by-slide structure. Chooses template layouts, decides bullet counts, marks which slides need images. Consumes {{LAYOUT_INSTRUCTION}} and {{LAYOUT_SCHEMA_LINE}} injected from the template manifest.",
    pipelineStep: "02b",
    source: { kind: "file", relPath: "assets/prompts/02b-slide-structure.md" },
    variables: ["LAYOUT_INSTRUCTION", "LAYOUT_SCHEMA_LINE"],
  },
  {
    id: "02d-critic-refine.critic",
    label: "02d — Critic pass",
    purpose:
      "Critic pass. Inspects generated slides for coverage gaps, off-tone narration, or missed examiner-relevant points against the source text. Outputs a critique.",
    pipelineStep: "02d",
    source: { kind: "file", relPath: "assets/prompts/02d-critic-refine.critic.md" },
  },
  {
    id: "02d-critic-refine.refine",
    label: "02d — Refine pass",
    purpose:
      "Refine pass. Given the critic's feedback, rewrites the slides to address the issues.",
    pipelineStep: "02d",
    source: { kind: "file", relPath: "assets/prompts/02d-critic-refine.refine.md" },
  },
  {
    id: "03a-image-queries",
    label: "03a — Image query generator",
    purpose:
      "Generates Unsplash image search queries per slide. Strips proper nouns so queries target photographable concepts rather than names the photo API cannot match.",
    pipelineStep: "03a",
    source: { kind: "file", relPath: "assets/prompts/03a-image-queries.md" },
  },
  {
    id: "04b-slide-content-design",
    label: "04b — Slide content design",
    purpose:
      "Designs the final on-slide bullet text (distinct from the spoken narration). Runs after slide structure is locked, before PPTX generation.",
    pipelineStep: "04b",
    source: { kind: "file", relPath: "assets/prompts/04b-slide-content-design.md" },
  },
];

export function validateRegistry(): void {
  const ids = new Set<string>();
  for (const entry of PROMPT_REGISTRY) {
    if (!entry.purpose || entry.purpose.trim().length === 0) {
      throw new Error(`PROMPT_REGISTRY: entry '${entry.id}' has empty purpose`);
    }
    if (ids.has(entry.id)) {
      throw new Error(`PROMPT_REGISTRY: duplicate id '${entry.id}'`);
    }
    ids.add(entry.id);
    if (entry.source.kind === "file") {
      const abs = resolve(getAppRoot(), entry.source.relPath);
      if (!existsSync(abs)) {
        throw new Error(
          `PROMPT_REGISTRY: entry '${entry.id}' references missing file: ${abs}`,
        );
      }
    }
  }
}

export function getEntry(id: string): PromptMeta | undefined {
  return PROMPT_REGISTRY.find((e) => e.id === id);
}

/** Read a dotted JSON path, e.g. "script.systemPrompt". */
export function getAtPath(obj: unknown, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

/** Immutably set a dotted JSON path, returning a new object. */
export function setAtPath<T extends object>(
  obj: T,
  dotPath: string,
  value: unknown,
): T {
  const parts = dotPath.split(".");
  const clone: any = Array.isArray(obj) ? [...(obj as any)] : { ...obj };
  let cur: any = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const child = cur[k];
    cur[k] = child && typeof child === "object"
      ? (Array.isArray(child) ? [...child] : { ...child })
      : {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
  return clone;
}
