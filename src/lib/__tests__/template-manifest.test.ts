import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ZodError } from "zod";
import type { TemplateManifest } from "../../types/index.js";
import {
  loadTemplateManifest,
  getLayoutById,
  getLayoutsForIntent,
  getAllLayouts,
} from "../template-manifest.js";

const sampleManifest: TemplateManifest = {
  layouts: [
    {
      id: "title-slide",
      name: "Title Slide",
      description: "Opening title slide",
      placeholders: [
        { name: "title", type: "title" },
        { name: "subtitle", type: "subtitle" },
      ],
      bestFor: ["introduction", "opening"],
      maxBullets: 0,
      hasImage: false,
    },
    {
      id: "content-with-image",
      name: "Content + Image",
      description: "Content with right-side image",
      placeholders: [
        { name: "body", type: "body" },
        { name: "image", type: "image" },
      ],
      bestFor: ["content", "explanation"],
      hasImage: true,
    },
    {
      id: "quote-centered",
      name: "Quote Centered",
      description: "Centered quote layout",
      placeholders: [{ name: "quote", type: "quote" }],
      bestFor: ["quote", "emphasis"],
      hasImage: false,
    },
  ],
};

describe("loadTemplateManifest", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "manifest-test-"));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("loads and parses a valid manifest JSON file", async () => {
    const filePath = join(tmpDir, "valid.json");
    await writeFile(filePath, JSON.stringify(sampleManifest), "utf-8");

    const result = await loadTemplateManifest(filePath);

    expect(result).toEqual(sampleManifest);
    expect(result.layouts).toHaveLength(3);
  });

  it("throws descriptive error when file does not exist", async () => {
    const missingPath = join(tmpDir, "nonexistent.json");

    await expect(loadTemplateManifest(missingPath)).rejects.toThrow(
      `Template manifest not found: ${missingPath}`,
    );
  });

  it("throws on invalid JSON content", async () => {
    const filePath = join(tmpDir, "bad-json.json");
    await writeFile(filePath, "{ not valid json }", "utf-8");

    await expect(loadTemplateManifest(filePath)).rejects.toThrow(SyntaxError);
  });

  it("throws ZodError when JSON is valid but schema is invalid", async () => {
    const filePath = join(tmpDir, "bad-schema.json");
    await writeFile(filePath, JSON.stringify({ layouts: [] }), "utf-8");

    await expect(loadTemplateManifest(filePath)).rejects.toThrow(ZodError);
  });

  it("throws ZodError when layout is missing required fields", async () => {
    const filePath = join(tmpDir, "missing-fields.json");
    const incomplete = {
      layouts: [{ id: "only-id" }],
    };
    await writeFile(filePath, JSON.stringify(incomplete), "utf-8");

    await expect(loadTemplateManifest(filePath)).rejects.toThrow(ZodError);
  });
});

describe("getLayoutById", () => {
  it("returns the matching layout when id exists", () => {
    const result = getLayoutById(sampleManifest, "content-with-image");

    expect(result).toBeDefined();
    expect(result!.id).toBe("content-with-image");
    expect(result!.name).toBe("Content + Image");
  });

  it("returns undefined when id does not exist", () => {
    const result = getLayoutById(sampleManifest, "nonexistent-layout");

    expect(result).toBeUndefined();
  });
});

describe("getLayoutsForIntent", () => {
  it("returns layouts matching the given intent", () => {
    const result = getLayoutsForIntent(sampleManifest, "introduction");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("title-slide");
  });

  it("returns multiple layouts when several match the intent", () => {
    const manifest: TemplateManifest = {
      layouts: [
        { ...sampleManifest.layouts[0], bestFor: ["shared-intent"] },
        { ...sampleManifest.layouts[1], bestFor: ["shared-intent", "other"] },
        { ...sampleManifest.layouts[2], bestFor: ["different"] },
      ],
    };

    const result = getLayoutsForIntent(manifest, "shared-intent");

    expect(result).toHaveLength(2);
  });

  it("returns empty array when no layouts match the intent", () => {
    const result = getLayoutsForIntent(sampleManifest, "nonexistent-intent");

    expect(result).toEqual([]);
  });
});

describe("getAllLayouts", () => {
  it("returns all layouts from the manifest", () => {
    const result = getAllLayouts(sampleManifest);

    expect(result).toHaveLength(3);
    expect(result).toEqual(sampleManifest.layouts);
  });

  it("returns single-element array for single-layout manifest", () => {
    const single: TemplateManifest = {
      layouts: [sampleManifest.layouts[0]],
    };

    const result = getAllLayouts(single);

    expect(result).toHaveLength(1);
  });
});
