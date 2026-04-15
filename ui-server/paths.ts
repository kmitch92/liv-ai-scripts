import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ui-server/paths.ts → repo root is one level up.
export const REPO_ROOT = resolve(__dirname, "..");
export const PROMPTS_DIR = resolve(REPO_ROOT, "assets", "prompts");
export const CONFIGS_DIR_DEFAULT = resolve(REPO_ROOT, "configs");
export const RUNS_DIR_DEFAULT = resolve(REPO_ROOT, "runs");

export interface Paths {
  repoRoot: string;
  promptsDir: string;
  configsDir: string;
  runsDir: string;
}

export function defaultPaths(): Paths {
  return {
    repoRoot: REPO_ROOT,
    promptsDir: PROMPTS_DIR,
    configsDir: process.env.LIVAI_CONFIGS_DIR
      ? resolve(process.env.LIVAI_CONFIGS_DIR)
      : CONFIGS_DIR_DEFAULT,
    runsDir: process.env.LIVAI_RUNS_DIR
      ? resolve(process.env.LIVAI_RUNS_DIR)
      : RUNS_DIR_DEFAULT,
  };
}
