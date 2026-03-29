#!/usr/bin/env node
import "dotenv/config";
import { resolve } from "node:path";
import { readFile, access } from "node:fs/promises";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { Command } from "commander";
import { ZodError } from "zod";
import { CliArgsSchema, ConfigSchema } from "./types/index.js";
import { runPipeline } from "./pipeline.js";
import * as logger from "./lib/logger.js";

const execFile = promisify(execFileCb);

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFile("which", [cmd]);
    return true;
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }
}

function checkEnvVars(): void {
  // At least one LLM provider key is required
  if (!process.env["ANTHROPIC_API_KEY"] && !process.env["OPENROUTER_API_KEY"]) {
    throw new Error(
      "Missing required environment variable: set ANTHROPIC_API_KEY or OPENROUTER_API_KEY (at least one)",
    );
  }

  const required = ["ELEVENLABS_API_KEY"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }

  if (!process.env["UNSPLASH_ACCESS_KEY"]) {
    logger.warn(
      "UNSPLASH_ACCESS_KEY not set - image fetching will use fallback placeholders",
    );
  }
}

async function checkSystemDeps(): Promise<void> {
  if (!(await commandExists("ffmpeg"))) {
    throw new Error(
      "ffmpeg is required but not found. Install it: https://ffmpeg.org/download.html",
    );
  }

  if (!(await commandExists("libreoffice"))) {
    logger.warn(
      "libreoffice not found - PPTX-to-image conversion for video will be unavailable",
    );
  }
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("liv-ai")
    .description("Generate teaching materials (PPTX + video) from a topic and config")
    .requiredOption("-t, --topic <topic>", "Topic to generate materials for")
    .requiredOption("-c, --config <path>", "Path to config JSON file")
    .option("-o, --output <path>", "Output path for the archive");

  program.parse();
  const opts = program.opts();

  // Validate CLI args with Zod
  const args = CliArgsSchema.parse({
    topic: opts.topic,
    config: opts.config,
    output: opts.output,
  });

  // Resolve paths to absolute
  const configPath = resolve(args.config);

  // Validate file existence
  await fileExists(configPath);

  // Read and validate config
  const configRaw = await readFile(configPath, "utf-8");
  let configJson: unknown;
  try {
    configJson = JSON.parse(configRaw);
  } catch {
    throw new Error(`Invalid JSON in config file: ${configPath}`);
  }
  const config = ConfigSchema.parse(configJson);

  // Validate context files exist
  for (const ctxFile of config.script.contextFiles) {
    await fileExists(resolve(ctxFile));
  }

  // Check environment variables
  checkEnvVars();

  // Check system dependencies
  await checkSystemDeps();

  // Run pipeline
  const archivePath = await runPipeline({
    args,
    config,
  });

  logger.success(`Output: ${archivePath}`);
}

main().catch((err: unknown) => {
  if (err instanceof ZodError) {
    logger.error("Validation error:");
    for (const issue of err.issues) {
      logger.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  const message = err instanceof Error ? err.message : String(err);
  logger.error(message);
  process.exit(2);
});
