import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { buildServer } from "../index.js";
import { REPO_ROOT } from "../paths.js";
import { RunManager } from "../run-manager.js";

let tmpConfigs: string;
let tmpRuns: string;

beforeEach(() => {
  tmpConfigs = mkdtempSync(resolve(tmpdir(), "livai-configs-"));
  tmpRuns = mkdtempSync(resolve(tmpdir(), "livai-runs-"));
  const root = readFileSync(resolve(REPO_ROOT, "config.json"), "utf8");
  writeFileSync(resolve(tmpConfigs, "default.json"), root, "utf8");
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

describe("configs CRUD", () => {
  it("round-trips create → read → update → delete", async () => {
    const app = await makeApp();

    // List initially.
    let res = await app.inject({ method: "GET", url: "/api/configs" });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((x: any) => x.name)).toContain("default");

    // Create from default.
    res = await app.inject({
      method: "POST",
      url: "/api/configs",
      payload: { name: "experiment-1", from: "default" },
    });
    expect(res.statusCode).toBe(201);
    expect(existsSync(resolve(tmpConfigs, "experiment-1.json"))).toBe(true);

    // Read.
    res = await app.inject({ method: "GET", url: "/api/configs/experiment-1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.script).toBeDefined();

    // Update.
    body.script.durationMinutes = 10;
    res = await app.inject({
      method: "PUT",
      url: "/api/configs/experiment-1",
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const disk = JSON.parse(
      readFileSync(resolve(tmpConfigs, "experiment-1.json"), "utf8"),
    );
    expect(disk.script.durationMinutes).toBe(10);

    // Invalid update (bad schema) rejected.
    res = await app.inject({
      method: "PUT",
      url: "/api/configs/experiment-1",
      payload: { not: "a config" },
    });
    expect(res.statusCode).toBe(400);

    // Delete.
    res = await app.inject({ method: "DELETE", url: "/api/configs/experiment-1" });
    expect(res.statusCode).toBe(200);
    expect(existsSync(resolve(tmpConfigs, "experiment-1.json"))).toBe(false);

    await app.close();
  });

  it("refuses to delete default", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "DELETE", url: "/api/configs/default" });
    expect(res.statusCode).toBe(400);
    expect(existsSync(resolve(tmpConfigs, "default.json"))).toBe(true);
    await app.close();
  });

  it("rejects invalid preset names", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/configs",
      payload: { name: "bad name!" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
