import Anthropic from "@anthropic-ai/sdk";
import { CritiqueSchema } from "../schemas/critique.schema.js";
import { PresentationSchema } from "../schemas/slide.schema.js";
import type { Critique, NarrationScript, Presentation } from "../types/index.js";
import * as logger from "../lib/logger.js";
import { callLLM } from "../lib/llm.js";
import type { ChatMessage } from "../lib/llm.js";

const MAX_REFINE_ITERATIONS = 2;
const PASSING_SCORE = 7;
const MAX_RETRIES = 2;

export interface CriticRefineOptions {
  presentation: Presentation;
  narrationScript: NarrationScript;
  contextText: string;
  client?: Anthropic;
}

function buildCriticSystemPrompt(): string {
  return `You are a presentation quality reviewer. Your task is to evaluate a slide presentation against its narration script and source material.

Evaluate across these 5 dimensions (each scored 0-10):
1. contentDensity — How substantial is the content on each slide? Are slides too sparse or appropriately rich?
2. narrationAlignment — How well do the slides reflect and support the narration script? Do slide titles, bullet points, and quotes match what is being spoken?
3. visualVariety — How varied are the layout styles across slides? Is there a good mix of standard, quote-focus, two-column, key-point, and full-image layouts?
4. informationHierarchy — How clear is the information hierarchy within each slide? Are titles, subheadings, bullet points, and quotes used effectively?
5. quoteCoverage — How well are source quotes from the reference material incorporated into the slides?

Also compute an overallScore (0-10) as a weighted assessment of all dimensions.

For each slide that has issues, provide a specific suggestion for improvement.

Output ONLY valid JSON matching this schema. No markdown fencing, no commentary.

{
  "scores": {
    "contentDensity": number,
    "narrationAlignment": number,
    "visualVariety": number,
    "informationHierarchy": number,
    "quoteCoverage": number
  },
  "overallScore": number,
  "suggestions": [
    { "slideIndex": number, "issue": "string", "suggestion": "string" }
  ],
  "summary": "string - brief overall assessment"
}`;
}

function buildCriticUserMessage(
  presentation: Presentation,
  narrationScript: NarrationScript,
  contextText: string,
): string {
  return `Evaluate the following presentation against its narration script and source material.

PRESENTATION JSON:
${JSON.stringify(presentation, null, 2)}

NARRATION SCRIPT JSON:
${JSON.stringify(narrationScript, null, 2)}

${contextText ? `SOURCE MATERIAL:\n---\n${contextText}\n---\n` : ""}
Return your structured critique JSON now.`;
}

function buildRefineSystemPrompt(): string {
  return `You are a presentation improver. Given a presentation and a quality critique, improve the presentation to address the identified weaknesses.

CRITICAL RULES:
- You MUST preserve the "narration" field of every slide EXACTLY as-is. Do NOT modify narration text in any way.
- You MUST preserve the same number of slides and the same totalDurationSeconds.
- You MUST preserve each slide's durationSeconds unchanged.
- Focus improvements on: slideTitle, bulletPoints, keyQuote, subheading, layoutStyle, imageQuery, contentBlocks, imageConcept, and templateLayoutId.
- Address the specific suggestions from the critique.
- Improve content density, visual variety, information hierarchy, and quote coverage where noted.

Output ONLY valid JSON matching the Presentation schema. No markdown fencing, no commentary.`;
}

