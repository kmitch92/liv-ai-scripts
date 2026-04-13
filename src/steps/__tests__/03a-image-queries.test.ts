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
    imageQuery: "original-query",
    durationSeconds: 30,
    ...overrides,
  };
}

function makePresentation(slides: Slide[]): Presentation {
  return {
    title: "Test",
    slides,
    totalDurationSeconds: slides.reduce((a, s) => a + s.durationSeconds, 0),
  };
}

function makeManifest(): TemplateManifest {
  return {
    layouts: [
      {
        id: "title-only",
        name: "Title",
        description: "d",
        placeholders: [{ name: "title", type: "title" }],
        bestFor: ["intro"],
        hasImage: false,
      },
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

describe("generateImageQueries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("makes a single batched LLM call for the image-bearing slides (not one per slide)", async () => {
    const manifest = makeManifest();
    const presentation = makePresentation([
      makeSlide({ templateLayoutId: "title-only" }),
      makeSlide({ templateLayoutId: "with-image" }),
      makeSlide({ templateLayoutId: "title-only" }),
    ]);

    mockCallLLM.mockResolvedValueOnce(
      JSON.stringify([{ slideIndex: 1, query: "misty forest path" }]),
    );

    await generateImageQueries({ presentation, templateManifest: manifest });

    expect(mockCallLLM).toHaveBeenCalledTimes(1);
  });

  it("populates imageQuery for image-bearing slides only; non-image slides are untouched", async () => {
    const manifest = makeManifest();
    const presentation = makePresentation([
      makeSlide({ templateLayoutId: "title-only", imageQuery: "KEEP-A" }),
      makeSlide({ templateLayoutId: "with-image", imageQuery: "old" }),
      makeSlide({ templateLayoutId: "title-only", imageQuery: "KEEP-C" }),
      makeSlide({ templateLayoutId: "with-image", imageQuery: "old" }),
    ]);

    mockCallLLM.mockResolvedValueOnce(
      JSON.stringify([
        { slideIndex: 1, query: "crumbling desert ruins" },
        { slideIndex: 3, query: "stormy ocean horizon" },
      ]),
    );

    const result = await generateImageQueries({
      presentation,
      templateManifest: manifest,
    });

    expect(result.slides[0].imageQuery).toBe("KEEP-A");
    expect(result.slides[1].imageQuery).toBe("crumbling desert ruins");
    expect(result.slides[2].imageQuery).toBe("KEEP-C");
    expect(result.slides[3].imageQuery).toBe("stormy ocean horizon");
  });

  it("returns the presentation unchanged when there are no image-bearing slides", async () => {
    const manifest = makeManifest();
    const presentation = makePresentation([
      makeSlide({ templateLayoutId: "title-only", imageQuery: "A" }),
      makeSlide({ templateLayoutId: "title-only", imageQuery: "B" }),
    ]);

    const result = await generateImageQueries({
      presentation,
      templateManifest: manifest,
    });

    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(result.slides[0].imageQuery).toBe("A");
    expect(result.slides[1].imageQuery).toBe("B");
  });

  it("retries once on malformed LLM response, then falls back to existing imageQuery (no crash)", async () => {
    const manifest = makeManifest();
    const presentation = makePresentation([
      makeSlide({ templateLayoutId: "with-image", imageQuery: "ORIGINAL" }),
    ]);

    mockCallLLM
      .mockResolvedValueOnce("not json at all")
      .mockResolvedValueOnce("still not json");

    const result = await generateImageQueries({
      presentation,
      templateManifest: manifest,
    });

    expect(mockCallLLM).toHaveBeenCalledTimes(2);
    expect(result.slides[0].imageQuery).toBe("ORIGINAL");
  });

  it("system prompt contains the verbatim phrase 'strip proper nouns'", async () => {
    const manifest = makeManifest();
    const presentation = makePresentation([
      makeSlide({ templateLayoutId: "with-image" }),
    ]);

    mockCallLLM.mockResolvedValueOnce(
      JSON.stringify([{ slideIndex: 0, query: "quiet statue" }]),
    );

    await generateImageQueries({ presentation, templateManifest: manifest });

    const systemPrompt = mockCallLLM.mock.calls[0][1] as string;
    expect(systemPrompt).toContain("strip proper nouns");
  });
});
