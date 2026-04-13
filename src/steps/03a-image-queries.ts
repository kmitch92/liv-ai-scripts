import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type {
  Presentation,
  Slide,
  TemplateManifest,
} from "../types/index.js";
import * as logger from "../lib/logger.js";
import { callLLM } from "../lib/llm.js";
import type { ChatMessage } from "../lib/llm.js";
import { getLayoutById } from "../lib/template-manifest.js";

export interface GenerateImageQueriesOptions {
  presentation: Presentation;
  templateManifest: TemplateManifest;
  client?: Anthropic;
}

const QueryItemSchema = z.object({
  slideIndex: z.number().int().nonnegative(),
  query: z.string().min(1),
});
const QueryArraySchema = z.array(QueryItemSchema);

const SYSTEM_PROMPT = `You are a visual search query specialist. For each slide, produce a concrete, concise stock-image search query (2-5 words) that favours subject + mood/composition modifiers.

Rules:
- strip proper nouns (poem titles, author names, character names, place names tied to specific works)
- prefer concrete visual nouns (e.g. "crumbling stone statue", "misty forest path", "stormy ocean horizon")
- 2 to 5 words per query
- no punctuation except spaces and hyphens
- output ONLY valid JSON: an array of objects { "slideIndex": number, "query": string }
- no markdown fences, no commentary`;

function slideHasImagePlaceholder(
  slide: Slide,
  manifest: TemplateManifest,
): boolean {
  if (!slide.templateLayoutId) return false;
  const layout = getLayoutById(manifest, slide.templateLayoutId);
  if (!layout) return false;
  return layout.placeholders.some((p) => p.type === "image");
}

function buildUserPrompt(
  slides: Slide[],
  imageIndices: number[],
): string {
  const items = imageIndices.map((idx) => {
    const s = slides[idx];
    return {
      slideIndex: idx,
      slideTitle: s.slideTitle,
      narration: s.narration,
      currentQuery: s.imageQuery,
      imageConcept: s.imageConcept ?? "",
    };
  });
  return `Generate refined image search queries for these image-bearing slides.\n\nSLIDES:\n${JSON.stringify(items, null, 2)}\n\nReturn a JSON array with one entry per slideIndex listed above.`;
}

function tryParse(
  raw: string,
): z.infer<typeof QueryArraySchema> | undefined {
  try {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const parsed: unknown = JSON.parse(cleaned);
    const result = QueryArraySchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export async function generateImageQueries(
  options: GenerateImageQueriesOptions,
): Promise<Presentation> {
  const { presentation, templateManifest, client } = options;

  const imageIndices = presentation.slides
    .map((s, i) => (slideHasImagePlaceholder(s, templateManifest) ? i : -1))
    .filter((i) => i >= 0);

  if (imageIndices.length === 0) {
    return presentation;
  }

  const userPrompt = buildUserPrompt(presentation.slides, imageIndices);
  const messages: ChatMessage[] = [{ role: "user", content: userPrompt }];

  let parsed = tryParse(await callLLM(messages, SYSTEM_PROMPT, client));

  if (!parsed) {
    const retryMessages: ChatMessage[] = [
      ...messages,
      {
        role: "user",
        content:
          "Your previous response was not valid JSON. Respond with ONLY a JSON array of { slideIndex, query } objects. No prose, no code fences.",
      },
    ];
    parsed = tryParse(await callLLM(retryMessages, SYSTEM_PROMPT, client));
  }

  if (!parsed) {
    logger.warn(
      "Image query generation failed after retry; keeping original imageQuery values",
    );
    return presentation;
  }

  const queryByIndex = new Map<number, string>();
  for (const item of parsed) {
    queryByIndex.set(item.slideIndex, item.query);
  }

  const newSlides = presentation.slides.map((slide, i) => {
    if (!imageIndices.includes(i)) return slide;
    const refined = queryByIndex.get(i);
    if (!refined) return slide;
    return { ...slide, imageQuery: refined };
  });

  return { ...presentation, slides: newSlides };
}
