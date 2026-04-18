import type { FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { Paths } from "../paths.js";

const execFileAsync = promisify(execFile);

/* ------------------------------------------------------------------ */
/*  Env-key mapping                                                    */
/* ------------------------------------------------------------------ */

const ENV_KEY_MAP: Record<string, string> = {
  anthropicApiKey: "ANTHROPIC_API_KEY",
  openrouterApiKey: "OPENROUTER_API_KEY",
  elevenlabsApiKey: "ELEVENLABS_API_KEY",
  unsplashAccessKey: "UNSPLASH_ACCESS_KEY",
};

/* ------------------------------------------------------------------ */
/*  Dependency checking (mirrors electron/deps.ts without importing)   */
/* ------------------------------------------------------------------ */

async function commandExists(cmd: string): Promise<boolean> {
  try {
    const which = process.platform === "win32" ? "where" : "which";
    await execFileAsync(which, [cmd]);
    return true;
  } catch {
    return false;
  }
}

export interface DepCheckResult {
  ffmpeg: boolean;
  ffprobe: boolean;
  libreoffice: boolean;
}

async function checkDeps(): Promise<DepCheckResult> {
  const libreofficeBin = process.platform === "win32" ? "soffice" : "libreoffice";
  const [ffmpeg, ffprobe, libreoffice] = await Promise.all([
    commandExists("ffmpeg"),
    commandExists("ffprobe"),
    commandExists(libreofficeBin),
  ]);
  return { ffmpeg, ffprobe, libreoffice };
}

/* ------------------------------------------------------------------ */
/*  LibreOffice install hints                                          */
/* ------------------------------------------------------------------ */

function libreOfficeHint(): { url: string; hint: string } {
  const url = "https://www.libreoffice.org/download/download-libreoffice/";
  switch (process.platform) {
    case "darwin":
      return { url, hint: "Run: brew install --cask libreoffice" };
    case "win32":
      return { url, hint: "Download installer from the URL above" };
    default:
      return { url, hint: "Run: sudo apt install libreoffice" };
  }
}

/* ------------------------------------------------------------------ */
/*  .env file helpers                                                  */
/* ------------------------------------------------------------------ */

function dotenvPath(paths: Paths): string {
  return resolve(paths.repoRoot, ".env");
}

/** Read .env into a Map, preserving insertion order. */
function readDotenv(filePath: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(filePath)) return map;
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    map.set(key, val);
  }
  return map;
}

function writeDotenv(filePath: string, entries: Map<string, string>): void {
  const lines: string[] = [];
  for (const [k, v] of entries) {
    lines.push(`${k}=${v}`);
  }
  writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
}

/* ------------------------------------------------------------------ */
/*  Zod schema for PUT /api/settings/keys                              */
/* ------------------------------------------------------------------ */

const PutKeysBody = z
  .object({
    anthropicApiKey: z.string().optional(),
    openrouterApiKey: z.string().optional(),
    elevenlabsApiKey: z.string().optional(),
    unsplashAccessKey: z.string().optional(),
  })
  .strict();

/* ------------------------------------------------------------------ */
/*  Routes                                                             */
/* ------------------------------------------------------------------ */

export async function settingsRoutes(app: FastifyInstance, paths: Paths) {
  /** GET /api/settings — full status snapshot */
  app.get("/api/settings", async () => {
    const keys: Record<string, boolean> = {};
    for (const [camel, envKey] of Object.entries(ENV_KEY_MAP)) {
      keys[camel] = Boolean(process.env[envKey]);
    }

    const deps = await checkDeps();

    const { url, hint } = libreOfficeHint();

    return {
      keys,
      deps,
      outputPath: paths.outputDir,
      libreOfficeInstallUrl: url,
      libreOfficeInstallHint: hint,
      isElectron: Boolean(process.env.ELECTRON_RUN_AS_NODE),
    };
  });

  /** GET /api/settings/deps — dependency status only (re-check) */
  app.get("/api/settings/deps", async () => {
    return checkDeps();
  });

  /** PUT /api/settings/keys — set API keys */
  app.put("/api/settings/keys", async (req, reply) => {
    const parsed = PutKeysBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid body", details: parsed.error.flatten() });
    }

    const incoming = parsed.data;
    const envFile = dotenvPath(paths);
    const dotenv = readDotenv(envFile);
    let changed = false;

    for (const [camel, value] of Object.entries(incoming)) {
      if (value === undefined) continue;
      const envKey = ENV_KEY_MAP[camel];
      if (!envKey) continue;

      // Inject into current process immediately.
      process.env[envKey] = value;
      dotenv.set(envKey, value);
      changed = true;
    }

    if (changed) {
      writeDotenv(envFile, dotenv);
    }

    return { ok: true };
  });
}
