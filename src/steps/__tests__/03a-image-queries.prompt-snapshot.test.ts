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
  failStep: vi.fn(),
}));

import { generateImageQueries } from "../03a-image-queries.js";
import { callLLM } from "../../lib/llm.js";
import type {
  Presentation,
  Slide,
  TemplateManifest,
} from "../../types/index.js";

const mockCallLLM = vi.mocked(callLLM);

function makeSlide(overrides: Partial<Slide> = {}): Slide {
  return {
    slideTitle: "T",
    narration: "n",
    bulletPoints: ["a"],
    layoutStyle: "standard",
    imageQuery: "orig",
    durationSeconds: 30,
    ...overrides,
  };
}

function makePresentation(slides: Slide[]): Presentation {
  return {
    title: "T",
    slides,
    totalDurationSeconds: slides.reduce((a, s) => a + s.durationSeconds, 0),
  };
}

function makeManifest(): TemplateManifest {
  return {
    layouts: [
      {
        id: "with-image",
        name: "Image",
        description: "d",
        placeholders: [
          { name: "title", type: "title" },
          { name: "image", type: "image" },
        ],
        bestFor: ["content"],
        hasImage: true,
      },
    ],
  };
}

describe("03a-image-queries prompt snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("locks the system prompt", async () => {
    mockCallLLM.mockResolvedValueOnce(
      JSON.stringify([{ slideIndex: 0, query: "misty forest path" }]),
    );

    await generateImageQueries({
      presentation: makePresentation([
        makeSlide({ templateLayoutId: "with-image" }),
      ]),
      templateManifest: makeManifest(),
    });

    const systemPrompt = mockCallLLM.mock.calls[0][1] as string;
    expect(systemPrompt).toMatchInlineSnapshot(`
      "You are a visual search query specialist. For each slide, produce a concrete, concise stock-image search query (2-5 words) that favours subject + mood/composition modifiers.

      Rules:
      - strip proper nouns (poem titles, author names, character names, place names tied to specific works)
      - prefer concrete visual nouns (e.g. "crumbling stone statue", "misty forest path", "stormy ocean horizon")
      - 2 to 5 words per query
      - no punctuation except spaces and hyphens
      - output ONLY valid JSON: an array of objects { "slideIndex": number, "query": string }
      - no markdown fences, no commentary"
    `);
  });
});
