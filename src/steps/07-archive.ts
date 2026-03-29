import path from "node:path";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import archiver from "archiver";
import type { Presentation } from "../types/index.js";
import { startStep, succeedStep } from "../lib/logger.js";
import { sanitizeTopic } from "../lib/sanitize-topic.js";

interface ArchiveOptions {
  presentation: Presentation;
  pptxPath: string;
  videoPath: string;
  audioPaths: string[];
  topic: string;
  outputPath?: string;
}

export async function createArchive(options: ArchiveOptions): Promise<string> {
  const { presentation, pptxPath, videoPath, audioPaths, topic, outputPath } =
    options;

  startStep("Creating archive...");

  const resolvedOutput = outputPath ?? buildDefaultOutputPath(topic);
  const outputDir = path.dirname(resolvedOutput);
  await mkdir(outputDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(resolvedOutput);
    const archive = archiver("zip", { zlib: { level: 5 } });

    output.on("close", () => resolve());
    archive.on("error", (err: Error) => reject(err));

    archive.pipe(output);

    // PPTX
    archive.file(pptxPath, { name: "presentation.pptx" });

    // Video
    archive.file(videoPath, { name: "video.mp4" });

    // Script JSON
    archive.append(JSON.stringify(presentation, null, 2), {
      name: "script.json",
    });

    // Script TXT (human-readable)
    archive.append(formatPresentationText(presentation), {
      name: "script.txt",
    });

    // Audio files
    for (let i = 0; i < audioPaths.length; i++) {
      const filename = path.basename(audioPaths[i]);
      archive.file(audioPaths[i], { name: `audio/${filename}` });
    }

    void archive.finalize();
  });

  succeedStep(`Archive created: ${resolvedOutput}`);
  return resolvedOutput;
}

function formatPresentationText(presentation: Presentation): string {
  const lines: string[] = [`# ${presentation.title}`, ""];

  for (const slide of presentation.slides) {
    lines.push(`## ${slide.slideTitle}`, "", slide.narration, "");
  }

  return lines.join("\n");
}

function buildDefaultOutputPath(topic: string): string {
  const sanitized = sanitizeTopic(topic);

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");

  return path.resolve("output", sanitized, timestamp, `${sanitized}.zip`);
}
