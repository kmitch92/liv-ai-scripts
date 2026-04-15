import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// src/lib/prompts.ts → repo root is two levels up.
const REPO_ROOT = resolve(__dirname, "..", "..");
const PROMPTS_DIR = resolve(REPO_ROOT, "assets", "prompts");

const cache = new Map<string, string>();

function resolvePromptPath(id: string): string {
  return resolve(PROMPTS_DIR, `${id}.md`);
}

function applyVars(
  template: string,
  vars: Record<string, string> | undefined,
  filePath: string,
): string {
  if (!vars) return assertNoUnresolvedRequiredVars(template, filePath, {});
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    const token = new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, "g");
    result = result.replace(token, value);
  }
  return assertNoUnresolvedRequiredVars(result, filePath, vars);
}

function assertNoUnresolvedRequiredVars(
  rendered: string,
  filePath: string,
  provided: Record<string, string>,
): string {
  const unresolved = new Set<string>();
  const re = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rendered)) !== null) {
    if (!(m[1] in provided)) unresolved.add(m[1]);
  }
  if (unresolved.size > 0) {
    throw new Error(
      `loadPrompt(${filePath}): missing required variables: ${Array.from(unresolved).join(", ")}`,
    );
  }
  return rendered;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function loadPrompt(
  id: string,
  vars?: Record<string, string>,
): Promise<string> {
  const filePath = resolvePromptPath(id);
  let raw = cache.get(filePath);
  if (raw === undefined) {
    raw = readFileSync(filePath, "utf8");
    cache.set(filePath, raw);
  }
  return applyVars(raw, vars, filePath);
}

export function loadPromptSync(
  id: string,
  vars?: Record<string, string>,
): string {
  const filePath = resolvePromptPath(id);
  let raw = cache.get(filePath);
  if (raw === undefined) {
    raw = readFileSync(filePath, "utf8");
    cache.set(filePath, raw);
  }
  return applyVars(raw, vars, filePath);
}

export function clearPromptCache(): void {
  cache.clear();
}
