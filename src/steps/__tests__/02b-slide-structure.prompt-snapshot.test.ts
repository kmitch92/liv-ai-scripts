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
import { callLLM } from "../../lib/llm.js";
import type {
  NarrationScript,
  TemplateManifest,
} from "../../types/index.js";

const mockCallLLM = vi.mocked(callLLM);

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

function makeValidResponse(): string {
  const narration = makeNarration();
  return JSON.stringify({
    title: narration.title,
    narrativeArc: narration.narrativeArc,
    slides: narration.sections.map((s, i) => ({
      slideTitle: `Slide ${i + 1}`,
      narration: s.narration,
      bulletPoints: ["p"],
      layoutStyle: "standard",
      imageQuery: "q",
      durationSeconds: s.durationSeconds,
      templateLayoutId: i === 0 ? "title-slide" : "content-with-image",
    })),
    totalDurationSeconds: narration.totalDurationSeconds,
  });
}

describe("02b-slide-structure prompt snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("locks the system prompt WITHOUT a template manifest", async () => {
    mockCallLLM.mockResolvedValueOnce(makeValidResponse());

    await extractSlideStructure({
      narrationScript: makeNarration(),
      contextText: "SOURCE",
    });

    const systemPrompt = mockCallLLM.mock.calls[0][1] as string;
    expect(systemPrompt).toMatchInlineSnapshot(`
      "You are a visual design specialist. Your task is to read a completed narration script and extract a visual slide structure from it.

      Rules:
      - Output ONLY valid JSON matching the schema below. No markdown fencing, no commentary.
      - The combined narration across all slides should cover all sections; sections may be split across multiple slides.
      - Extract the following for each slide:
        - slideTitle: a concise, descriptive title for the visual slide
        - bulletPoints: 1-6 key points extracted from the narration (also derive from contentBlocks for backwards compatibility)
        - contentBlocks: typed content blocks (see types below)
        - keyQuote: if the narration contains a notable quote or key line, extract it (optional)
        - subheading: a short contextual line under the title (optional)
        - imageConcept: describe the ideal visual — mood, composition, palette, subject matter
        - imageQuery: a specific, concrete search query for finding a stock image
      - durationSeconds on each slide should reflect the length of its narration chunk; slide durations should sum to the total narration duration.

      Content Block Types (for the "contentBlocks" array):
      1. bullet-list: { "type": "bullet-list", "items": ["point 1", "point 2", ...] } — key points or takeaways (1-6 items)
      2. quote: { "type": "quote", "text": "the quote", "attribution": "optional source" } — a notable quote from the source
      3. definition: { "type": "definition", "term": "word or concept", "definition": "explanation" } — a key term or concept explained
      4. callout: { "type": "callout", "text": "important note", "style": "tip|warning|exam-technique" } — highlighted information
      5. paragraph: { "type": "paragraph", "text": "body text" } — a short prose passage for context

      Each slide should have at least one content block. Use a mix of types where the narration supports it.

      The "bulletPoints" array should be derived from the content blocks: take the text from each block (items for bullet-list, text for others) to produce 1-6 summary strings.

      No template manifest provided. For each slide, set "layoutStyle" to one of: "standard", "quote-focus", "full-image", "two-column", "key-point". Vary layouts across slides for visual interest. Do NOT set "templateLayoutId".

      JSON Schema for output:
      {
        "title": "string - presentation title",
        "narrativeArc": "string - summary of pedagogical flow (optional)",
        "slides": [
          {
            "slideTitle": "string",
            "narration": "string - narration chunk for this slide",
            "bulletPoints": ["string", ...] (1-6 items),
            "keyQuote": "string (optional)",
            "subheading": "string (optional)",
            "layoutStyle": "standard|quote-focus|full-image|two-column|key-point",
            "imageQuery": "string - specific stock image search query",
            "imageConcept": "string - mood, composition, palette description (optional)",
            "durationSeconds": "number - duration of this slide's narration chunk",
            "contentBlocks": [
              { "type": "bullet-list", "items": ["...", "..."] },
              { "type": "quote", "text": "...", "attribution": "..." },
              { "type": "definition", "term": "...", "definition": "..." },
              { "type": "callout", "text": "...", "style": "tip|warning|exam-technique" },
              { "type": "paragraph", "text": "..." }
            ]
          }
        ],
        "totalDurationSeconds": "number - sum of all slide durations"
      }"
    `);
  });

  it("locks the system prompt WITH a fixed 2-layout template manifest", async () => {
    const manifest: TemplateManifest = {
      layouts: [
        {
          id: "title-slide",
          name: "Title",
          description: "Opening title slide with headline only",
          placeholders: [{ name: "title", type: "title" }],
          bestFor: ["introduction"],
          hasImage: false,
          maxBullets: 0,
        },
        {
          id: "content-with-image",
          name: "Content with image",
          description: "Body copy with a supporting image on the right",
          placeholders: [
            { name: "body", type: "body", maxChars: 400 },
            { name: "image", type: "image" },
          ],
          bestFor: ["content", "illustration"],
          hasImage: true,
          maxBullets: 5,
        },
      ],
    };

    mockCallLLM.mockResolvedValueOnce(makeValidResponse());

    await extractSlideStructure({
      narrationScript: makeNarration(),
      contextText: "SOURCE",
      templateManifest: manifest,
    });

    const systemPrompt = mockCallLLM.mock.calls[0][1] as string;
    expect(systemPrompt).toMatchInlineSnapshot(`
      "You are a visual design specialist. Your task is to read a completed narration script and extract a visual slide structure from it.

      Rules:
      - Output ONLY valid JSON matching the schema below. No markdown fencing, no commentary.
      - The combined narration across all slides should cover all sections; sections may be split across multiple slides.
      - Extract the following for each slide:
        - slideTitle: a concise, descriptive title for the visual slide
        - bulletPoints: 1-6 key points extracted from the narration (also derive from contentBlocks for backwards compatibility)
        - contentBlocks: typed content blocks (see types below)
        - keyQuote: if the narration contains a notable quote or key line, extract it (optional)
        - subheading: a short contextual line under the title (optional)
        - imageConcept: describe the ideal visual — mood, composition, palette, subject matter
        - imageQuery: a specific, concrete search query for finding a stock image
      - durationSeconds on each slide should reflect the length of its narration chunk; slide durations should sum to the total narration duration.

      Content Block Types (for the "contentBlocks" array):
      1. bullet-list: { "type": "bullet-list", "items": ["point 1", "point 2", ...] } — key points or takeaways (1-6 items)
      2. quote: { "type": "quote", "text": "the quote", "attribution": "optional source" } — a notable quote from the source
      3. definition: { "type": "definition", "term": "word or concept", "definition": "explanation" } — a key term or concept explained
      4. callout: { "type": "callout", "text": "important note", "style": "tip|warning|exam-technique" } — highlighted information
      5. paragraph: { "type": "paragraph", "text": "body text" } — a short prose passage for context

      Each slide should have at least one content block. Use a mix of types where the narration supports it.

      The "bulletPoints" array should be derived from the content blocks: take the text from each block (items for bullet-list, text for others) to produce 1-6 summary strings.

      CONTENT EXPECTATIONS PER LAYOUT:
      - title-slide: Opening title slide with headline only
      - content-with-image: Body copy with a supporting image on the right

      AVAILABLE TEMPLATE LAYOUTS:
        Layout: "title-slide"
          Name: Title
          Description: Opening title slide with headline only
          Placeholders:
          - title (title)
          Best for: introduction
          Has image: false
          Max bullets: 0

        Layout: "content-with-image"
          Name: Content with image
          Description: Body copy with a supporting image on the right
          Placeholders:
          - body (body, max 400 chars)
          - image (image)
          Best for: content, illustration
          Has image: true
          Max bullets: 5

      For each slide, set "templateLayoutId" to one of the layout IDs listed above. Use these layouts in any order, any number of times, as you see fit.
      Follow the CONTENT EXPECTATIONS above for each layout — they describe what content must appear on each slide type.

      JSON Schema for output:
      {
        "title": "string - presentation title",
        "narrativeArc": "string - summary of pedagogical flow (optional)",
        "slides": [
          {
            "slideTitle": "string",
            "narration": "string - narration chunk for this slide",
            "bulletPoints": ["string", ...] (1-6 items),
            "keyQuote": "string (optional)",
            "subheading": "string (optional)",
            "templateLayoutId": "string - one of the layout IDs listed above (required)",
            "imageQuery": "string - specific stock image search query",
            "imageConcept": "string - mood, composition, palette description (optional)",
            "durationSeconds": "number - duration of this slide's narration chunk",
            "contentBlocks": [
              { "type": "bullet-list", "items": ["...", "..."] },
              { "type": "quote", "text": "...", "attribution": "..." },
              { "type": "definition", "term": "...", "definition": "..." },
              { "type": "callout", "text": "...", "style": "tip|warning|exam-technique" },
              { "type": "paragraph", "text": "..." }
            ]
          }
        ],
        "totalDurationSeconds": "number - sum of all slide durations"
      }"
    `);
  });
});
