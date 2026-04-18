import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import {
  generateWithLibreOffice,
  concatenateAudio,
  writeConcatFile,
  runFfmpeg,
} from "../steps/06-video-assemble.js";

const execFile = promisify(execFileCb);

export interface RecutOptions {
  pptxPath: string;
  audioPaths: string[];
  actualDurations: number[];
  tempDir: string;
  slideCount: number;
}

export interface RecutResult {
  videoPath: string;
  silentVideoPath: string;
}

export async function recutVideo(options: RecutOptions): Promise<RecutResult> {
  const { pptxPath, audioPaths, actualDurations, tempDir, slideCount } = options;

  const videoDir = path.join(tempDir, "video");
  const slidesDir = path.join(videoDir, "slides");
  await mkdir(slidesDir, { recursive: true });

  // 1. PPTX -> PDF -> PNG via LibreOffice
  const slideImages = await generateWithLibreOffice(pptxPath, slidesDir, slideCount);

  // 2. Concatenate per-slide audio into a single track
  const concatAudioPath = path.join(videoDir, "audio-concat.mp3");
  await concatenateAudio(audioPaths, concatAudioPath, videoDir);

  // 3. Build ffmpeg concat demuxer file
  const concatFilePath = path.join(videoDir, "concat.txt");
  await writeConcatFile(concatFilePath, slideImages, actualDurations);

  // 4. Render video with audio
  const videoPath = path.join(tempDir, "video.mp4");
  await runFfmpeg(concatFilePath, concatAudioPath, videoPath);

  // 5. Strip audio for silent variant
  const silentVideoPath = path.join(tempDir, "video-silent.mp4");
  await execFile("ffmpeg", ["-y", "-i", videoPath, "-c:v", "copy", "-an", silentVideoPath], {
    timeout: 300_000,
  });

  return { videoPath, silentVideoPath };
}
