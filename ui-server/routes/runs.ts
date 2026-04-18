import type { FastifyInstance } from "fastify";
import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { z } from "zod";
import type { Paths } from "../paths.js";
import type { RunManager } from "../run-manager.js";

export async function runsRoutes(app: FastifyInstance, paths: Paths, runs: RunManager) {
  const PostBody = z.object({
    configName: z.string().min(1),
    topic: z.string().min(1),
    output: z.string().optional(),
  });

  app.post("/api/runs", async (req, reply) => {
    const parsed = PostBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const { configName, topic, output } = parsed.data;
    const cfg = resolve(paths.configsDir, `${configName}.json`);
    if (!existsSync(cfg)) return reply.code(400).send({ error: `Config preset not found: ${configName}` });
    if (runs.isActive()) {
      return reply.code(409).send({ error: "A run is already active", activeRunId: runs.activeRunId() });
    }
    try {
      const { runId } = runs.start({ configName, topic, output });
      return reply.code(201).send({ runId });
    } catch (err: any) {
      if (err?.statusCode === 409) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });

  app.get("/api/runs", async () => runs.listRuns());

  app.get("/api/runs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = runs.getRun(id);
    if (!run) return reply.code(404).send({ error: "Not found" });
    return run;
  });

  app.get("/api/runs/:id/events", async (req, reply) => {
    const { id } = req.params as { id: string };

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const writeEvent = (ev: unknown) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
      } catch {}
    };

    const sub = runs.subscribe(id, (ev) => writeEvent(ev));
    if (!sub) {
      reply.raw.end();
      return reply;
    }

    // Replay buffer.
    for (const ev of sub.replay) writeEvent(ev);

    if (!sub.isActive) {
      reply.raw.end();
      return reply;
    }

    req.raw.on("close", () => {
      sub.unsubscribe();
      try { reply.raw.end(); } catch {}
    });

    return reply;
  });

  app.post("/api/runs/:id/abort", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = runs.abort(id);
    if (!ok) {
      if (runs.activeRunId() === null) return reply.code(409).send({ error: "No active run" });
      return reply.code(404).send({ error: "Run id does not match active run" });
    }
    return { ok: true };
  });

  app.get("/api/runs/:id/download", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = runs.getRun(id);
    if (!run) return reply.code(404).send({ error: "Not found" });
    if (!run.archivePath) return reply.code(404).send({ error: "No archive available" });
    const absPath = resolve(paths.repoRoot, run.archivePath);
    if (!existsSync(absPath)) return reply.code(404).send({ error: "Archive file not found on disk" });
    const filename = basename(absPath);
    void reply
      .header("Content-Type", "application/zip")
      .header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(createReadStream(absPath));
  });

  app.post("/api/runs/:id/reveal", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = runs.getRun(id);
    if (!run) return reply.code(404).send({ error: "Not found" });
    const target = run.archivePath
      ? resolve(paths.repoRoot, run.archivePath)
      : resolve(paths.repoRoot, "output");
    try {
      const child = spawn("xdg-open", [target], { detached: true, stdio: "ignore" });
      child.unref();
      return { ok: true, target };
    } catch {
      return reply.code(200).send({ ok: false, reason: "xdg-open unavailable" });
    }
  });
}
