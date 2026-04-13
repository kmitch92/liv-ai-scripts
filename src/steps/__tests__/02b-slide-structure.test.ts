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

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { extractSlideStructure } from "../02b-slide-structure.js";
import type { SlideStructureOptions } from "../02b-slide-structure.js";
import { callLLM } from "../../lib/llm.js";
import * as logger from "../../lib/logger.js";
import { readFile } from "node:fs/promises";
import type { NarrationScript, TemplateManifest } from "../../types/index.js";

const mockCallLLM = vi.mocked(callLLM);
const mockWarn = vi.mocked(logger.warn);
const mockReadFile = vi.mocked(readFile);

function makeNarrationScript(
  sectionCount = 5,
  durationPerSection = 60,
): NarrationScript {
  return {
    title: "Test Presentation",
    narrativeArc: "Intro to analysis to summary",
    sections: Array.from({ length: sectionCount }, (_, i) => ({
      sectionLabel: `Section ${i + 1}`,
      narration: `Narration for section ${i + 1}. It discusses important topics in detail.`,
      durationSeconds: durationPerSection,
    })),
    totalDurationSeconds: sectionCount * durationPerSection,
  };
}

function makeValidPresentationResponse(narration: NarrationScript): string {
  return JSON.stringify({
    title: narration.title,
    narrativeArc: narration.narrativeArc,
    slides: narration.sections.map((s, i) => ({
      slideTitle: `Slide ${i + 1}: ${s.sectionLabel}`,
      narration: s.narration,
      bulletPoints: ["Key point 1", "Key point 2"],
      layoutStyle: "standard",
      imageQuery: "relevant image",
      durationSeconds: s.durationSeconds,
    })),
    totalDurationSeconds: narration.totalDurationSeconds,
  });
}

function makeManifest(): TemplateManifest {
  return {
    layouts: [
      {
        id: "title-slide",
        name: "Title",
        description: "Title slide",
        placeholders: [{ name: "title", type: "title" }],
        bestFor: ["introduction"],
        hasImage: false,
      },
      {
        id: "content-with-image",
        name: "Content",
        description: "Content with image",
        placeholders: [
          { name: "body", type: "body" },
          { name: "image", type: "image" },
        ],
        bestFor: ["content"],
        hasImage: true,
      },
    ],
  };
}

function defaultOptions(
  overrides?: Partial<SlideStructureOptions>,
): SlideStructureOptions {
  const narrationScript = overrides?.narrationScript ?? makeNarrationScript();
  return {
    narrationScript,
    contextText: "Some source material context",
    ...overrides,
  };
}

