import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import ffmpeg from "fluent-ffmpeg";
import type { Config, Slide } from "../types/index.js";
import { retry } from "../lib/retry.js";
import { startStep, succeedStep, warn } from "../lib/logger.js";

interface TtsOptions {
  slides: Slide[];
  tempDir: string;
  elevenlabs: Config["elevenlabs"];
}

interface TtsResult {
  audioPaths: string[];
  actualDurations: number[];
}

export async function generateTts(options: TtsOptions): Promise<TtsResult> {
  const { slides, tempDir, elevenlabs } = options;
  const audioDir = path.join(tempDir, "audio");
  await mkdir(audioDir, { recursive: true });

  const audioPaths: string[] = [];
  const actualDurations: number[] = [];

  // Process sequentially to respect ElevenLabs rate limits
  for (let i = 0; i < slides.length; i++) {
    startStep(`Generating audio (${i + 1}/${slides.length})...`);

    const slide = slides[i];
    const outputPath = path.join(audioDir, `slide-${i}.mp3`);

    try {
      await retry(
        () => synthesizeSpeech(slide.narration, elevenlabs, outputPath),
        {
          maxAttempts: 3,
          delayMs: 1000,
          backoffMultiplier: 2,
          retryOn: (err) => {
            if (err instanceof ElevenLabsError) {
              return err.status === 429;
            }
            return false;
          },
        },
      );
    } catch {
      warn(
        `TTS failed for slide ${i} after retries, generating silent fallback`,
      );
      await generateSilentAudio(outputPath, slide.durationSeconds);
    }

    const duration = await getAudioDuration(outputPath);
    audioPaths.push(outputPath);
    actualDurations.push(duration);
  }

  succeedStep(`Generated ${slides.length} audio files`);
  return { audioPaths, actualDurations };
}

class ElevenLabsError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ElevenLabsError";
  }
}

async function synthesizeSpeech(
  text: string,
  config: Config["elevenlabs"],
  outputPath: string,
): Promise<void> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY not set");
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: config.modelId,
      voice_settings: {
        stability: config.stability,
        similarity_boost: config.similarityBoost,
        style: config.style,
        use_speaker_boost: config.useSpeakerBoost,
      },
      ...(config.speed !== 1 ? { speed: config.speed } : {}),
    }),
  });

  if (!response.ok) {
    throw new ElevenLabsError(
      response.status,
      `ElevenLabs API error: ${response.status}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  await writeFile(outputPath, Buffer.from(arrayBuffer));
}

function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration ?? 0);
    });
  });
}

function generateSilentAudio(
  outputPath: string,
  durationSeconds: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input("anullsrc=r=44100:cl=mono")
      .inputFormat("lavfi")
      .duration(durationSeconds)
      .audioCodec("libmp3lame")
      .audioQuality(9)
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(err))
      .run();
  });
}