function buildRefineUserMessage(
  presentation: Presentation,
  critique: Critique,
): string {
  return `Improve this presentation based on the critique below.

CURRENT PRESENTATION JSON:
${JSON.stringify(presentation, null, 2)}

CRITIQUE:
${JSON.stringify(critique, null, 2)}

Return the improved Presentation JSON now. Remember: do NOT modify any narration fields.`;
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

async function callLLMWithRetry<T>(
  messages: ChatMessage[],
  systemPrompt: string,
  schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: (string | number)[]; message: string }[]; message: string } } },
  stepLabel: string,
  client?: Anthropic,
): Promise<T> {
  let lastRawResponse = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    lastRawResponse = await callLLM(messages, systemPrompt, client);
    const jsonStr = extractJson(lastRawResponse);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      if (attempt < MAX_RETRIES) {
        const errMsg = `Invalid JSON: could not parse response. Ensure output is valid JSON with no trailing commas or comments.`;
        logger.warn(`${stepLabel} attempt ${attempt + 1}: JSON parse failed, retrying...`);
        messages.push(
          { role: "assistant", content: lastRawResponse },
          { role: "user", content: buildCorrectionMessage(lastRawResponse, errMsg) },
        );
        continue;
      }
      throw new Error(`${stepLabel}: Failed to parse JSON after ${MAX_RETRIES + 1} attempts`);
    }

    const parseResult = schema.safeParse(parsed);
    if (!parseResult.success) {
      if (attempt < MAX_RETRIES) {
        const zodErrors = parseResult.error.issues
          .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
          .join("\n");
        const errMsg = `Schema validation failed:\n${zodErrors}`;
        logger.warn(`${stepLabel} attempt ${attempt + 1}: schema validation failed, retrying...`);
        messages.push(
          { role: "assistant", content: lastRawResponse },
          { role: "user", content: buildCorrectionMessage(lastRawResponse, errMsg) },
        );
        continue;
      }
      throw new Error(`${stepLabel}: Schema validation failed after ${MAX_RETRIES + 1} attempts: ${parseResult.error.message}`);
    }

    return parseResult.data;
  }

  throw new Error(`${stepLabel}: exhausted all retries`);
}

async function getCritique(
  presentation: Presentation,
  narrationScript: NarrationScript,
  contextText: string,
  client?: Anthropic,
): Promise<Critique> {
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: buildCriticUserMessage(presentation, narrationScript, contextText),
    },
  ];

  return callLLMWithRetry(
    messages,
    buildCriticSystemPrompt(),
    CritiqueSchema,
    "Critic",
    client,
  );
}

async function refinePresentation(
  presentation: Presentation,
  critique: Critique,
  client?: Anthropic,
): Promise<Presentation> {
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: buildRefineUserMessage(presentation, critique),
    },
  ];

  return callLLMWithRetry(
    messages,
    buildRefineSystemPrompt(),
    PresentationSchema,
    "Refine",
    client,
  );
}

function formatScores(scores: Critique["scores"]): string {
  return [
    `contentDensity=${scores.contentDensity}`,
    `narrationAlignment=${scores.narrationAlignment}`,
    `visualVariety=${scores.visualVariety}`,
    `informationHierarchy=${scores.informationHierarchy}`,
    `quoteCoverage=${scores.quoteCoverage}`,
  ].join(", ");
}

export async function criticRefine(
  options: CriticRefineOptions,
): Promise<Presentation> {
  const { presentation, narrationScript, contextText, client } = options;

  let currentPresentation = presentation;
  let bestPresentation = presentation;
  let bestScore = 0;

  for (let iteration = 0; iteration <= MAX_REFINE_ITERATIONS; iteration++) {
    const isInitial = iteration === 0;
    const label = isInitial ? "Initial critique" : `Refinement ${iteration} critique`;

    logger.startStep(`${label}: evaluating presentation quality...`);

    const critique = await getCritique(
      currentPresentation,
      narrationScript,
      contextText,
      client,
    );

    logger.info(
      `${label} scores: ${formatScores(critique.scores)}, overall=${critique.overallScore}`,
    );
    logger.info(`${label} summary: ${critique.summary}`);

    if (critique.overallScore > bestScore) {
      bestScore = critique.overallScore;
      bestPresentation = currentPresentation;
    }

    if (critique.overallScore >= PASSING_SCORE) {
      logger.succeedStep(
        `Presentation passed quality check (score=${critique.overallScore}/10)`,
      );
      return currentPresentation;
    }

    if (iteration === MAX_REFINE_ITERATIONS) {
      logger.warn(
        `Max refinement iterations reached. Returning best version (score=${bestScore}/10)`,
      );
      break;
    }

    logger.startStep(
      `Score ${critique.overallScore}/10 < ${PASSING_SCORE} threshold. Refining (iteration ${iteration + 1}/${MAX_REFINE_ITERATIONS})...`,
    );

    currentPresentation = await refinePresentation(
      currentPresentation,
      critique,
      client,
    );

    logger.succeedStep(`Refinement ${iteration + 1} complete`);
  }

  return bestPresentation;
}