describe("extractSlideStructure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("happy path", () => {
    it("returns a Presentation with correct slide count given a valid LLM response", async () => {
      const narration = makeNarrationScript();
      mockCallLLM.mockResolvedValueOnce(
        makeValidPresentationResponse(narration),
      );

      const result = await extractSlideStructure(defaultOptions({ narrationScript: narration }));

      expect(result.title).toBe("Test Presentation");
      expect(result.slides).toHaveLength(5);
      expect(result.totalDurationSeconds).toBe(300);
    });

    it("preserves narration text from input sections onto slides", async () => {
      const narration = makeNarrationScript(3);
      mockCallLLM.mockResolvedValueOnce(
        makeValidPresentationResponse(narration),
      );

      const result = await extractSlideStructure(defaultOptions({ narrationScript: narration }));

      for (let i = 0; i < narration.sections.length; i++) {
        expect(result.slides[i].narration).toBe(narration.sections[i].narration);
      }
    });

    it("calls callLLM exactly once on first-attempt success", async () => {
      const narration = makeNarrationScript();
      mockCallLLM.mockResolvedValueOnce(
        makeValidPresentationResponse(narration),
      );

      await extractSlideStructure(defaultOptions({ narrationScript: narration }));

      expect(mockCallLLM).toHaveBeenCalledTimes(1);
    });

    it("populates slide titles and bullet points", async () => {
      const narration = makeNarrationScript(3);
      mockCallLLM.mockResolvedValueOnce(
        makeValidPresentationResponse(narration),
      );

      const result = await extractSlideStructure(defaultOptions({ narrationScript: narration }));

      for (const slide of result.slides) {
        expect(slide.slideTitle).toBeDefined();
        expect(slide.bulletPoints.length).toBeGreaterThanOrEqual(1);
        expect(slide.imageQuery).toBeDefined();
      }
    });
  });

  describe("with template manifest", () => {
    it("succeeds and returns a valid Presentation when manifest is provided", async () => {
      const narration = makeNarrationScript(3);
      const manifest = makeManifest();
      mockCallLLM.mockResolvedValueOnce(
        makeValidPresentationResponse(narration),
      );

      const result = await extractSlideStructure(
        defaultOptions({ narrationScript: narration, templateManifest: manifest }),
      );

      expect(result.title).toBe("Test Presentation");
      expect(result.slides).toHaveLength(3);
    });
  });

  describe("JSON extraction", () => {
    it("handles response wrapped in markdown code fences", async () => {
      const narration = makeNarrationScript(3);
      const fenced =
        "```json\n" + makeValidPresentationResponse(narration) + "\n```";
      mockCallLLM.mockResolvedValueOnce(fenced);

      const result = await extractSlideStructure(defaultOptions({ narrationScript: narration }));

      expect(result.title).toBe("Test Presentation");
    });

    it("handles raw JSON with surrounding text", async () => {
      const narration = makeNarrationScript(3);
      const withPreamble =
        "Here is the JSON:\n" +
        makeValidPresentationResponse(narration) +
        "\nDone.";
      mockCallLLM.mockResolvedValueOnce(withPreamble);

      const result = await extractSlideStructure(defaultOptions({ narrationScript: narration }));

      expect(result.title).toBe("Test Presentation");
    });
  });

  describe("retry on invalid JSON", () => {
    it("retries and succeeds when first call returns garbage", async () => {
      const narration = makeNarrationScript();
      mockCallLLM
        .mockResolvedValueOnce("this is not json at all")
        .mockResolvedValueOnce(makeValidPresentationResponse(narration));

      const result = await extractSlideStructure(defaultOptions({ narrationScript: narration }));

      expect(result.title).toBe("Test Presentation");
      expect(mockCallLLM).toHaveBeenCalledTimes(2);
    });

    it("throws after all attempts return unparseable JSON", async () => {
      mockCallLLM.mockResolvedValue("not json");

      await expect(
        extractSlideStructure(defaultOptions()),
      ).rejects.toThrow(/Failed to parse LLM response as JSON after 3 attempts/);
      expect(mockCallLLM).toHaveBeenCalledTimes(3);
    });
  });

  describe("retry on schema validation failure", () => {
    it("retries and succeeds when first call returns invalid schema", async () => {
      const narration = makeNarrationScript();
      const missingFields = JSON.stringify({ title: "Only title" });
      mockCallLLM
        .mockResolvedValueOnce(missingFields)
        .mockResolvedValueOnce(makeValidPresentationResponse(narration));

      const result = await extractSlideStructure(defaultOptions({ narrationScript: narration }));

      expect(result.title).toBe("Test Presentation");
      expect(mockCallLLM).toHaveBeenCalledTimes(2);
    });

    it("throws after all attempts return schema-invalid JSON", async () => {
      const missingFields = JSON.stringify({ title: "Only title" });
      mockCallLLM.mockResolvedValue(missingFields);

      await expect(
        extractSlideStructure(defaultOptions()),
      ).rejects.toThrow(/Schema validation failed after 3 attempts/);
      expect(mockCallLLM).toHaveBeenCalledTimes(3);
    });
  });

  describe("retry on slide count mismatch", () => {
    it("retries and succeeds when first call returns wrong slide count", async () => {
      const narration = makeNarrationScript(5);
      const wrongCount = makeNarrationScript(3);
      mockCallLLM
        .mockResolvedValueOnce(makeValidPresentationResponse(wrongCount))
        .mockResolvedValueOnce(makeValidPresentationResponse(narration));

      const result = await extractSlideStructure(defaultOptions({ narrationScript: narration }));

      expect(result.slides).toHaveLength(5);
      expect(mockCallLLM).toHaveBeenCalledTimes(2);
    });

    it("throws when all attempts return wrong slide count", async () => {
      const narration = makeNarrationScript(5);
      const wrongCount = makeNarrationScript(3);
      mockCallLLM.mockResolvedValue(
        makeValidPresentationResponse(wrongCount),
      );

      await expect(
        extractSlideStructure(defaultOptions({ narrationScript: narration })),
      ).rejects.toThrow(
        /Slide count too low.*after 3 attempts/,
      );
      expect(mockCallLLM).toHaveBeenCalledTimes(3);
    });
  });

  describe("max retries", () => {
    it("makes exactly 3 attempts (initial + 2 retries) before throwing", async () => {
      mockCallLLM.mockResolvedValue("garbage");

      await expect(extractSlideStructure(defaultOptions())).rejects.toThrow();

      expect(mockCallLLM).toHaveBeenCalledTimes(3);
    });

    it("succeeds on the third and final attempt", async () => {
      const narration = makeNarrationScript();
      mockCallLLM
        .mockResolvedValueOnce("garbage")
        .mockResolvedValueOnce(JSON.stringify({ title: "no slides" }))
        .mockResolvedValueOnce(makeValidPresentationResponse(narration));

      const result = await extractSlideStructure(defaultOptions({ narrationScript: narration }));

      expect(result.title).toBe("Test Presentation");
      expect(mockCallLLM).toHaveBeenCalledTimes(3);
    });
  });

  describe("narration mismatch warning (removed)", () => {
    it("does not warn when all narrations match exactly", async () => {
      const narration = makeNarrationScript(3);
      mockCallLLM.mockResolvedValueOnce(
        makeValidPresentationResponse(narration),
      );

      await extractSlideStructure(defaultOptions({ narrationScript: narration }));

      const narrationWarns = mockWarn.mock.calls.filter(([msg]) =>
        typeof msg === "string" && msg.includes("narration differs"),
      );
      expect(narrationWarns).toHaveLength(0);
    });
  });

  function makeNineLayoutManifest(): TemplateManifest {
    const layouts = Array.from({ length: 9 }, (_, i) => ({
      id: `layout-${i + 1}`,
      name: `Layout ${i + 1}`,
      description: `Description for layout ${i + 1}`,
      placeholders: [{ name: "body", type: "body" as const }],
      bestFor: ["content"],
      hasImage: i % 2 === 0,
      maxBullets: i + 1,
    }));
    return { layouts };
  }

  function makePresentationWithLayoutIds(
    narration: NarrationScript,
    layoutIds: string[],
  ): string {
    return JSON.stringify({
      title: narration.title,
      narrativeArc: narration.narrativeArc,
      slides: narration.sections.map((s, i) => ({
        slideTitle: `Slide ${i + 1}`,
        narration: s.narration,
        bulletPoints: ["A point"],
        templateLayoutId: layoutIds[i],
        imageQuery: "image",
        durationSeconds: s.durationSeconds,
      })),
      totalDurationSeconds: narration.totalDurationSeconds,
    });
  }

  describe("template manifest prompt content", () => {
    it("includes the verbatim 'Use these layouts in any order' instruction in the system prompt", async () => {
      const narration = makeNarrationScript(3);
      const manifest = makeNineLayoutManifest();
      mockCallLLM.mockResolvedValueOnce(
        makePresentationWithLayoutIds(narration, [
          "layout-1",
          "layout-2",
          "layout-3",
        ]),
      );

      await extractSlideStructure(
        defaultOptions({ narrationScript: narration, templateManifest: manifest }),
      );

      const systemPrompt = mockCallLLM.mock.calls[0][1] as string;
      expect(systemPrompt).toContain(
        "Use these layouts in any order, any number of times, as you see fit.",
      );
    });

    it("includes all 9 layout entries with id, description, maxBullets, and hasImage", async () => {
      const narration = makeNarrationScript(3);
      const manifest = makeNineLayoutManifest();
      mockCallLLM.mockResolvedValueOnce(
        makePresentationWithLayoutIds(narration, [
          "layout-1",
          "layout-2",
          "layout-3",
        ]),
      );

      await extractSlideStructure(
        defaultOptions({ narrationScript: narration, templateManifest: manifest }),
      );

      const systemPrompt = mockCallLLM.mock.calls[0][1] as string;
      for (let i = 1; i <= 9; i++) {
        expect(systemPrompt).toContain(`layout-${i}`);
        expect(systemPrompt).toContain(`Description for layout ${i}`);
      }
      // hasImage and maxBullets should be surfaced
      expect(systemPrompt).toMatch(/hasImage|Has image/i);
      expect(systemPrompt).toMatch(/maxBullets|Max bullets/i);
    });
  });

  describe("slide structure notes", () => {
    it("loads slide structure notes from filesystem and includes them in the prompt", async () => {
      const narration = makeNarrationScript(3);
      const notesContent =
        "Start with a hook about conflict. End with a comparison table.";
      mockReadFile.mockResolvedValueOnce(notesContent);
      mockCallLLM.mockResolvedValueOnce(
        makeValidPresentationResponse(narration),
      );

      await extractSlideStructure(
        defaultOptions({
          narrationScript: narration,
          slideStructureNotes: "/path/to/notes.md",
        } as never),
      );

      expect(mockReadFile).toHaveBeenCalledWith(
        "/path/to/notes.md",
        expect.anything(),
      );
      const userMessage = (mockCallLLM.mock.calls[0][0] as Array<{
        content: string;
      }>)[0].content;
      expect(userMessage).toContain(notesContent);
      expect(userMessage).toMatch(
        /Slide structure notes from the content author/i,
      );
    });

    it("does not read filesystem when slideStructureNotes is not provided", async () => {
      const narration = makeNarrationScript(3);
      mockCallLLM.mockResolvedValueOnce(
        makeValidPresentationResponse(narration),
      );

      await extractSlideStructure(
        defaultOptions({ narrationScript: narration }),
      );

      expect(mockReadFile).not.toHaveBeenCalled();
    });
  });

  describe("variable slide count (splitting sections across slides)", () => {
    function makeExpandedPresentationResponse(
      narration: NarrationScript,
      slideCount: number,
    ): string {
      // Distribute slides across sections: each section contributes >=1 slide.
      // Sections with index < (slideCount - sections.length) get an extra split slide.
      const sectionCount = narration.sections.length;
      const extraSlides = slideCount - sectionCount;
      const slides: Array<{
        slideTitle: string;
        narration: string;
        bulletPoints: string[];
        layoutStyle: string;
        imageQuery: string;
        durationSeconds: number;
      }> = [];

      for (let i = 0; i < sectionCount; i++) {
        const section = narration.sections[i];
        const splits = i < extraSlides ? 2 : 1;
        for (let j = 0; j < splits; j++) {
          slides.push({
            slideTitle: `Slide from section ${i + 1} part ${j + 1}`,
            narration: `Chunk ${j + 1} of ${section.narration}`,
            bulletPoints: ["point a", "point b"],
            layoutStyle: "standard",
            imageQuery: "img",
            durationSeconds: Math.round(section.durationSeconds / splits),
          });
        }
      }

      return JSON.stringify({
        title: narration.title,
        narrativeArc: narration.narrativeArc,
        slides,
        totalDurationSeconds: narration.totalDurationSeconds,
      });
    }

    it("accepts LLM response with MORE slides than sections (9 sections -> 12 slides)", async () => {
      const narration = makeNarrationScript(9);
      mockCallLLM.mockResolvedValue(
        makeExpandedPresentationResponse(narration, 12),
      );

      const result = await extractSlideStructure(
        defaultOptions({ narrationScript: narration }),
      );

      expect(result.slides).toHaveLength(12);
      expect(mockCallLLM).toHaveBeenCalledTimes(1);
    });

    it("rejects LLM response with FEWER slides than sections (9 sections -> 5 slides)", async () => {
      const narration = makeNarrationScript(9);
      const tooFew = makeNarrationScript(5);
      mockCallLLM.mockResolvedValue(makeValidPresentationResponse(tooFew));

      await expect(
        extractSlideStructure(defaultOptions({ narrationScript: narration })),
      ).rejects.toThrow();
      expect(mockCallLLM).toHaveBeenCalledTimes(3);
    });

    it("rejects LLM response exceeding upper bound of 30 slides", async () => {
      const narration = makeNarrationScript(9);
      // Build a 31-slide response: split section 0 into 23 chunks, rest 1:1.
      const slides = [] as Array<Record<string, unknown>>;
      for (let j = 0; j < 23; j++) {
        slides.push({
          slideTitle: `Section 1 part ${j + 1}`,
          narration: `chunk ${j}`,
          bulletPoints: ["p"],
          layoutStyle: "standard",
          imageQuery: "i",
          durationSeconds: 10,
        });
      }
      for (let i = 1; i < 9; i++) {
        slides.push({
          slideTitle: `Slide ${i}`,
          narration: narration.sections[i].narration,
          bulletPoints: ["p"],
          layoutStyle: "standard",
          imageQuery: "i",
          durationSeconds: narration.sections[i].durationSeconds,
        });
      }
      expect(slides).toHaveLength(31);
      const response = JSON.stringify({
        title: narration.title,
        narrativeArc: narration.narrativeArc,
        slides,
        totalDurationSeconds: narration.totalDurationSeconds,
      });
      mockCallLLM.mockResolvedValue(response);

      await expect(
        extractSlideStructure(defaultOptions({ narrationScript: narration })),
      ).rejects.toThrow();
    });

    it("prompt does NOT contain the forced-count phrase 'produce exactly'", async () => {
      const narration = makeNarrationScript(9);
      mockCallLLM.mockResolvedValue(
        makeExpandedPresentationResponse(narration, 12),
      );

      await extractSlideStructure(
        defaultOptions({ narrationScript: narration }),
      );

      const systemPrompt = mockCallLLM.mock.calls[0][1] as string;
      const userMessage = (mockCallLLM.mock.calls[0][0] as Array<{
        content: string;
      }>)[0].content;
      expect(systemPrompt).not.toContain("produce exactly");
      expect(userMessage).not.toContain("produce exactly");
    });

    it("prompt contains the verbatim permission phrase 'You may split'", async () => {
      const narration = makeNarrationScript(9);
      mockCallLLM.mockResolvedValue(
        makeExpandedPresentationResponse(narration, 12),
      );

      await extractSlideStructure(
        defaultOptions({ narrationScript: narration }),
      );

      const systemPrompt = mockCallLLM.mock.calls[0][1] as string;
      const userMessage = (mockCallLLM.mock.calls[0][0] as Array<{
        content: string;
      }>)[0].content;
      const combined = systemPrompt + "\n" + userMessage;
      expect(combined).toContain("You may split");
    });

    it("does NOT warn about narration mismatch when slide narration differs from section narration (splitting is expected)", async () => {
      const narration = makeNarrationScript(9);
      mockCallLLM.mockResolvedValue(
        makeExpandedPresentationResponse(narration, 12),
      );

      await extractSlideStructure(
        defaultOptions({ narrationScript: narration }),
      );

      const narrationWarns = mockWarn.mock.calls.filter(([msg]) =>
        typeof msg === "string" && msg.includes("narration differs"),
      );
      expect(narrationWarns).toHaveLength(0);
    });
  });

  describe("templateLayoutId validation against manifest", () => {
    it("throws a clear error when LLM returns a templateLayoutId not in the manifest", async () => {
      const narration = makeNarrationScript(3);
      const manifest = makeNineLayoutManifest();
      // Return an unknown layout id on slide 2
      const response = makePresentationWithLayoutIds(narration, [
        "layout-1",
        "layout-does-not-exist",
        "layout-3",
      ]);
      mockCallLLM.mockResolvedValue(response);

      await expect(
        extractSlideStructure(
          defaultOptions({
            narrationScript: narration,
            templateManifest: manifest,
          }),
        ),
      ).rejects.toThrow(/layout-does-not-exist|unknown.*layout/i);
    });

    it("succeeds when all templateLayoutIds match manifest ids", async () => {
      const narration = makeNarrationScript(3);
      const manifest = makeNineLayoutManifest();
      mockCallLLM.mockResolvedValueOnce(
        makePresentationWithLayoutIds(narration, [
          "layout-1",
          "layout-4",
          "layout-9",
        ]),
      );

      const result = await extractSlideStructure(
        defaultOptions({ narrationScript: narration, templateManifest: manifest }),
      );
      expect(result.slides).toHaveLength(3);
    });
  });
});
