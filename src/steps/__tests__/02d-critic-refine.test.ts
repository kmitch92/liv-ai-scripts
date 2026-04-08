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
import type { Presentation, NarrationScript } from "../../types/index.js";

const mockCallLLM = vi.mocked(callLLM);

function makePresentation(slideCount = 5): Presentation {
  return {
    title: "Test",
    slides: Array.from({ length: slideCount }, (_, i) => ({
      slideTitle: `Slide ${i + 1}`,
      narration: `Narration ${i + 1}`,
      bulletPoints: ["Point 1", "Point 2"],
      layoutStyle: "standard" as const,
      imageQuery: "image",
      durationSeconds: 60,
    })),
    totalDurationSeconds: slideCount * 60,
  };
}

function makeNarrationScript(slideCount = 5): NarrationScript {
  return {
    title: "Test",
    narrativeArc: "Arc",
    sections: Array.from({ length: slideCount }, (_, i) => ({
      sectionLabel: `Section ${i + 1}`,
      narration: `Narration ${i + 1}`,
      durationSeconds: 60,
    })),
    totalDurationSeconds: slideCount * 60,
  };
}

function makeCritiqueResponse(overallScore: number): string {
  return JSON.stringify({
    scores: {
      contentDensity: overallScore,
      narrationAlignment: overallScore,
      visualVariety: overallScore,
      informationHierarchy: overallScore,
      quoteCoverage: overallScore,
    },
    overallScore,
    suggestions: [],
    summary: `Score: ${overallScore}`,
  });
}

function makeRefinedPresentationResponse(marker: string, slideCount = 5): string {
  return JSON.stringify({
    title: marker,
    slides: Array.from({ length: slideCount }, (_, i) => ({
      slideTitle: `${marker} Slide ${i + 1}`,
      narration: `Narration ${i + 1}`,
      bulletPoints: ["Improved point 1", "Improved point 2"],
      layoutStyle: "standard" as const,
      imageQuery: "improved image",
      durationSeconds: 60,
    })),
    totalDurationSeconds: slideCount * 60,
  });
}

