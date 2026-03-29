import Anthropic from "@anthropic-ai/sdk";
import { PresentationSchema } from "../schemas/slide.schema.js";
import type { Presentation } from "../types/index.js";
import * as logger from "../lib/logger.js";
import { callLLM, detectProvider } from "../lib/llm.js";
import type { ChatMessage } from "../lib/llm.js";

const MAX_RETRIES = 1;

const SYSTEM_PROMPT = `You are a presentation designer optimizing slide content for visual impact.

You receive a presentation with narration scripts already written. Your job is to redesign the visual content that appears ON the slides — not the spoken narration.

CRITICAL RULES:
- The "narration" field for every slide must be returned EXACTLY as provided. Do not change a single character.
- The "durationSeconds" field for every slide must be returned EXACTLY as provided. Do not change the value.
- The "totalDurationSeconds" field must be returned EXACTLY as provided.
- The "imageQuery" field must be returned EXACTLY as provided.
- The number of slides must remain the same.

YOUR DESIGN RESPONSIBILITIES:

1. bulletPoints: Rewrite for visual impact. Each point should be punchy, concise, and visually scannable.
   - 3-8 words per bullet point (absolute maximum 10 words)
   - Maximum 5 bullet points per slide
   - Focus on key takeaways, exam-relevant points, memorable phrases
   - Use parallel grammatical structure within a slide

2. keyQuote: Select a short, memorable, powerful quote.
   - Pull directly from the source material or distil a key phrase from the narration
   - Maximum 15 words
   - Should be the most impactful line for that slide's topic
   - Include on most slides — omit only if no suitable quote exists

3. subheading: Add contextual labels that help students orient themselves.
   - Examples: "Lines 1-4", "Exam Technique", "Historical Context", "Key Terminology", "Comparison"
   - Keep under 6 words
   - Should clarify what section or angle the slide covers

4. layoutStyle: Choose for visual variety and purpose.
   - "quote-focus": When a slide centres on a specific quotation from source text
   - "full-image": For atmospheric, mood-setting, or scene-setting slides
   - "two-column": For comparisons, contrasts, or parallel ideas
   - "key-point": For crucial exam tips, definitions, or must-remember content
   - "standard": For general teaching content
   - NEVER use the same layout for more than 2 consecutive slides

5. slideTitle: May be shortened or refined for visual clarity but must remain on-topic and accurate.

Output ONLY valid JSON matching the exact schema of the input. No markdown fencing, no commentary.`;

function buildUserMessage(
  presentation: Presentation,
  contextText: string,
): string {
  return `Here is the source material used to create this presentation:
---
${contextText}
---

Here is the current presentation with narration scripts. Redesign the visual slide content (bulletPoints, keyQuote, subheading, layoutStyle, slideTitle) while preserving narration, durationSeconds, totalDurationSeconds, and imageQuery exactly as they are.

${JSON.stringify(presentation, null, 2)}

Return the redesigned presentation as JSON only.`;
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

function validatePreservedFields(
  original: Presentation,
  designed: Presentation,
): Presentation {
  let narrationWarned = false;

  // Restore totalDurationSeconds
  designed.totalDurationSeconds = original.totalDurationSeconds;

  for (let i = 0; i < original.slides.length; i++) {
    const origSlide = original.slides[i];
    const newSlide = designed.slides[i];

    if (!origSlide || !newSlide) continue;

    // Restore narration if changed
    if (newSlide.narration !== origSlide.narration) {
      if (!narrationWarned) {
        logger.warn(
          "Slide content design modified narration — restoring original values",
        );
        narrationWarned = true;
      }
      newSlide.narration = origSlide.narration;
    }

    // Restore durationSeconds if changed
    if (newSlide.durationSeconds !== origSlide.durationSeconds) {
      newSlide.durationSeconds = origSlide.durationSeconds;
    }

    // Restore imageQuery if changed
    if (newSlide.imageQuery !== origSlide.imageQuery) {
      newSlide.imageQuery = origSlide.imageQuery;
    }
  }

  return designed;
}

export async function designSlideContent(
  presentation: Presentation,
  contextText: string,
  client?: Anthropic,
): Promise<Presentation> {
  const provider = detectProvider();

  logger.startStep(
    `Designing slide visual content with Claude (${provider})...`,
  );

  const messages: ChatMessage[] = [
    { role: "user", content: buildUserMessage(presentation, contextText) },
  ];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let rawResponse: string;
    try {
      rawResponse = await callLLM(messages, SYSTEM_PROMPT, client);
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        logger.warn(
          `Attempt ${attempt + 1}: LLM call failed, retrying...`,
        );
        continue;
      }
      logger.warn("Slide content design failed after retries, returning original");
      logger.succeedStep("Using original slide content (design step skipped)");
      return presentation;
    }

    const jsonStr = extractJson(rawResponse);

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      if (attempt < MAX_RETRIES) {
        logger.warn(
          `Attempt ${attempt + 1}: JSON parse failed, retrying...`,
        );
        messages.push(
          { role: "assistant", content: rawResponse },
          {
            role: "user",
            content:
              "Your previous response was not valid JSON. Return ONLY valid JSON with no markdown fencing or commentary.",
          },
        );
        continue;
      }
      logger.warn("Slide content design produced invalid JSON, returning original");
      logger.succeedStep("Using original slide content (design step skipped)");
      return presentation;
    }

    // Validate with Zod
    const parseResult = PresentationSchema.safeParse(parsed);
    if (!parseResult.success) {
      if (attempt < MAX_RETRIES) {
        const zodErrors = parseResult.error.issues
          .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
          .join("\n");
        logger.warn(
          `Attempt ${attempt + 1}: schema validation failed, retrying...`,
        );
        messages.push(
          { role: "assistant", content: rawResponse },
          {
            role: "user",
            content: `Schema validation failed:\n${zodErrors}\n\nFix and return corrected JSON only.`,
          },
        );
        continue;
      }
      logger.warn("Slide content design failed schema validation, returning original");
      logger.succeedStep("Using original slide content (design step skipped)");
      return presentation;
    }

    const designed = parseResult.data;

    // Validate slide count matches
    if (designed.slides.length !== presentation.slides.length) {
      if (attempt < MAX_RETRIES) {
        logger.warn(
          `Attempt ${attempt + 1}: slide count mismatch (${designed.slides.length} vs ${presentation.slides.length}), retrying...`,
        );
        messages.push(
          { role: "assistant", content: rawResponse },
          {
            role: "user",
            content: `You returned ${designed.slides.length} slides but the original has ${presentation.slides.length}. Return exactly ${presentation.slides.length} slides with the same narration and durations.`,
          },
        );
        continue;
      }
      logger.warn("Slide content design returned wrong slide count, returning original");
      logger.succeedStep("Using original slide content (design step skipped)");
      return presentation;
    }

    // Restore any preserved fields that were modified
    const validated = validatePreservedFields(presentation, designed);

    logger.succeedStep(
      `Slide content designed: ${validated.slides.length} slides optimized for visual impact`,
    );
    return validated;
  }

  // Fallback: return original
  logger.warn("Slide content design exhausted retries, returning original");
  logger.succeedStep("Using original slide content (design step skipped)");
  return presentation;
}
