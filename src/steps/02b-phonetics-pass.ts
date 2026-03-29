import { PresentationSchema } from "../schemas/slide.schema.js";
import type { Presentation } from "../types/index.js";
import { callLLM, type ChatMessage } from "../lib/llm.js";
import * as logger from "../lib/logger.js";

const PHONETICS_SYSTEM_PROMPT = `You are a phonetics specialist preparing text for a simple text-to-speech engine. Your job is to replace difficult, unusual, archaic, or non-English words in narration text with phonetic English spellings that a basic TTS model will pronounce correctly.

Rules:
- ONLY modify the "narration" fields in each slide object
- DO NOT modify slideTitle, bulletPoints, imageQuery, durationSeconds, title, or totalDurationSeconds
- Replace words that TTS commonly mispronounces: proper nouns, foreign words, archaic English, technical terms, unusual place names
- Use simple phonetic English spelling that reads naturally: "Ozymandias" → "Ozzy-man-dee-us", "Bysshe" → "Bish", "visage" → "vizahj", "Ramesses" → "Ram-eh-seez", "trunkless" → "trunk-less"
- Keep common English words unchanged — only replace words likely to trip up TTS
- Maintain the same sentence structure and meaning
- Output ONLY valid JSON matching the exact same schema as the input. No markdown fencing, no commentary.`;

export async function phoneticsPass(
  presentation: Presentation,
): Promise<Presentation> {
  logger.startStep("Running phonetics pass for TTS...");

  const messages: ChatMessage[] = [
    {
      role: "user",
      content: `Process the following presentation JSON. Replace difficult words in narration fields with phonetic spellings for TTS. Return the modified JSON only.\n\n${JSON.stringify(presentation, null, 2)}`,
    },
  ];

  // Try up to 2 attempts
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callLLM(messages, PHONETICS_SYSTEM_PROMPT);

    // Extract JSON
    const jsonStr = extractJson(raw);

    try {
      const parsed: unknown = JSON.parse(jsonStr);
      const result = PresentationSchema.parse(parsed);
      logger.succeedStep("Phonetics pass complete");
      return result;
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
