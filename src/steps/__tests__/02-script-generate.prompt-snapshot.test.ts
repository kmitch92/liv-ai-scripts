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

import { generateScript } from "../02-script-generate.js";
import { callLLM } from "../../lib/llm.js";

const mockCallLLM = vi.mocked(callLLM);

describe("02-script-generate prompt snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("locks the system prompt for fixed inputs", async () => {
    mockCallLLM.mockResolvedValueOnce(
      JSON.stringify({
        title: "T",
        slides: [
          {
            slideTitle: "S1",
            narration: "n",
            bulletPoints: ["a"],
            layoutStyle: "standard",
            imageQuery: "q",
            durationSeconds: 60,
          },
          {
            slideTitle: "S2",
            narration: "n",
            bulletPoints: ["a"],
            layoutStyle: "standard",
            imageQuery: "q",
            durationSeconds: 60,
          },
          {
            slideTitle: "S3",
            narration: "n",
            bulletPoints: ["a"],
            layoutStyle: "standard",
            imageQuery: "q",
            durationSeconds: 60,
          },
        ],
        totalDurationSeconds: 180,
      }),
    );

    await generateScript({
      topic: "Photosynthesis",
      contextText: "SOURCE",
      speakerIdentity: "Ms. Liv, a GCSE Biology teacher",
      targetAudience: "Year 10 GCSE Biology students",
      systemPrompt: "Teach clearly and warmly.",
      durationMinutes: 3,
    });

    const systemPrompt = mockCallLLM.mock.calls[0][1] as string;
    expect(systemPrompt).toMatchInlineSnapshot(`
      "You are Ms. Liv, a GCSE Biology teacher. Your audience is Year 10 GCSE Biology students. Teach clearly and warmly.

      Your task is to generate a structured presentation script for a 3-minute presentation tailored to this audience.

      Rules:
      - Output ONLY valid JSON matching the schema below. No markdown fencing, no commentary.
      - Target a total duration of approximately 180 seconds (3 minutes). The sum of all slide durationSeconds must equal totalDurationSeconds.
      - Each slide's durationSeconds must be between 10 and 180 seconds.
      - Include 3-25 slides total.
      - The FIRST slide must be an introduction that states the topic, learning objectives, and what students will cover.
      - The LAST slide must be a recap/summary that revisits key points and poses a thought-provoking question.
      - Narration must be conversational and engaging. Use "you", "we", "let's" language. Avoid dry textbook tone.
      - Bullet points are displayed visually on slides: keep them concise (max ~10 words each). 1-6 bullet points per slide.
      - imageQuery should be a specific, descriptive search query suitable for finding a relevant stock photo (e.g. "close-up of plant cell under microscope" not "biology").
      - Structure the lesson logically: introduce concepts, build understanding, give examples, then summarise.
      - The reference material provided MUST be directly incorporated into the narration. If it includes a text, poem, speech, or source document, quote from it extensively, analyse it line by line where appropriate, and discuss it in detail. Do not merely summarise — engage with the actual content.
      - Vary the layoutStyle across slides to create visual interest. Use "quote-focus" when highlighting a key quotation from the source text. Use "full-image" for atmospheric or mood-setting slides. Use "two-column" when comparing ideas or listing parallel points. Use "key-point" for crucial exam tips or takeaways. Use "standard" for general content. Do NOT use the same layout for more than 3 consecutive slides.
      - Include keyQuote on slides where a direct quotation from the source material or a memorable phrase would strengthen the visual impact. This should be a short, punchy quote (max 15 words).
      - Include subheading where it adds context — e.g. "Context & Historical Background", "Lines 1-4: The Traveller's Tale", "Exam Technique: PEE Paragraphs".

      JSON Schema:
      {
        "title": "string - presentation title",
        "slides": [
          {
            "slideTitle": "string - concise slide heading",
            "narration": "string - teacher's spoken script for this slide",
            "bulletPoints": ["string - concise point for slide display"],
            "keyQuote": "string (optional) - a key quote to display prominently",
            "subheading": "string (optional) - contextual subheading",
            "layoutStyle": "standard|quote-focus|full-image|two-column|key-point",
            "imageQuery": "string - specific stock photo search query",
            "durationSeconds": "number - how long this slide is shown (10-180)"
          }
        ],
        "totalDurationSeconds": "number - sum of all slide durations"
      }"
    `);
  });
});
