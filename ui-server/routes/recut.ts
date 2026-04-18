import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import {
  createReadStream,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { basename, resolve, join } from "node:path";
import type { Paths } from "../paths.js";
import type { RunManager } from "../run-manager.js";
import { recutVideo } from "../../src/lib/recut.js";

const execFile = promisify(execFileCb);

/**
 * Probe duration (seconds) of an audio file via ffprobe.
 */
async function probeDuration(filePath: string): Promise<number> {
  const { stdout } = await execFile("ffprobe", [
    "-v", "quiet",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    filePath,
  ]);
  const secs = parseFloat(stdout.trim());
  if (Number.isNaN(secs)) throw new Error(`Could not probe duration: ${filePath}`);
  return secs;
}

export async function recutRoutes(
  app: FastifyInstance,
  paths: Paths,
  runs: RunManager,
) {
  // Register multipart plugin (scoped to this encapsulation context).
  await app.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100 MB max PPTX
    },
  });

  /**
   * POST /api/runs/:id/recut
   *
   * Accepts a multipart upload with field name `pptx`.
   * Extracts audio from the original archive, re-renders the video
   * using the uploaded PPTX, and stores results alongside the run.
   */
  app.post("/api/runs/:id/recut", async (req, reply) => {
    const { id } = req.params as { id: string };

    // 1. Validate run exists and has an archive
    const run = runs.getRun(id);
    if (!run) return reply.code(404).send({ error: "Run not found" });
    if (run.status !== "success") {
      return reply.code(400).send({ error: "Run did not complete successfully" });
    }
    if (!run.archivePath) {
      return reply.code(400).send({ error: "Run has no archive" });
    }

    const archiveAbs = resolve(paths.repoRoot, run.archivePath);
    if (!existsSync(archiveAbs)) {
      return reply.code(400).send({ error: "Archive file not found on disk" });
    }

    // 2. Accept uploaded PPTX
    const file = await req.file();
    if (!file || file.fieldname !== "pptx") {
      return reply.code(400).send({ error: "Missing pptx file upload" });
    }

    // 3. Create temp working directory
    const recutDir = resolve(paths.runsDir, id, "recut");
    const extractDir = resolve(recutDir, "extract");
    const tempDir = resolve(recutDir, "work");
    mkdirSync(extractDir, { recursive: true });
    mkdirSync(tempDir, { recursive: true });

    // 4. Save uploaded PPTX
    const pptxPath = resolve(tempDir, "presentation.pptx");
    const chunks: Buffer[] = [];
    for await (const chunk of file.file) {
      chunks.push(chunk);
    }
    await writeFile(pptxPath, Buffer.concat(chunks));

    // 5. Extract archive
    await execFile("unzip", ["-o", "-q", archiveAbs, "-d", extractDir]);

    // 6. Gather audio files sorted numerically
    const audioDir = resolve(extractDir, "audio");
    if (!existsSync(audioDir)) {
      return reply.code(400).send({ error: "Original archive has no audio/ directory" });
    }
    const audioFiles = (await readdir(audioDir))
      .filter((f) => f.endsWith(".mp3"))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (audioFiles.length === 0) {
      return reply.code(400).send({ error: "No audio files found in archive" });
    }
    const audioPaths = audioFiles.map((f) => resolve(audioDir, f));

    // 7. Probe durations from audio files
    const actualDurations = await Promise.all(audioPaths.map(probeDuration));

    // 8. Read slide count from script.json
    const scriptPath = resolve(extractDir, "script.json");
    let slideCount = audioPaths.length; // fallback
    if (existsSync(scriptPath)) {
      try {
        const script = JSON.parse(readFileSync(scriptPath, "utf8"));
        if (Array.isArray(script.slides)) {
          slideCount = script.slides.length;
        }
      } catch {
        // keep fallback
      }
    }

    // 9. Run recut
    try {
      const result = await recutVideo({
        pptxPath,
        audioPaths,
        actualDurations,
        tempDir,
        slideCount,
      });

      // 10. Copy outputs to persistent location
      const videoOut = resolve(recutDir, "video.mp4");
      const silentOut = resolve(recutDir, "video-silent.mp4");
      await execFile("cp", [result.videoPath, videoOut]);
      await execFile("cp", [result.silentVideoPath, silentOut]);

      // 11. Update run metadata with recut paths
      const metaPath = resolve(paths.runsDir, `${id}.meta.json`);
      if (existsSync(metaPath)) {
        try {
          const meta = JSON.parse(readFileSync(metaPath, "utf8"));
          meta.recutPaths = {
            video: videoOut,
            silentVideo: silentOut,
          };
          writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
        } catch {
          // non-fatal
        }
      }

      return { ok: true, recutId: id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: `Recut failed: ${msg}` });
    }
  });

  /**
   * GET /api/runs/:id/recut/download?type=video|silent
   *
   * Downloads the recut video file.
   */
  app.get("/api/runs/:id/recut/download", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { type } = req.query as { type?: string };

    const recutDir = resolve(paths.runsDir, id, "recut");
    const filename = type === "silent" ? "video-silent.mp4" : "video.mp4";
    const filePath = resolve(recutDir, filename);

    if (!existsSync(filePath)) {
      return reply.code(404).send({ error: "Recut video not found" });
    }

    void reply
      .header("Content-Type", "video/mp4")
      .header("Content-Disposition", `attachment; filename="${id}-recut-${filename}"`);
    return reply.send(createReadStream(filePath));
  });
}
