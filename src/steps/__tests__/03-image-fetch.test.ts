import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("../../lib/logger.js", () => ({
  startStep: vi.fn(),
  succeedStep: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  failStep: vi.fn(),
}));

vi.mock("sharp", () => {
  const chain = {
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toFile: vi.fn().mockResolvedValue(undefined),
  };
  return { default: vi.fn(() => chain) };
});

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockRejectedValue(new Error("no cache")),
}));

import { fetchImages } from "../03-image-fetch.js";
import type { Slide, TemplateManifest } from "../../types/index.js";

const originalFetch = global.fetch;

function makeSlide(overrides: Partial<Slide> = {}): Slide {
  return {
    slideTitle: "Slide",
    narration: "n",
    bulletPoints: ["a"],
    layoutStyle: "standard",
    imageQuery: "mountain",
    durationSeconds: 30,
    ...overrides,
  };
}

function makeManifest(): TemplateManifest {
  return {
    layouts: [
      {
        id: "title-only",
        name: "Title",
        description: "Title only",
        placeholders: [{ name: "title", type: "title" }],
        bestFor: ["intro"],
        hasImage: false,
      },
      {
        id: "with-image",
        name: "With image",
        description: "Has image",
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

const brandColors = {
  primary: "#111",
  secondary: "#222",
  background: "#fff",
  text: "#000",
};

describe("fetchImages — skip slides without image placeholder", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("api.unsplash.com")) {
        return {
          ok: true,
          json: async () => ({
            results: [{ urls: { regular: "https://img.example/x.jpg" } }],
          }),
        } as unknown as Response;
      }
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      } as unknown as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.UNSPLASH_ACCESS_KEY = "test-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("only fetches Unsplash for slides whose layout has an image placeholder (2 of 3)", async () => {
    const manifest = makeManifest();
    const slides: Slide[] = [
      makeSlide({ templateLayoutId: "with-image", imageQuery: "sea" }),
      makeSlide({ templateLayoutId: "title-only", imageQuery: "unused" }),
      makeSlide({ templateLayoutId: "with-image", imageQuery: "forest" }),
    ];

    await fetchImages({
      slides,
      tempDir: "/tmp/test",
      brandColors,
      topic: "test",
      templateManifest: manifest,
    });

    const unsplashCalls = fetchMock.mock.calls.filter(([url]) =>
      typeof url === "string" && url.includes("api.unsplash.com"),
    );
    expect(unsplashCalls).toHaveLength(2);
  });

  it("returns an empty-string placeholder at skipped indices (imagePaths remains index-addressable)", async () => {
    const manifest = makeManifest();
    const slides: Slide[] = [
      makeSlide({ templateLayoutId: "with-image" }),
      makeSlide({ templateLayoutId: "title-only" }),
      makeSlide({ templateLayoutId: "with-image" }),
    ];

    const paths = await fetchImages({
      slides,
      tempDir: "/tmp/test",
      brandColors,
      topic: "test",
      templateManifest: manifest,
    });

    expect(paths).toHaveLength(3);
    expect(paths[1]).toBe("");
    expect(paths[0]).not.toBe("");
    expect(paths[2]).not.toBe("");
  });

  it("falls back to fetching every slide when no manifest is passed (backwards compat)", async () => {
    const slides: Slide[] = [
      makeSlide({ imageQuery: "a" }),
      makeSlide({ imageQuery: "b" }),
      makeSlide({ imageQuery: "c" }),
    ];

    await fetchImages({
      slides,
      tempDir: "/tmp/test",
      brandColors,
      topic: "test",
    });

    const unsplashCalls = fetchMock.mock.calls.filter(([url]) =>
      typeof url === "string" && url.includes("api.unsplash.com"),
    );
    expect(unsplashCalls).toHaveLength(3);
  });
});