describe("criticRefine", () => {
  const defaultPresentation = makePresentation();
  const defaultNarrationScript = makeNarrationScript();
  const defaultContextText = "Some source material";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("passes on first critique", () => {
    it("returns input presentation unchanged when initial score >= 7", async () => {
      mockCallLLM.mockResolvedValueOnce(makeCritiqueResponse(8));

      const result = await criticRefine({
        presentation: defaultPresentation,
        narrationScript: defaultNarrationScript,
        contextText: defaultContextText,
      });

      expect(result).toBe(defaultPresentation);
    });

    it("calls callLLM exactly once for a passing critique", async () => {
      mockCallLLM.mockResolvedValueOnce(makeCritiqueResponse(7));

      await criticRefine({
        presentation: defaultPresentation,
        narrationScript: defaultNarrationScript,
        contextText: defaultContextText,
      });

      expect(mockCallLLM).toHaveBeenCalledTimes(1);
    });
  });

  describe("triggers refinement when score is below threshold", () => {
    it("refines then re-critiques, returning refined presentation on passing second critique", async () => {
      mockCallLLM
        .mockResolvedValueOnce(makeCritiqueResponse(5))
        .mockResolvedValueOnce(makeRefinedPresentationResponse("Refined"))
        .mockResolvedValueOnce(makeCritiqueResponse(8));

      const result = await criticRefine({
        presentation: defaultPresentation,
        narrationScript: defaultNarrationScript,
        contextText: defaultContextText,
      });

      expect(result.title).toBe("Refined");
      expect(mockCallLLM).toHaveBeenCalledTimes(3);
    });
  });

  describe("max iterations exhausted", () => {
    it("calls callLLM 5 times when all critiques score below threshold", async () => {
      mockCallLLM
        .mockResolvedValueOnce(makeCritiqueResponse(3))
        .mockResolvedValueOnce(makeRefinedPresentationResponse("Refined-V1"))
        .mockResolvedValueOnce(makeCritiqueResponse(4))
        .mockResolvedValueOnce(makeRefinedPresentationResponse("Refined-V2"))
        .mockResolvedValueOnce(makeCritiqueResponse(5));

      await criticRefine({
        presentation: defaultPresentation,
        narrationScript: defaultNarrationScript,
        contextText: defaultContextText,
      });

      expect(mockCallLLM).toHaveBeenCalledTimes(5);
    });

    it("returns the best-scored presentation when threshold is never met", async () => {
      mockCallLLM
        .mockResolvedValueOnce(makeCritiqueResponse(3))
        .mockResolvedValueOnce(makeRefinedPresentationResponse("Refined-V1"))
        .mockResolvedValueOnce(makeCritiqueResponse(5))
        .mockResolvedValueOnce(makeRefinedPresentationResponse("Refined-V2"))
        .mockResolvedValueOnce(makeCritiqueResponse(4));

      const result = await criticRefine({
        presentation: defaultPresentation,
        narrationScript: defaultNarrationScript,
        contextText: defaultContextText,
      });

      expect(result.title).toBe("Refined-V1");
    });
  });

  describe("returns best version across iterations", () => {
    it("returns the presentation associated with the highest critique score", async () => {
      mockCallLLM
        .mockResolvedValueOnce(makeCritiqueResponse(4))
        .mockResolvedValueOnce(makeRefinedPresentationResponse("Refined-V1"))
        .mockResolvedValueOnce(makeCritiqueResponse(6))
        .mockResolvedValueOnce(makeRefinedPresentationResponse("Refined-V2"))
        .mockResolvedValueOnce(makeCritiqueResponse(5));

      const result = await criticRefine({
        presentation: defaultPresentation,
        narrationScript: defaultNarrationScript,
        contextText: defaultContextText,
      });

      expect(result.title).toBe("Refined-V1");
    });

    it("returns the original presentation when it has the highest score", async () => {
      mockCallLLM
        .mockResolvedValueOnce(makeCritiqueResponse(6))
        .mockResolvedValueOnce(makeRefinedPresentationResponse("Refined-V1"))
        .mockResolvedValueOnce(makeCritiqueResponse(4))
        .mockResolvedValueOnce(makeRefinedPresentationResponse("Refined-V2"))
        .mockResolvedValueOnce(makeCritiqueResponse(3));

      const result = await criticRefine({
        presentation: defaultPresentation,
        narrationScript: defaultNarrationScript,
        contextText: defaultContextText,
      });

      expect(result).toBe(defaultPresentation);
    });
  });

  describe("edge cases", () => {
    it("treats score of exactly 7 as passing", async () => {
      mockCallLLM.mockResolvedValueOnce(makeCritiqueResponse(7));

      const result = await criticRefine({
        presentation: defaultPresentation,
        narrationScript: defaultNarrationScript,
        contextText: defaultContextText,
      });

      expect(result).toBe(defaultPresentation);
      expect(mockCallLLM).toHaveBeenCalledTimes(1);
    });

    it("treats score of 6 as failing and triggers refinement", async () => {
      mockCallLLM
        .mockResolvedValueOnce(makeCritiqueResponse(6))
        .mockResolvedValueOnce(makeRefinedPresentationResponse("Refined"))
        .mockResolvedValueOnce(makeCritiqueResponse(8));

      const result = await criticRefine({
        presentation: defaultPresentation,
        narrationScript: defaultNarrationScript,
        contextText: defaultContextText,
      });

      expect(result.title).toBe("Refined");
      expect(mockCallLLM).toHaveBeenCalledTimes(3);
    });

    it("returns immediately on score 10 without any refinement", async () => {
      mockCallLLM.mockResolvedValueOnce(makeCritiqueResponse(10));

      const result = await criticRefine({
        presentation: defaultPresentation,
        narrationScript: defaultNarrationScript,
        contextText: defaultContextText,
      });

      expect(result).toBe(defaultPresentation);
      expect(mockCallLLM).toHaveBeenCalledTimes(1);
    });

    it("passes after one refinement iteration when second critique passes", async () => {
      mockCallLLM
        .mockResolvedValueOnce(makeCritiqueResponse(3))
        .mockResolvedValueOnce(makeRefinedPresentationResponse("V1"))
        .mockResolvedValueOnce(makeCritiqueResponse(9));

      const result = await criticRefine({
        presentation: defaultPresentation,
        narrationScript: defaultNarrationScript,
        contextText: defaultContextText,
      });

      expect(result.title).toBe("V1");
      expect(mockCallLLM).toHaveBeenCalledTimes(3);
    });
  });
});
