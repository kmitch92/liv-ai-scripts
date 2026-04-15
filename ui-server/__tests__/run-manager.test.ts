import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { RunManager, type RunEvent } from "../run-manager.js";

let tmpRuns: string;
let tmpConfigs: string;

beforeEach(() => {
  tmpRuns = mkdtempSync(resolve(tmpdir(), "livai-rm-runs-"));
  tmpConfigs = mkdtempSync(resolve(tmpdir(), "livai-rm-cfgs-"));
  // Seed a fake config so RunManager.start() can snapshot it.
  writeFileSync(resolve(tmpConfigs, "default.json"), "{}", "utf8");
});

afterEach(() => {
  rmSync(tmpRuns, { recursive: true, force: true });
  rmSync(tmpConfigs, { recursive: true, force: true });
});

function makeManager() {
  return new RunManager({
    repoRoot: process.cwd(),
    runsDir: tmpRuns,
    configsDir: tmpConfigs,
    buildCommand: () => ({
      cmd: "node",
      args: [
        "-e",
        "process.stdout.write('hi\\n'); process.stderr.write('warn\\n'); setTimeout(()=>process.exit(0),10);",
      ],
    }),
  });
}

function waitForExit(rm: RunManager, runId: string): Promise<RunEvent[]> {
  return new Promise((resolve_) => {
    const events: RunEvent[] = [];
    const sub = rm.subscribe(runId, (ev) => {
      events.push(ev);
      if (ev.type === "exit") {
        sub?.unsubscribe();
        resolve_(events);
      }
    });
    if (!sub) resolve_(events);
  });
}

describe("RunManager", () => {
  it("emits stdout/stderr/exit events and persists log", async () => {
    const rm = makeManager();
    const { runId } = rm.start({ topic: "t", configName: "default" });
    const events = await waitForExit(rm, runId);
    const stdoutLines = events.filter((e) => e.type === "stdout").map((e) => e.line);
    const stderrLines = events.filter((e) => e.type === "stderr").map((e) => e.line);
    const exit = events.find((e) => e.type === "exit");
    expect(stdoutLines).toContain("hi");
    expect(stderrLines).toContain("warn");
    expect(exit?.code).toBe(0);

    // Meta persisted with final status.
    const run = rm.getRun(runId);
    expect(run?.status).toBe("success");
    expect(run?.log).toContain("hi");
    expect(run?.log).toContain("[stderr] warn");
  });

  it("enforces singleton lock — second concurrent start is rejected", async () => {
    const rm = makeManager();
    const first = rm.start({ topic: "t", configName: "default" });
    expect(rm.isActive()).toBe(true);
    expect(() => rm.start({ topic: "t2", configName: "default" })).toThrow(/already active/i);
    await waitForExit(rm, first.runId);
    expect(rm.isActive()).toBe(false);
  });

  it("abort sends SIGTERM and marks status aborted", async () => {
    const rm = new RunManager({
      repoRoot: process.cwd(),
      runsDir: tmpRuns,
      configsDir: tmpConfigs,
      buildCommand: () => ({
        cmd: "node",
        args: ["-e", "setInterval(()=>{}, 1000);"],
      }),
    });
    const { runId } = rm.start({ topic: "t", configName: "default" });
    // Give the child a moment to spawn.
    await new Promise((r) => setTimeout(r, 50));
    expect(rm.abort(runId)).toBe(true);
    await waitForExit(rm, runId);
    const run = rm.getRun(runId);
    expect(run?.status).toBe("aborted");
  });
});
