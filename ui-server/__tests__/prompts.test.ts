import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { buildServer } from "../index.js";
import { REPO_ROOT } from "../paths.js";
import { PROMPT_REGISTRY } from "../prompt-registry.js";
import { RunManager } from "../run-manager.js";

let tmpConfigs: string;
let tmpRuns: string;

function seedDefault() {
  const root = JSON.parse(readFileSync(resolve(REPO_ROOT, "config.json"), "utf8"));
  writeFileSync(resolve(tmpConfigs, "default.json"), JSON.stringify(root, null, 2), "utf8");
}

beforeEach(() => {
  tmpConfigs = mkdtempSync(resolve(tmpdir(), "livai-configs-"));
  tmpRuns = mkdtempSync(resolve(tmpdir(), "livai-runs-"));
  seedDefault();
});

afterEach(() => {
  rmSync(tmpConfigs, { recursive: true, force: true });
  rmSync(tmpRuns, { recursive: true, force: true });
});

function makeApp() {
  const paths = {
    repoRoot: REPO_ROOT,
    promptsDir: resolve(REPO_ROOT, "assets/prompts"),
    configsDir: tmpConfigs,
    runsDir: tmpRuns,
  };
  const runManager = new RunManager({
    repoRoot: paths.repoRoot,
    runsDir: paths.runsDir,
    configsDir: paths.configsDir,
  });
  return buildServer({ paths, runManager });
}

describe("GET /api/prompts", () => {
  it("returns every registry entry with non-empty purpose and resolved content", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/prompts" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(PROMPT_REGISTRY.length);
    for (const entry of body) {
      expect(entry.purpose.trim().length).toBeGreaterThan(0);
      expect(typeof entry.content).toBe("string");
      if (entry.source.kind === "file") {
        expect(entry.content.length).toBeGreaterThan(0);
      }
    }
    await app.close();
  });
});

describe("PUT /api/prompts/:id (config-sourced)", () => {
  it("round-trips a speakerIdentity change into the default preset", async () => {
    const app = await makeApp();
    const novel = "test-speaker-" + Date.now();
    const res = await app.inject({
      method: "PUT",
      url: "/api/prompts/script.speakerIdentity",
      payload: { content: novel },
    });
    expect(res.statusCode).toBe(200);
    const disk = JSON.parse(readFileSync(resolve(tmpConfigs, "default.json"), "utf8"));
    expect(disk.script.speakerIdentity).toBe(novel);
    await app.close();
  });

  it("rejects an invalid config write without corrupting the file on disk", async () => {
    const app = await makeApp();
    const before = readFileSync(resolve(tmpConfigs, "default.json"), "utf8");

    // durationMinutes is a number — setting it via speakerIdentity is fine, but we
    // need to trigger schema failure. Instead, monkey the preset to have a broken
    // shape such that a patched value will still fail. Easier: write a bogus preset
    // and attempt patching it.
    const brokenPath = resolve(tmpConfigs, "broken.json");
    writeFileSync(brokenPath, JSON.stringify({ not: "a valid config" }), "utf8");

    const res = await app.inject({
      method: "PUT",
      url: "/api/prompts/script.speakerIdentity",
      payload: { content: "x", configName: "broken" },
    });
    expect(res.statusCode).toBe(400);
    // Original default preset untouched.
    expect(readFileSync(resolve(tmpConfigs, "default.json"), "utf8")).toBe(before);
    // Broken preset also untouched.
    expect(readFileSync(brokenPath, "utf8")).toBe(
      JSON.stringify({ not: "a valid config" }),
    );
    await app.close();
  });
});
