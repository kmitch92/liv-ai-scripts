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
import { loadPrompt } from "../lib/prompts.js";

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

  const SYSTEM_PROMPT = await loadPrompt("03a-image-queries");

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
