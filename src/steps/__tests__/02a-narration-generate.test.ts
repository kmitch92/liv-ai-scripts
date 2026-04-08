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

import { generateNarration } from "../02a-narration-generate.js";
import { callLLM } from "../../lib/llm.js";
import type { NarrationGenerateOptions } from "../02a-narration-generate.js";

const mockCallLLM = vi.mocked(callLLM);

function makeValidResponse(overrides?: Partial<{
  totalDurationSeconds: number;
  sectionCount: number;
  title: string;
  narrativeArc: string;
}>): string {
  const sectionCount = overrides?.sectionCount ?? 5;
  const totalDuration = overrides?.totalDurationSeconds ?? 480;
  const perSection = Math.round(totalDuration / sectionCount);

  const sections = Array.from({ length: sectionCount }, (_, i) => ({
    sectionLabel: `Section ${i + 1}`,
    narration: `This is the narration for section ${i + 1}. It covers important topics.`,
    durationSeconds: perSection,
  }));

  return JSON.stringify({
    title: overrides?.title ?? "Test Presentation",
    narrativeArc: overrides?.narrativeArc ?? "Introduction to analysis to summary",
    sections,
    totalDurationSeconds: totalDuration,
  });
}

const defaultOptions: NarrationGenerateOptions = {
  topic: "Test Topic",
  contextText: "Some context",
  speakerIdentity: "a friendly tutor",
  targetAudience: "GCSE students",
  systemPrompt: "Teach well",
  durationMinutes: 8,
};

