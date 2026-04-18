import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import os from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default app root: repo root is one level up from ui-server/.
let _appRoot = resolve(__dirname, "..");
let _outputDir: string | undefined;

/** Override the application root directory (e.g. from Electron). */
export function setAppRoot(root: string): void {
  _appRoot = resolve(root);
}

/** Override the default output directory (e.g. from Electron). */
export function setOutputDir(dir: string): void {
  _outputDir = resolve(dir);
}

/** Current app root (repo root in dev, app directory in Electron). */
export function getAppRoot(): string {
  return _appRoot;
}

/** Default output directory for pipeline artifacts. */
export function getOutputDir(): string {
  return _outputDir ?? join(os.homedir(), "Downloads", "liv-ai-outputs");
}

/**
 * Backward-compatible constant.
 * Prefer `getAppRoot()` for code that may run after `setAppRoot()`.
 * This value reflects the initial default and is NOT updated by `setAppRoot()`.
 */
export const REPO_ROOT = resolve(__dirname, "..");

export interface Paths {
  repoRoot: string;
  promptsDir: string;
  configsDir: string;
  runsDir: string;
  outputDir: string;
}

export function defaultPaths(): Paths {
  const root = getAppRoot();
  return {
    repoRoot: root,
    promptsDir: resolve(root, "assets", "prompts"),
    configsDir: process.env.LIVAI_CONFIGS_DIR
      ? resolve(process.env.LIVAI_CONFIGS_DIR)
      : resolve(root, "configs"),
    runsDir: process.env.LIVAI_RUNS_DIR
      ? resolve(process.env.LIVAI_RUNS_DIR)
      : resolve(root, "runs"),
    outputDir: getOutputDir(),
  };
}
