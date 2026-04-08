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

import { extractSlideStructure } from "../02b-slide-structure.js";
import type { SlideStructureOptions } from "../02b-slide-structure.js";
import { callLLM } from "../../lib/llm.js";
import * as logger from "../../lib/logger.js";
import type { NarrationScript, TemplateManifest } from "../../types/index.js";

const mockCallLLM = vi.mocked(callLLM);
const mockWarn = vi.mocked(logger.warn);

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
        /Slide count \(3\) does not match narration section count \(5\) after 3 attempts/,
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

  describe("narration mismatch warning", () => {
    it("calls logger.warn when LLM alters narration text but still returns result", async () => {
      const narration = makeNarrationScript(3);
      const responseObj = JSON.parse(makeValidPresentationResponse(narration));
      responseObj.slides[1].narration = "Altered narration text by the LLM";
      mockCallLLM.mockResolvedValueOnce(JSON.stringify(responseObj));

      const result = await extractSlideStructure(defaultOptions({ narrationScript: narration }));

      expect(result.title).toBe("Test Presentation");
      expect(result.slides).toHaveLength(3);
      expect(mockWarn).toHaveBeenCalledWith(
        expect.stringContaining("narration differs from section"),
      );
    });

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
});
