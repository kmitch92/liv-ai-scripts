import Anthropic from "@anthropic-ai/sdk";
import { PresentationSchema } from "../schemas/slide.schema.js";
import type { Presentation } from "../types/index.js";
import * as logger from "../lib/logger.js";
import { callLLM, detectProvider } from "../lib/llm.js";
import type { ChatMessage } from "../lib/llm.js";
import { loadPrompt } from "../lib/prompts.js";

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

async function buildSystemPrompt(
  speakerIdentity: string,
  targetAudience: string,
  systemPrompt: string,
  durationMinutes: number,
): Promise<string> {
  return loadPrompt("02-script-generate", {
    SPEAKER_IDENTITY: speakerIdentity,
    TARGET_AUDIENCE: targetAudience,
    SYSTEM_PROMPT: systemPrompt,
    DURATION_MINUTES: String(durationMinutes),
    TARGET_SECONDS: String(durationMinutes * 60),
  });
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
  const resolvedSystemPrompt = await buildSystemPrompt(speakerIdentity, targetAudience, systemPrompt, durationMinutes);

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
