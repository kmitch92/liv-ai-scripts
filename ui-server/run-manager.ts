import { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface RunEvent {
  type: "stdout" | "stderr" | "exit";
  line?: string;
  code?: number;
  timestamp: number;
}

export interface RunMeta {
  runId: string;
  configName: string;
  topic: string;
  output?: string;
  startedAt: number;
  endedAt?: number;
  exitCode?: number;
  status: "running" | "success" | "failed" | "aborted";
  archivePath?: string;
}

export interface RunManagerOptions {
  repoRoot: string;
  runsDir: string;
  configsDir: string;
  /** Override spawn for testing. */
  spawnFn?: typeof spawn;
  /** Command builder override for testing. */
  buildCommand?: (args: { topic: string; configName: string; output?: string; configsDir: string }) => {
    cmd: string;
    args: string[];
  };
}

const RING_MAX = 5000;

export class RunManager {
  private active: {
    runId: string;
    child: ChildProcess;
    meta: RunMeta;
    buffer: RunEvent[];
    emitter: EventEmitter;
    logPath: string;
    metaPath: string;
  } | null = null;

  private readonly opts: RunManagerOptions;

  constructor(opts: RunManagerOptions) {
    this.opts = opts;
    mkdirSync(opts.runsDir, { recursive: true });
  }

  isActive(): boolean {
    return this.active !== null;
  }

  activeRunId(): string | null {
    return this.active?.runId ?? null;
  }

  private generateRunId(): string {
    const d = new Date();
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    return (
      `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
      `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}` +
      `-${pad(d.getUTCMilliseconds(), 3)}`
    );
  }

  start(args: { topic: string; configName: string; output?: string }): { runId: string } {
    if (this.active) {
      throw Object.assign(new Error("A run is already active"), { statusCode: 409 });
    }
    const runId = this.generateRunId();
    const logPath = resolve(this.opts.runsDir, `${runId}.log`);
    const metaPath = resolve(this.opts.runsDir, `${runId}.meta.json`);

    const configPath = resolve(this.opts.configsDir, `${args.configName}.json`);
    let configSnapshot: unknown = null;
    if (existsSync(configPath)) {
      try {
        configSnapshot = JSON.parse(readFileSync(configPath, "utf8"));
      } catch {
        configSnapshot = null;
      }
    }

    const meta: RunMeta = {
      runId,
      configName: args.configName,
      topic: args.topic,
      output: args.output,
      startedAt: Date.now(),
      status: "running",
    };

    const fullMeta = { ...meta, configSnapshot };
    writeFileSync(metaPath, JSON.stringify(fullMeta, null, 2), "utf8");
    writeFileSync(logPath, "", "utf8");

    const build = this.opts.buildCommand ?? defaultBuildCommand;
    const { cmd, args: cmdArgs } = build({ ...args, configsDir: this.opts.configsDir });
    const spawnFn = this.opts.spawnFn ?? spawn;
    const child = spawnFn(cmd, cmdArgs, {
      cwd: this.opts.repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const emitter = new EventEmitter();
    emitter.setMaxListeners(100);
    const buffer: RunEvent[] = [];

    this.active = { runId, child, meta, buffer, emitter, logPath, metaPath };

    const pushEvent = (ev: RunEvent) => {
      buffer.push(ev);
      if (buffer.length > RING_MAX) buffer.splice(0, buffer.length - RING_MAX);
      emitter.emit("event", ev);
      // Persist stdout/stderr lines.
      if (ev.type !== "exit" && ev.line !== undefined) {
        void appendFile(logPath, `${ev.type === "stderr" ? "[stderr] " : ""}${ev.line}\n`, "utf8").catch(() => {});
      }
    };

    const makeLineHandler = (stream: "stdout" | "stderr") => {
      let partial = "";
      return (chunk: Buffer) => {
        partial += chunk.toString("utf8");
        const lines = partial.split(/\r?\n/);
        partial = lines.pop() ?? "";
        for (const line of lines) {
          pushEvent({ type: stream, line, timestamp: Date.now() });
        }
      };
    };

    child.stdout?.on("data", makeLineHandler("stdout"));
    child.stderr?.on("data", makeLineHandler("stderr"));

    const finalize = (code: number | null, signal: NodeJS.Signals | null) => {
      const exitCode = code ?? (signal ? 1 : 0);
      pushEvent({ type: "exit", code: exitCode, timestamp: Date.now() });
      const status: RunMeta["status"] = signal === "SIGTERM" ? "aborted" : exitCode === 0 ? "success" : "failed";
      const endedMeta: RunMeta & { configSnapshot: unknown } = {
        ...meta,
        endedAt: Date.now(),
        exitCode,
        status,
        configSnapshot,
      };
      try {
        writeFileSync(metaPath, JSON.stringify(endedMeta, null, 2), "utf8");
      } catch {}
      this.active = null;
    };

    child.on("exit", finalize);
    child.on("error", (err) => {
      pushEvent({ type: "stderr", line: `spawn error: ${err.message}`, timestamp: Date.now() });
      finalize(1, null);
    });

    return { runId };
  }

  abort(runId: string): boolean {
    if (!this.active || this.active.runId !== runId) return false;
    this.active.child.kill("SIGTERM");
    return true;
  }

  /** Subscribe to live events for the active run. Returns unsubscribe fn + replay buffer. */
  subscribe(
    runId: string,
    onEvent: (ev: RunEvent) => void,
  ): { replay: RunEvent[]; unsubscribe: () => void; isActive: boolean } | null {
    if (this.active && this.active.runId === runId) {
      const listener = (ev: RunEvent) => onEvent(ev);
      this.active.emitter.on("event", listener);
      const replay = [...this.active.buffer];
      const emitter = this.active.emitter;
      return {
        replay,
        unsubscribe: () => emitter.off("event", listener),
        isActive: true,
      };
    }
    // Completed run — replay from log if exists.
    const logPath = resolve(this.opts.runsDir, `${runId}.log`);
    if (!existsSync(logPath)) return null;
    const replay = readLogAsEvents(logPath);
    // Append a synthetic exit event using meta if available.
    const metaPath = resolve(this.opts.runsDir, `${runId}.meta.json`);
    if (existsSync(metaPath)) {
      try {
        const parsed = JSON.parse(readFileSync(metaPath, "utf8")) as RunMeta;
        if (typeof parsed.exitCode === "number") {
          replay.push({
            type: "exit",
            code: parsed.exitCode,
            timestamp: parsed.endedAt ?? Date.now(),
          });
        }
      } catch {}
    }
    return {
      replay,
      unsubscribe: () => {},
      isActive: false,
    };
  }

  listRuns(): RunMeta[] {
    if (!existsSync(this.opts.runsDir)) return [];
    const files = readdirSync(this.opts.runsDir).filter((f) => f.endsWith(".meta.json"));
    const out: RunMeta[] = [];
    for (const f of files) {
      try {
        const parsed = JSON.parse(readFileSync(resolve(this.opts.runsDir, f), "utf8"));
        out.push(parsed);
      } catch {}
    }
    return out.sort((a, b) => b.startedAt - a.startedAt);
  }

  getRun(runId: string): (RunMeta & { log: string }) | null {
    const metaPath = resolve(this.opts.runsDir, `${runId}.meta.json`);
    if (!existsSync(metaPath)) return null;
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as RunMeta;
    const logPath = resolve(this.opts.runsDir, `${runId}.log`);
    const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    return { ...meta, log };
  }
}

function defaultBuildCommand(args: {
  topic: string;
  configName: string;
  output?: string;
  configsDir: string;
}): { cmd: string; args: string[] } {
  const userArgs = ["-t", args.topic, "-c", resolve(args.configsDir, `${args.configName}.json`)];
  if (args.output) userArgs.push("-o", args.output);

  const bundle = process.env.LIVAI_PIPELINE_BUNDLE;
  if (bundle) {
    // Packaged Electron: run the bundle with the current Node binary
    // (which is Electron itself with ELECTRON_RUN_AS_NODE=1 inherited from parent env).
    return { cmd: process.execPath, args: [bundle, ...userArgs] };
  }
  return { cmd: "npx", args: ["tsx", "src/index.ts", ...userArgs] };
}

function readLogAsEvents(logPath: string): RunEvent[] {
  const raw = readFileSync(logPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const out: RunEvent[] = [];
  for (const line of lines) {
    if (line === "" && out.length === lines.length - 1) continue;
    if (line.startsWith("[stderr] ")) {
      out.push({ type: "stderr", line: line.slice("[stderr] ".length), timestamp: 0 });
    } else {
      out.push({ type: "stdout", line, timestamp: 0 });
    }
  }
  return out;
}
