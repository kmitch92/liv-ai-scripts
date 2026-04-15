import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../lib/llm.js", () => ({
  callLLM: vi.fn(),
  detectProvider: vi.fn(() => "anthropic"),
}));

vi.mock("../../lib/logger.js", () => ({
  startStep: vi.fn(),
  succeedStep: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { designSlideContent } from "../04b-slide-content-design.js";
import { callLLM } from "../../lib/llm.js";
import type { Presentation } from "../../types/index.js";

const mockCallLLM = vi.mocked(callLLM);

function makePresentation(): Presentation {
  const slide = {
    slideTitle: "S1",
    narration: "n1",
    bulletPoints: ["a"],
    layoutStyle: "standard" as const,
    imageQuery: "q",
    durationSeconds: 60,
  };
  return {
    title: "T",
    slides: [slide, { ...slide, slideTitle: "S2" }, { ...slide, slideTitle: "S3" }],
    totalDurationSeconds: 180,
  };
}

describe("04b-slide-content-design prompt snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("locks the system prompt", async () => {
    mockCallLLM.mockResolvedValueOnce(JSON.stringify(makePresentation()));

    await designSlideContent(makePresentation(), "SOURCE");

    const systemPrompt = mockCallLLM.mock.calls[0][1] as string;
    expect(systemPrompt).toMatchInlineSnapshot(`
      "You are a presentation designer optimizing slide content for visual impact.

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

      Output ONLY valid JSON matching the exact schema of the input. No markdown fencing, no commentary."
    `);
  });
});
