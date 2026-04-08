import { PresentationSchema } from "../schemas/slide.schema.js";
import type { Presentation } from "../types/index.js";
import { callLLM, type ChatMessage } from "../lib/llm.js";
import * as logger from "../lib/logger.js";

type PhoneticsOverride = { from: string; to: string };

const PHONETICS_BASE_PROMPT = `You are a phonetics specialist preparing text for a simple text-to-speech engine. Your job is to replace difficult, unusual, archaic, or non-English words in narration text with phonetic English spellings that a basic TTS model will pronounce correctly.

Rules:
- ONLY modify the "narration" fields in each slide object
- DO NOT modify slideTitle, bulletPoints, imageQuery, durationSeconds, title, or totalDurationSeconds
- Replace words that TTS commonly mispronounces: proper nouns, foreign words, archaic English, technical terms, unusual place names
- Use simple phonetic English spelling that reads naturally — the respelling should sound correct when read aloud by a TTS engine
- IMPORTANT: Natural utterance duration matters as much as correct pronunciation. Phonetic respellings must take roughly the same time to say as the original word. Avoid adding unnecessary syllables or hyphens that stretch the word out. For example, "Ozzy-man-dee-us" is 5 syllables for a 5-syllable word — good. But spelling out every vowel sound explicitly (e.g. "Oh-zee-man-dee-ah-ss") adds length and sounds unnatural. Prefer compact respellings: use the fewest syllables that still achieve correct pronunciation. If the original word is short and punchy, the respelling must be too.
- Keep common English words unchanged — only replace words likely to trip up TTS
- Maintain the same sentence structure and meaning
- Output ONLY valid JSON matching the exact same schema as the input. No markdown fencing, no commentary.`;

function buildSystemPrompt(overrides: PhoneticsOverride[]): string {
  if (overrides.length === 0) return PHONETICS_BASE_PROMPT;

  const overrideLines = overrides
    .map((o) => `- "${o.from}" → "${o.to}"`)
    .join("\n");

  return `${PHONETICS_BASE_PROMPT}

The following words MUST be replaced with their specified phonetic spellings wherever they appear in narration:
${overrideLines}`;
}

function applyOverrides(
  presentation: Presentation,
  overrides: PhoneticsOverride[],
): Presentation {
  if (overrides.length === 0) return presentation;

  return {
    ...presentation,
    slides: presentation.slides.map((slide) => {
      let narration = slide.narration;
      for (const { from, to } of overrides) {
        const pattern = new RegExp(
          `\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          "gi",
        );
        narration = narration.replace(pattern, to);
      }
      return { ...slide, narration };
    }),
  };
}

export async function phoneticsPass(
  presentation: Presentation,
  overrides: PhoneticsOverride[],
): Promise<Presentation> {
  logger.startStep("Running phonetics pass for TTS...");

  if (overrides.length > 0) {
    logger.info(`Applying ${overrides.length} phonetic overrides`);
  }

  // Apply overrides BEFORE the LLM pass
  const preOverridden = applyOverrides(presentation, overrides);

  const messages: ChatMessage[] = [
    {
      role: "user",
      content: `Process the following presentation JSON. Replace difficult words in narration fields with phonetic spellings for TTS. Return the modified JSON only.\n\n${JSON.stringify(preOverridden, null, 2)}`,
    },
  ];

  // Try up to 2 attempts
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callLLM(messages, buildSystemPrompt(overrides));

    // Extract JSON
    const jsonStr = extractJson(raw);

    try {
      const parsed: unknown = JSON.parse(jsonStr);
      const result = PresentationSchema.parse(parsed);
      // Apply overrides AFTER the LLM pass to catch any reverted words
      const postOverridden = applyOverrides(result, overrides);
      logger.succeedStep("Phonetics pass complete");
      return postOverridden;
    } catch {
      if (attempt === 0) {
        logger.warn("Phonetics pass: parse failed, retrying...");
        messages.push(
          { role: "assistant", content: raw },
          {
            role: "user",
            content:
              "That was not valid JSON. Return ONLY the modified JSON, no commentary.",
          },
        );
        continue;
      }
      // On second failure, return original unmodified
      logger.warn(
        "Phonetics pass failed after retries, using original narration",
      );
      return presentation;
    }
  }

  // Fallback: return original
  return presentation;
}

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const braceStart = raw.indexOf("{");
  const braceEnd = raw.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart) {
    return raw.slice(braceStart, braceEnd + 1);
  }
  return raw.trim();
}
