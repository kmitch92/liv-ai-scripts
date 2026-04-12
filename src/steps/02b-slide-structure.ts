import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { PresentationSchema } from "../schemas/slide.schema.js";
import type {
  NarrationScript,
  Presentation,
  TemplateManifest,
} from "../types/index.js";
import * as logger from "../lib/logger.js";
import { callLLM, detectProvider } from "../lib/llm.js";
import type { ChatMessage } from "../lib/llm.js";

const MAX_RETRIES = 2;

export interface SlideStructureOptions {
  narrationScript: NarrationScript;
  contextText: string;
  templateManifest?: TemplateManifest;
  slideStructureNotes?: string;
  client?: Anthropic;
}

function buildTemplateManifestBlock(manifest: TemplateManifest): string {
  const layoutDescriptions = manifest.layouts
    .map((layout) => {
      const placeholderList = layout.placeholders
        .map(
          (p) =>
            `    - ${p.name} (${p.type}${p.maxChars ? `, max ${p.maxChars} chars` : ""})`,
        )
        .join("\n");
      return `  Layout: "${layout.id}"
    Name: ${layout.name}
    Description: ${layout.description}
    Placeholders:
${placeholderList}
    Best for: ${layout.bestFor.join(", ")}
    Has image: ${layout.hasImage}${layout.maxBullets != null ? `\n    Max bullets: ${layout.maxBullets}` : ""}`;
    })
    .join("\n\n");

  return `
AVAILABLE TEMPLATE LAYOUTS:
${layoutDescriptions}

For each slide, set "templateLayoutId" to one of the layout IDs listed above. Use these layouts in any order, any number of times, as you see fit. Do NOT set "layoutStyle" when using template layouts.`;
}

function buildSystemPrompt(manifest?: TemplateManifest): string {
  const layoutInstruction = manifest
    ? buildTemplateManifestBlock(manifest)
    : `
No template manifest provided. For each slide, set "layoutStyle" to one of: "standard", "quote-focus", "full-image", "two-column", "key-point". Vary layouts across slides for visual interest. Do NOT set "templateLayoutId".`;

  return `You are a visual design specialist. Your task is to read a completed narration script and extract a visual slide structure from it. Each narration section maps to exactly one slide. You must preserve the narration text on each slide exactly as given.

Rules:
- Output ONLY valid JSON matching the schema below. No markdown fencing, no commentary.
- Each narration section maps to exactly 1 slide. The total number of slides MUST equal the number of narration sections.
- The "narration" field on each slide MUST be the EXACT narration text from the corresponding section. Do not alter, summarise, or truncate it.
- Extract the following from each section's narration:
  - slideTitle: a concise, descriptive title for the visual slide
  - bulletPoints: 1-6 key points extracted from the narration (also derive from contentBlocks for backwards compatibility)
  - contentBlocks: typed content blocks (see types below)
  - keyQuote: if the narration contains a notable quote or key line, extract it (optional)
  - subheading: a short contextual line under the title (optional)
  - imageConcept: describe the ideal visual — mood, composition, palette, subject matter
  - imageQuery: a specific, concrete search query for finding a stock image
- durationSeconds on each slide must match the corresponding narration section's durationSeconds.

Content Block Types (for the "contentBlocks" array):
1. bullet-list: { "type": "bullet-list", "items": ["point 1", "point 2", ...] } — key points or takeaways (1-6 items)
2. quote: { "type": "quote", "text": "the quote", "attribution": "optional source" } — a notable quote from the source
3. definition: { "type": "definition", "term": "word or concept", "definition": "explanation" } — a key term or concept explained
4. callout: { "type": "callout", "text": "important note", "style": "tip|warning|exam-technique" } — highlighted information
5. paragraph: { "type": "paragraph", "text": "body text" } — a short prose passage for context

Each slide should have at least one content block. Use a mix of types where the narration supports it.

The "bulletPoints" array should be derived from the content blocks: take the text from each block (items for bullet-list, text for others) to produce 1-6 summary strings.
${layoutInstruction}

JSON Schema for output:
{
  "title": "string - presentation title",
  "narrativeArc": "string - summary of pedagogical flow (optional)",
  "slides": [
    {
      "slideTitle": "string",
      "narration": "string - EXACT narration from the corresponding section",
      "bulletPoints": ["string", ...] (1-6 items),
      "keyQuote": "string (optional)",
      "subheading": "string (optional)",
      "layoutStyle": "standard|quote-focus|full-image|two-column|key-point (only if no template manifest)",
      "templateLayoutId": "string (only if template manifest provided)",
      "imageQuery": "string - specific stock image search query",
      "imageConcept": "string - mood, composition, palette description (optional)",
      "durationSeconds": "number - must match narration section duration",
      "contentBlocks": [
        { "type": "bullet-list", "items": ["...", "..."] },
        { "type": "quote", "text": "...", "attribution": "..." },
        { "type": "definition", "term": "...", "definition": "..." },
        { "type": "callout", "text": "...", "style": "tip|warning|exam-technique" },
        { "type": "paragraph", "text": "..." }
      ]
    }
  ],
  "totalDurationSeconds": "number - sum of all slide durations"
}`;
}

