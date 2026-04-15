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

import { criticRefine } from "../02d-critic-refine.js";
import { callLLM } from "../../lib/llm.js";
import type {
  NarrationScript,
  Presentation,
} from "../../types/index.js";

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

function makeNarration(): NarrationScript {
  return {
    title: "T",
    narrativeArc: "arc",
    sections: [
      { sectionLabel: "Intro", narration: "n1", durationSeconds: 60 },
      { sectionLabel: "Body", narration: "n2", durationSeconds: 60 },
      { sectionLabel: "Outro", narration: "n3", durationSeconds: 60 },
    ],
    totalDurationSeconds: 180,
  };
}

describe("02d-critic-refine prompt snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("locks the CRITIC system prompt", async () => {
    // Return a passing critique so we don't proceed to refine.
    mockCallLLM.mockResolvedValueOnce(
      JSON.stringify({
        scores: {
          contentDensity: 8,
          narrationAlignment: 8,
          visualVariety: 8,
          informationHierarchy: 8,
          quoteCoverage: 8,
        },
        overallScore: 8,
        suggestions: [],
        summary: "good",
      }),
    );

    await criticRefine({
      presentation: makePresentation(),
      narrationScript: makeNarration(),
      contextText: "SOURCE",
    });

    const criticSystemPrompt = mockCallLLM.mock.calls[0][1] as string;
    expect(criticSystemPrompt).toMatchInlineSnapshot(`
      "You are a presentation quality reviewer. Your task is to evaluate a slide presentation against its narration script and source material.

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
      }"
    `);
  });

  it("locks the REFINE system prompt", async () => {
    // First call: failing critique -> triggers refine.
    mockCallLLM.mockResolvedValueOnce(
      JSON.stringify({
        scores: {
          contentDensity: 3,
          narrationAlignment: 3,
          visualVariety: 3,
          informationHierarchy: 3,
          quoteCoverage: 3,
        },
        overallScore: 3,
        suggestions: [
          { slideIndex: 0, issue: "thin", suggestion: "add detail" },
        ],
        summary: "needs work",
      }),
    );
    // Second call: refine returns a valid presentation.
    mockCallLLM.mockResolvedValueOnce(
      JSON.stringify(makePresentation()),
    );
    // Third call: re-critique passes (short-circuit).
    mockCallLLM.mockResolvedValueOnce(
      JSON.stringify({
        scores: {
          contentDensity: 8,
          narrationAlignment: 8,
          visualVariety: 8,
          informationHierarchy: 8,
          quoteCoverage: 8,
        },
        overallScore: 8,
        suggestions: [],
        summary: "good",
      }),
    );

    await criticRefine({
      presentation: makePresentation(),
      narrationScript: makeNarration(),
      contextText: "SOURCE",
    });

    // Call 0 = critic, Call 1 = refine, Call 2 = critic again.
    const refineSystemPrompt = mockCallLLM.mock.calls[1][1] as string;
    expect(refineSystemPrompt).toMatchInlineSnapshot(`
      "You are a presentation improver. Given a presentation and a quality critique, improve the presentation to address the identified weaknesses.

      CRITICAL RULES:
      - You MUST preserve the "narration" field of every slide EXACTLY as-is. Do NOT modify narration text in any way.
      - You MUST preserve the same number of slides and the same totalDurationSeconds.
      - You MUST preserve each slide's durationSeconds unchanged.
      - Focus improvements on: slideTitle, bulletPoints, keyQuote, subheading, layoutStyle, imageQuery, contentBlocks, imageConcept, and templateLayoutId.
      - Address the specific suggestions from the critique.
      - Improve content density, visual variety, information hierarchy, and quote coverage where noted.

      Output ONLY valid JSON matching the Presentation schema. No markdown fencing, no commentary."
    `);
  });
});
