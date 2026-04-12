import { vi, describe, it, expect, beforeEach } from "vitest";
import type {
  Presentation,
  Config,
  TemplateManifest,
} from "../../types/index.js";

const mocks = vi.hoisted(() => {
  const addSlideMock = vi.fn();
  const writeMock = vi.fn(async () => undefined);
  const loadRootMock = vi.fn();
  const loadMock = vi.fn();
  const loadMediaMock = vi.fn();
  const setTextMock = vi.fn((text: string) => ({ __setText: text }));
  const setTableMock = vi.fn((data: unknown) => ({ __setTable: data }));
  const setTableDataMock = vi.fn((data: unknown) => ({
    __setTableData: data,
  }));
  const setRelationTargetMock = vi.fn((t: string) => ({ __setRel: t }));
  class AutomizerMock {
    constructor(_opts: unknown) {}
    loadRoot = loadRootMock;
    load = loadMock;
    loadMedia = loadMediaMock;
    addSlide = addSlideMock;
    write = writeMock;
  }
  return {
    addSlideMock,
    writeMock,
    loadRootMock,
    loadMock,
    loadMediaMock,
    setTextMock,
    setTableMock,
    setTableDataMock,
    setRelationTargetMock,
    AutomizerMock,
  };
});

const {
  addSlideMock,
  setTableMock,
  setTableDataMock,
} = mocks;

vi.mock("pptx-automizer", () => {
  const mod = {
    Automizer: mocks.AutomizerMock,
    modify: {
      setText: mocks.setTextMock,
      setTable: mocks.setTableMock,
      setTableData: mocks.setTableDataMock,
      setRelationTarget: mocks.setRelationTargetMock,
    },
  };
  return {
    default: mod,
    ...mod,
  };
});

vi.mock("node:fs/promises", async () => {
  return {
    access: vi.fn(async () => undefined),
  };
});

vi.mock("../../lib/logger.js", () => ({
  startStep: vi.fn(),
  succeedStep: vi.fn(),
  failStep: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

import { generatePptxV2 } from "../05-pptx-generate-v2.js";

function makeConfig(): Config {
  return {
    branding: {
      logo: "logo.png",
      assetsDir: "./assets",
      colors: {
        primary: "#000",
        secondary: "#111",
        background: "#FFF",
        text: "#000",
      },
      fonts: { heading: "Arial", body: "Calibri" },
    },
    elevenlabs: {
      voiceId: "v",
      modelId: "m",
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0,
      speed: 1,
      useSpeakerBoost: true,
    },
    script: {
      speakerIdentity: "tutor",
      targetAudience: "students",
      systemPrompt: "teach",
      contextFiles: [],
      phoneticsOverrides: [],
      durationMinutes: 8,
    },
    pipeline: {
      useIterativeContent: false,
      enableCritic: false,
      enableDesignValidation: false,
      useTemplateEngine: true,
    },
  };
}

function makeManifestWithTable(): TemplateManifest {
  return {
    layouts: [
      {
        id: "table-layout",
        name: "Table Layout",
        description: "A layout with a table placeholder",
        bestFor: ["comparison"],
        hasImage: false,
        placeholders: [
          { name: "Title", type: "title" },
          { name: "ComparisonTable", type: "table" },
        ],
      },
    ],
  };
}

function runCapturedCallback(): {
  modifyElement: ReturnType<typeof vi.fn>;
  modify: ReturnType<typeof vi.fn>;
} {
  // Execute the callback supplied to addSlide so placeholder population runs
  const modifyElement = vi.fn();
  const modify = vi.fn();
  const addedSlide = { modifyElement, modify };
  const lastCall = addSlideMock.mock.calls[addSlideMock.mock.calls.length - 1];
  const cb = lastCall?.[2] as (s: unknown) => void;
  cb(addedSlide);
  return { modifyElement, modify };
}

describe("generatePptxV2 — table content block rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("populates a table placeholder using pptx-automizer setTable with headers and rows from the table content block", async () => {
    const presentation: Presentation = {
      title: "Deck",
      totalDurationSeconds: 60,
      slides: [
        {
          slideTitle: "Comparisons",
          narration: "Compare devices across poems.",
          bulletPoints: ["filler"],
          layoutStyle: "standard",
          imageQuery: "",
          durationSeconds: 60,
          templateLayoutId: "table-layout",
          contentBlocks: [
            {
              type: "table",
              headers: ["Feature", "Quote", "Impact"],
              rows: [["Enjambment", "Line 1", "Momentum"]],
            },
          ],
        },
      ],
    };

    await generatePptxV2({
      presentation,
      imagePaths: [],
      config: makeConfig(),
      tempDir: "/tmp",
      templatePptxPath: "/tmp/template.pptx",
      templateManifest: makeManifestWithTable(),
    });

    const { modifyElement } = runCapturedCallback();

    // Renderer must invoke a pptx-automizer table modifier for the table placeholder
    const tableModifierCalled =
      setTableMock.mock.calls.length > 0 ||
      setTableDataMock.mock.calls.length > 0;
    expect(tableModifierCalled).toBe(true);

    // Assert modifyElement was called with the table placeholder name
    const calledNames = modifyElement.mock.calls.map((c) => c[0]);
    expect(calledNames).toContain("ComparisonTable");

    // Assert the data passed to the table modifier carried our headers + row
    const tableArg =
      setTableMock.mock.calls[0]?.[0] ?? setTableDataMock.mock.calls[0]?.[0];
    expect(JSON.stringify(tableArg)).toContain("Feature");
    expect(JSON.stringify(tableArg)).toContain("Enjambment");
    expect(JSON.stringify(tableArg)).toContain("Momentum");
  });

  it("does not crash for a table placeholder receiving a minimal table (headers + single short row)", async () => {
    const presentation: Presentation = {
      title: "Deck",
      totalDurationSeconds: 60,
      slides: [
        {
          slideTitle: "Minimal",
          narration: "",
          bulletPoints: ["filler"],
          layoutStyle: "standard",
          imageQuery: "",
          durationSeconds: 60,
          templateLayoutId: "table-layout",
          contentBlocks: [
            {
              type: "table",
              headers: ["Only"],
              rows: [[""]],
            },
          ],
        },
      ],
    };

    await expect(
      generatePptxV2({
        presentation,
        imagePaths: [],
        config: makeConfig(),
        tempDir: "/tmp",
        templatePptxPath: "/tmp/template.pptx",
        templateManifest: makeManifestWithTable(),
      }),
    ).resolves.toBeTypeOf("string");

    // Callback should execute without throwing
    expect(() => runCapturedCallback()).not.toThrow();
  });
});