describe("generateNarration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("happy path", () => {
    it("returns a parsed NarrationScript given a valid LLM response", async () => {
      mockCallLLM.mockResolvedValueOnce(makeValidResponse());

      const result = await generateNarration(defaultOptions);

      expect(result.title).toBe("Test Presentation");
      expect(result.narrativeArc).toBe("Introduction to analysis to summary");
      expect(result.sections).toHaveLength(5);
      expect(result.totalDurationSeconds).toBe(480);
    });

    it("populates all section fields", async () => {
      mockCallLLM.mockResolvedValueOnce(makeValidResponse());

      const result = await generateNarration(defaultOptions);

      for (const section of result.sections) {
        expect(section.sectionLabel).toBeDefined();
        expect(section.narration).toBeDefined();
        expect(section.durationSeconds).toBeGreaterThanOrEqual(10);
        expect(section.durationSeconds).toBeLessThanOrEqual(180);
      }
    });

    it("accepts duration at exact lower bound (80% of target)", async () => {
      mockCallLLM.mockResolvedValueOnce(
        makeValidResponse({ totalDurationSeconds: 384, sectionCount: 4 }),
      );

      const result = await generateNarration(defaultOptions);

      expect(result.totalDurationSeconds).toBe(384);
    });

    it("accepts duration at exact upper bound (120% of target)", async () => {
      mockCallLLM.mockResolvedValueOnce(
        makeValidResponse({ totalDurationSeconds: 576, sectionCount: 4 }),
      );

      const result = await generateNarration(defaultOptions);

      expect(result.totalDurationSeconds).toBe(576);
    });

    it("calls callLLM exactly once on first-attempt success", async () => {
      mockCallLLM.mockResolvedValueOnce(makeValidResponse());

      await generateNarration(defaultOptions);

      expect(mockCallLLM).toHaveBeenCalledTimes(1);
    });
  });

  describe("JSON extraction", () => {
    it("handles response wrapped in markdown code fences", async () => {
      const fenced = "```json\n" + makeValidResponse() + "\n```";
      mockCallLLM.mockResolvedValueOnce(fenced);

      const result = await generateNarration(defaultOptions);

      expect(result.title).toBe("Test Presentation");
    });

    it("handles response wrapped in plain code fences without json tag", async () => {
      const fenced = "```\n" + makeValidResponse() + "\n```";
      mockCallLLM.mockResolvedValueOnce(fenced);

      const result = await generateNarration(defaultOptions);

      expect(result.title).toBe("Test Presentation");
    });

    it("handles raw JSON response with surrounding text", async () => {
      const withPreamble = "Here is the JSON:\n" + makeValidResponse() + "\nDone.";
      mockCallLLM.mockResolvedValueOnce(withPreamble);

      const result = await generateNarration(defaultOptions);

      expect(result.title).toBe("Test Presentation");
    });
  });

  describe("retry on invalid JSON", () => {
    it("retries and succeeds when first call returns garbage", async () => {
      mockCallLLM
        .mockResolvedValueOnce("this is not json at all")
        .mockResolvedValueOnce(makeValidResponse());

      const result = await generateNarration(defaultOptions);

      expect(result.title).toBe("Test Presentation");
      expect(mockCallLLM).toHaveBeenCalledTimes(2);
    });

    it("throws after all attempts return unparseable JSON", async () => {
      mockCallLLM
        .mockResolvedValue("not json");

      await expect(generateNarration(defaultOptions)).rejects.toThrow(
        /Failed to parse Claude response as JSON after 3 attempts/,
      );
      expect(mockCallLLM).toHaveBeenCalledTimes(3);
    });
  });

  describe("retry on schema validation failure", () => {
    it("retries and succeeds when first call returns invalid schema", async () => {
      const missingFields = JSON.stringify({ title: "Only title" });
      mockCallLLM
        .mockResolvedValueOnce(missingFields)
        .mockResolvedValueOnce(makeValidResponse());

      const result = await generateNarration(defaultOptions);

      expect(result.title).toBe("Test Presentation");
      expect(mockCallLLM).toHaveBeenCalledTimes(2);
    });

    it("throws after all attempts return schema-invalid JSON", async () => {
      const missingFields = JSON.stringify({ title: "Only title" });
      mockCallLLM.mockResolvedValue(missingFields);

      await expect(generateNarration(defaultOptions)).rejects.toThrow(
        /Schema validation failed after 3 attempts/,
      );
      expect(mockCallLLM).toHaveBeenCalledTimes(3);
    });
  });

  describe("retry on duration out of range", () => {
    it("retries and succeeds when first call returns duration below 80%", async () => {
      mockCallLLM
        .mockResolvedValueOnce(makeValidResponse({ totalDurationSeconds: 200, sectionCount: 3 }))
        .mockResolvedValueOnce(makeValidResponse({ totalDurationSeconds: 480 }));

      const result = await generateNarration(defaultOptions);

      expect(result.totalDurationSeconds).toBe(480);
      expect(mockCallLLM).toHaveBeenCalledTimes(2);
    });

    it("retries and succeeds when first call returns duration above 120%", async () => {
      mockCallLLM
        .mockResolvedValueOnce(makeValidResponse({ totalDurationSeconds: 600, sectionCount: 5 }))
        .mockResolvedValueOnce(makeValidResponse({ totalDurationSeconds: 480 }));

      const result = await generateNarration(defaultOptions);

      expect(result.totalDurationSeconds).toBe(480);
      expect(mockCallLLM).toHaveBeenCalledTimes(2);
    });

    it("throws after all attempts return out-of-range duration", async () => {
      mockCallLLM.mockResolvedValue(
        makeValidResponse({ totalDurationSeconds: 200, sectionCount: 3 }),
      );

      await expect(generateNarration(defaultOptions)).rejects.toThrow(
        /Duration 200s outside allowed range \(384-576s\) after 3 attempts/,
      );
      expect(mockCallLLM).toHaveBeenCalledTimes(3);
    });
  });

  describe("max retries", () => {
    it("makes exactly 3 attempts (initial + 2 retries) before throwing", async () => {
      mockCallLLM.mockResolvedValue("garbage");

      await expect(generateNarration(defaultOptions)).rejects.toThrow();

      expect(mockCallLLM).toHaveBeenCalledTimes(3);
    });

    it("succeeds on the third and final attempt", async () => {
      mockCallLLM
        .mockResolvedValueOnce("garbage")
        .mockResolvedValueOnce(JSON.stringify({ title: "no sections" }))
        .mockResolvedValueOnce(makeValidResponse());

      const result = await generateNarration(defaultOptions);

      expect(result.title).toBe("Test Presentation");
      expect(mockCallLLM).toHaveBeenCalledTimes(3);
    });
  });
});
