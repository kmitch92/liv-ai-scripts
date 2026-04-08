import Anthropic from "@anthropic-ai/sdk";
import { NarrationScriptSchema } from "../schemas/narration.schema.js";
import type { NarrationScript } from "../types/index.js";
import * as logger from "../lib/logger.js";
import { callLLM, detectProvider } from "../lib/llm.js";
import type { ChatMessage } from "../lib/llm.js";

const MAX_RETRIES = 2;

export interface NarrationGenerateOptions {
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
  const targetSeconds = durationMinutes * 60;

  return `You are ${speakerIdentity}. Your audience is ${targetAudience}. ${systemPrompt}

Your task is to write a spoken narration script for a ${durationMinutes}-minute audio presentation. Think of this as preparing a podcast episode or audiobook chapter — your ONLY output is the words that will be spoken aloud. Do NOT include any visual directions, slide references, bullet points, layout instructions, or image descriptions.

Rules:
- Output ONLY valid JSON matching the schema below. No markdown fencing, no commentary.
- Target a total duration of approximately ${targetSeconds} seconds (${durationMinutes} minutes). The sum of all section durationSeconds must equal totalDurationSeconds.
- Each section's durationSeconds must be between 10 and 180 seconds.
- Include 3-25 sections total.
- The FIRST section must introduce the topic warmly: state what the listener will learn, why it matters, and set expectations for the journey ahead.
- The LAST section must summarise key takeaways, revisit the most important ideas, and leave the listener with a thought-provoking question or call to action.
- Write in a warm, conversational tone throughout. Address the listener directly using "you", "we", "let's". Avoid dry, textbook-style prose — this should feel like a knowledgeable mentor speaking to a friend.
- Vary sentence length and rhythm. Use rhetorical questions, pauses (indicated by ellipses or dashes), and emphasis to maintain engagement.
- The reference material provided MUST be directly incorporated into the narration. If it includes a text, poem, speech, or source document, quote from it extensively and verbatim, analyse it line by line where appropriate, and discuss its meaning, context, and significance in depth. Do not merely summarise — engage with the actual words and phrases of the source.
- Each section should have a clear sectionLabel that describes the content covered (e.g. "Introduction", "Lines 1-4: The Opening Image", "Key Themes and Connections", "Summary and Reflection").
- The narrativeArc field should capture the pedagogical flow: how the narration builds understanding from introduction through exploration to synthesis.
- Structure the narration logically: introduce the topic and context, build understanding incrementally, explore details with examples and analysis, then synthesise and summarise.
- Transitions between sections should feel natural — as if the speaker is guiding the listener through a conversation, not jumping between disconnected topics.

JSON Schema:
{
  "title": "string - presentation title",
  "narrativeArc": "string - summary of the pedagogical flow across all sections",
  "sections": [
    {
      "sectionLabel": "string - short label for this section",
      "narration": "string - the full spoken script for this section",
      "durationSeconds": "number - estimated spoken duration in seconds (10-180)"
    }
  ],
  "totalDurationSeconds": "number - sum of all section durations"
}`;
}

function buildUserMessage(
  topic: string,
  contextText: string,
  durationMinutes: number,
): string {
  return `Write a ${durationMinutes}-minute spoken narration script on the following topic.

Topic: ${topic}
${contextText ? `\nThe following source material MUST be directly referenced, quoted, and analysed in the narration:\n---\n${contextText}\n---\n` : ""}
Generate the JSON narration script now.`;
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

export async function generateNarration(
  options: NarrationGenerateOptions,
): Promise<NarrationScript> {
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
  const resolvedSystemPrompt = buildSystemPrompt(
    speakerIdentity,
    targetAudience,
    systemPrompt,
    durationMinutes,
  );

  const targetSeconds = durationMinutes * 60;
  const minSeconds = Math.round(targetSeconds * 0.8);
  const maxSeconds = Math.round(targetSeconds * 1.2);

  logger.startStep(
    `Generating narration script with Claude (${provider})...`,
  );

  const messages: ChatMessage[] = [
    {
      role: "user",
      content: buildUserMessage(topic, contextText, durationMinutes),
    },
  ];

  let lastRawResponse = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    lastRawResponse = await callLLM(
      messages,
      resolvedSystemPrompt,
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
        `Failed to parse Claude response as JSON after ${MAX_RETRIES + 1} attempts`,
      );
    }

    // Validate with Zod
    const parseResult = NarrationScriptSchema.safeParse(parsed);
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

    const narrationScript = parseResult.data;

    // Validate duration range
    if (
      narrationScript.totalDurationSeconds < minSeconds ||
      narrationScript.totalDurationSeconds > maxSeconds
    ) {
      if (attempt < MAX_RETRIES) {
        const errMsg = `Total duration is ${narrationScript.totalDurationSeconds}s but must be between ${minSeconds}s and ${maxSeconds}s (${minSeconds / 60}-${maxSeconds / 60} minutes). Target ${targetSeconds}s. Adjust section durations accordingly.`;
        logger.warn(
          `Attempt ${attempt + 1}: duration ${narrationScript.totalDurationSeconds}s out of range, retrying...`,
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
        `Duration ${narrationScript.totalDurationSeconds}s outside allowed range (${minSeconds}-${maxSeconds}s) after ${MAX_RETRIES + 1} attempts`,
      );
    }

    logger.succeedStep(
      `Narration generated: "${narrationScript.title}" - ${narrationScript.sections.length} sections, ${narrationScript.totalDurationSeconds}s`,
    );
    return narrationScript;
  }

  // Unreachable but satisfies TypeScript
  throw new Error("Narration generation exhausted all retries");
}