function buildUserMessage(
  narrationScript: NarrationScript,
  contextText: string,
  slideStructureNotes?: string,
): string {
  const sectionsJson = JSON.stringify(narrationScript.sections, null, 2);

  const notesBlock = slideStructureNotes
    ? `Slide structure notes from the content author:\n---\n${slideStructureNotes}\n---\n\n`
    : "";

  return `${notesBlock}Extract a visual slide structure from the following narration script. There are ${narrationScript.sections.length} sections — produce exactly ${narrationScript.sections.length} slides.

Presentation title: ${narrationScript.title}
Narrative arc: ${narrationScript.narrativeArc}
Total duration: ${narrationScript.totalDurationSeconds}s

Narration sections:
${sectionsJson}

${contextText ? `Original source material for reference:\n---\n${contextText}\n---\n` : ""}
Generate the JSON presentation now.`;
}

function buildCorrectionMessage(
  previousResponse: string,
  errorDetail: string,
): string {
  return `Your previous response had issues. Here is the error:

${errorDetail}

Here was your previous response:
${previousResponse}

Please fix the issues and return corrected JSON only. No markdown fencing, no commentary.`;
}

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    return fenced[1].trim();
  }
  const braceStart = raw.indexOf("{");
  const braceEnd = raw.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart) {
    return raw.slice(braceStart, braceEnd + 1);
  }
  return raw.trim();
}

export async function extractSlideStructure(
  options: SlideStructureOptions,
): Promise<Presentation> {
  const {
    narrationScript,
    contextText,
    templateManifest,
    slideStructureNotes,
    client: injectedClient,
  } = options;

  const provider = detectProvider();
  const systemPrompt = buildSystemPrompt(templateManifest);
  const expectedSlideCount = narrationScript.sections.length;

  let notesContent: string | undefined;
  if (slideStructureNotes) {
    notesContent = await readFile(slideStructureNotes, "utf8");
  }

  logger.startStep(
    `Extracting slide structure with LLM (${provider})...`,
  );

  const messages: ChatMessage[] = [
    {
      role: "user",
      content: buildUserMessage(narrationScript, contextText, notesContent),
    },
  ];

  let lastRawResponse = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    lastRawResponse = await callLLM(
      messages,
      systemPrompt,
      injectedClient,
    );
    const jsonStr = extractJson(lastRawResponse);

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      if (attempt < MAX_RETRIES) {
        const errMsg = `Invalid JSON: could not parse response. Ensure output is valid JSON with no trailing commas or comments.`;
        logger.warn(
          `Attempt ${attempt + 1}: JSON parse failed, retrying...`,
        );
        messages.push(
          { role: "assistant", content: lastRawResponse },
          {
            role: "user",
            content: buildCorrectionMessage(lastRawResponse, errMsg),
          },
        );
        continue;
      }
      throw new Error(
        `Failed to parse LLM response as JSON after ${MAX_RETRIES + 1} attempts`,
      );
    }

    // Validate with Zod
    const parseResult = PresentationSchema.safeParse(parsed);
    if (!parseResult.success) {
      if (attempt < MAX_RETRIES) {
        const zodErrors = parseResult.error.issues
          .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
          .join("\n");
        const errMsg = `Schema validation failed:\n${zodErrors}`;
        logger.warn(
          `Attempt ${attempt + 1}: schema validation failed, retrying...`,
        );
        messages.push(
          { role: "assistant", content: lastRawResponse },
          {
            role: "user",
            content: buildCorrectionMessage(lastRawResponse, errMsg),
          },
        );
        continue;
      }
      throw new Error(
        `Schema validation failed after ${MAX_RETRIES + 1} attempts: ${parseResult.error.message}`,
      );
    }

    const presentation = parseResult.data;

    // Validate slide count matches narration section count
    if (presentation.slides.length !== expectedSlideCount) {
      if (attempt < MAX_RETRIES) {
        const errMsg = `Slide count mismatch: got ${presentation.slides.length} slides but narration has ${expectedSlideCount} sections. Each section must map to exactly 1 slide.`;
        logger.warn(
          `Attempt ${attempt + 1}: slide count ${presentation.slides.length} != section count ${expectedSlideCount}, retrying...`,
        );
        messages.push(
          { role: "assistant", content: lastRawResponse },
          {
            role: "user",
            content: buildCorrectionMessage(lastRawResponse, errMsg),
          },
        );
        continue;
      }
      throw new Error(
        `Slide count (${presentation.slides.length}) does not match narration section count (${expectedSlideCount}) after ${MAX_RETRIES + 1} attempts`,
      );
    }

    // Validate templateLayoutIds against manifest (if provided)
    if (templateManifest) {
      const validIds = new Set(templateManifest.layouts.map((l) => l.id));
      for (let i = 0; i < presentation.slides.length; i++) {
        const layoutId = presentation.slides[i].templateLayoutId;
        if (layoutId && !validIds.has(layoutId)) {
          throw new Error(
            `Unknown templateLayoutId "${layoutId}" on slide ${i + 1}. Valid ids: ${Array.from(validIds).join(", ")}`,
          );
        }
      }
    }

    // Warn if narration text was altered (non-fatal)
    for (let i = 0; i < expectedSlideCount; i++) {
      const sectionNarration = narrationScript.sections[i].narration;
      const slideNarration = presentation.slides[i].narration;
      if (slideNarration !== sectionNarration) {
        logger.warn(
          `Slide ${i + 1} narration differs from section "${narrationScript.sections[i].sectionLabel}" — narration may have been altered by LLM`,
        );
      }
    }

    logger.succeedStep(
      `Slide structure extracted: "${presentation.title}" - ${presentation.slides.length} slides, ${presentation.totalDurationSeconds}s`,
    );
    return presentation;
  }

  // Unreachable but satisfies TypeScript
  throw new Error("Slide structure extraction exhausted all retries");
}
