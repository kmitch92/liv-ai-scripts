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

const mockCallLLM = vi.mocked(callLLM);

describe("02a-narration-generate prompt snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("locks the system prompt for fixed inputs", async () => {
    mockCallLLM.mockResolvedValueOnce(
      JSON.stringify({
        title: "T",
        narrativeArc: "arc",
        sections: [
          { sectionLabel: "Intro", narration: "n", durationSeconds: 60 },
          { sectionLabel: "Body", narration: "n", durationSeconds: 60 },
          { sectionLabel: "Outro", narration: "n", durationSeconds: 60 },
        ],
        totalDurationSeconds: 180,
      }),
    );

    await generateNarration({
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

      Your task is to write a spoken narration script for a 3-minute audio presentation. Think of this as preparing a podcast episode or audiobook chapter — your ONLY output is the words that will be spoken aloud. Do NOT include any visual directions, slide references, bullet points, layout instructions, or image descriptions.

      Rules:
      - Output ONLY valid JSON matching the schema below. No markdown fencing, no commentary.
      - Target a total duration of approximately 180 seconds (3 minutes). The sum of all section durationSeconds must equal totalDurationSeconds.
      - Each section's durationSeconds must be between 10 and 180 seconds.
      - Include 3-25 sections total.
      - The FIRST section must introduce the topic warmly: state what the listener will learn, why it matters, and set expectations for the journey ahead.
      - The LAST section must summarise key takeaways, revisit the most important ideas, and leave the listener with a thought-provoking question or call to action.
      - Write in a warm, conversational tone throughout. Address the listener directly using "you", "we", "let's". Avoid dry, textbook-style prose — this should feel like a knowledgeable mentor speaking to a friend.
      - Vary sentence length and rhythm. Use rhetorical questions, pauses (indicated by ellipses or dashes), and emphasis to maintain engagement.
      - The reference material provided MUST be directly incorporated into the narration. If it includes a text, poem, speech, or source document, quote from it extensively and verbatim, analyse it line by line where appropriate, and discuss its meaning, context, and significance in depth. Do not merely summarise — engage with the actual words and phrases of the source.
      - Each section should have a clear sectionLabel that describes the content covered (e.g. "Introduction", "Lines 1-4: The Opening Image", "Key Themes and Connections", "Summary and Reflection").
      - The narrativeArc field should capture the pedagogical flow: how the narration builds understanding from introduction through exploration to synthesis.
      - Structure the narration logically: introduce the topic and context, build understanding incrementally, explore details with examples and analysis, then synthesise and summarise.
      - Transitions between sections should feel natural — as if the speaker is guiding the listener through a conversation, not jumping between disconnected topics.

      JSON Schema:
      {
        "title": "string - presentation title",
        "narrativeArc": "string - summary of the pedagogical flow across all sections",
        "sections": [
          {
            "sectionLabel": "string - short label for this section",
            "narration": "string - the full spoken script for this section",
            "durationSeconds": "number - estimated spoken duration in seconds (10-180)"
          }
        ],
        "totalDurationSeconds": "number - sum of all section durations"
      }"
    `);
  });
});
