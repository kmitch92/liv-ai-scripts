import Anthropic from "@anthropic-ai/sdk";
import { PresentationSchema } from "../schemas/slide.schema.js";
import type { Presentation } from "../types/index.js";
import * as logger from "../lib/logger.js";
import { callLLM, detectProvider } from "../lib/llm.js";
import type { ChatMessage } from "../lib/llm.js";

const MAX_RETRIES = 2;

export interface ScriptGenerateOptions {
  topic: string;
  contextText: string;
  speakerIdentity: string;
  targetAudience: string;
  systemPrompt: string;
  durationMinutes: number;
  client?: Anthropic;
}

function buildSystemPrompt(
  speakerIdentity: string,
  targetAudience: string,
  systemPrompt: string,
  durationMinutes: number,
): string {
  return `You are ${speakerIdentity}. Your audience is ${targetAudience}. ${systemPrompt}

Your task is to generate a structured presentation script for a ${durationMinutes}-minute presentation tailored to this audience.

Rules:
- Output ONLY valid JSON matching the schema below. No markdown fencing, no commentary.
- Target a total duration of approximately ${durationMinutes * 60} seconds (${durationMinutes} minutes). The sum of all slide durationSeconds must equal totalDurationSeconds.
- Each slide's durationSeconds must be between 10 and 180 seconds.
- Include 3-25 slides total.
- The FIRST slide must be an introduction that states the topic, learning objectives, and what students will cover.
- The LAST slide must be a recap/summary that revisits key points and poses a thought-provoking question.
- Narration must be conversational and engaging. Use "you", "we", "let's" language. Avoid dry textbook tone.
- Bullet points are displayed visually on slides: keep them concise (max ~10 words each). 1-6 bullet points per slide.
- imageQuery should be a specific, descriptive search query suitable for finding a relevant stock photo (e.g. "close-up of plant cell under microscope" not "biology").
- Structure the lesson logically: introduce concepts, build understanding, give examples, then summarise.
- The reference material provided MUST be directly incorporated into the narration. If it includes a text, poem, speech, or source document, quote from it extensively, analyse it line by line where appropriate, and discuss it in detail. Do not merely summarise — engage with the actual content.
- Vary the layoutStyle across slides to create visual interest. Use "quote-focus" when highlighting a key quotation from the source text. Use "full-image" for atmospheric or mood-setting slides. Use "two-column" when comparing ideas or listing parallel points. Use "key-point" for crucial exam tips or takeaways. Use "standard" for general content. Do NOT use the same layout for more than 3 consecutive slides.
- Include keyQuote on slides where a direct quotation from the source material or a memorable phrase would strengthen the visual impact. This should be a short, punchy quote (max 15 words).
- Include subheading where it adds context — e.g. "Context & Historical Background", "Lines 1-4: The Traveller's Tale", "Exam Technique: PEE Paragraphs".

JSON Schema:
{
  "title": "string - presentation title",
  "slides": [
    {
      "slideTitle": "string - concise slide heading",
      "narration": "string - teacher's spoken script for this slide",
      "bulletPoints": ["string - concise point for slide display"],
      "keyQuote": "string (optional) - a key quote to display prominently",
      "subheading": "string (optional) - contextual subheading",
      "layoutStyle": "standard|quote-focus|full-image|two-column|key-point",
      "imageQuery": "string - specific stock photo search query",
      "durationSeconds": "number - how long this slide is shown (10-180)"
    }
  ],
  "totalDurationSeconds": "number - sum of all slide durations"
}`;
}

function buildUserMessage(
  topic: string,
  contextText: string,
  durationMinutes: number,
): string {
  return `Create a ${durationMinutes}-minute presentation on the following topic.

Topic: ${topic}
${contextText ? `\nThe following source material MUST be directly referenced, quoted, and analysed in the presentation:\n---\n${contextText}\n---\n` : ""}
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
  // Strip markdown code fences if present
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    return fenced[1].trim();
  }
  // Try to find raw JSON object
  const braceStart = raw.indexOf("{");
  const braceEnd = raw.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart) {
    return raw.slice(braceStart, braceEnd + 1);
  }
  return raw.trim();
}

export async function generateScript(
  options: ScriptGenerateOptions,
): Promise<Presentation> {
  const {
    topic,
    contextText,
    speakerIdentity,
    targetAudience,
    systemPrompt,
    durationMinutes,
    client: injectedClient,
  } = options;

  const provider = detectProvider();
  const resolvedSystemPrompt = buildSystemPrompt(speakerIdentity, targetAudience, systemPrompt, durationMinutes);

  const targetSeconds = durationMinutes * 60;
  const minSeconds = Math.round(targetSeconds * 0.8);
  const maxSeconds = Math.round(targetSeconds * 1.2);

  logger.startStep(
    `Generating presentation script with Claude (${provider})...`,
  );

  const messages: ChatMessage[] = [
    { role: "user", content: buildUserMessage(topic, contextText, durationMinutes) },
  ];

  let lastRawResponse = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    lastRawResponse = await callLLM(messages, resolvedSystemPrompt, injectedClient);
    const jsonStr = extractJson(lastRawResponse);

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      if (attempt < MAX_RETRIES) {
        const errMsg = `Invalid JSON: could not parse response. Ensure output is valid JSON with no trailing commas or comments.`;
        logger.warn(`Attempt ${attempt + 1}: JSON parse failed, retrying...`);
        messages.push(
          { role: "assistant", content: lastRawResponse },
          { role: "user", content: buildCorrectionMessage(lastRawResponse, errMsg) },
        );
        continue;
      }
      throw new Error(
        `Failed to parse Claude response as JSON after ${MAX_RETRIES + 1} attempts`,
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
          { role: "user", content: buildCorrectionMessage(lastRawResponse, errMsg) },
        );
        continue;
      }
      throw new Error(
        `Schema validation failed after ${MAX_RETRIES + 1} attempts: ${parseResult.error.message}`,
      );
    }

    const presentation = parseResult.data;

    // Validate duration range
    if (
      presentation.totalDurationSeconds < minSeconds ||
      presentation.totalDurationSeconds > maxSeconds
    ) {
      if (attempt < MAX_RETRIES) {
        const errMsg = `Total duration is ${presentation.totalDurationSeconds}s but must be between ${minSeconds}s and ${maxSeconds}s (${minSeconds / 60}-${maxSeconds / 60} minutes). Target ${targetSeconds}s. Adjust slide durations accordingly.`;
        logger.warn(
          `Attempt ${attempt + 1}: duration ${presentation.totalDurationSeconds}s out of range, retrying...`,
        );
        messages.push(
          { role: "assistant", content: lastRawResponse },
          { role: "user", content: buildCorrectionMessage(lastRawResponse, errMsg) },
        );
        continue;
      }
      throw new Error(
        `Duration ${presentation.totalDurationSeconds}s outside allowed range (${minSeconds}-${maxSeconds}s) after ${MAX_RETRIES + 1} attempts`,
      );
    }

    logger.succeedStep(
      `Script generated: "${presentation.title}" - ${presentation.slides.length} slides, ${presentation.totalDurationSeconds}s`,
    );
    return presentation;
  }

  // Unreachable but satisfies TypeScript
  throw new Error("Script generation exhausted all retries");
}
