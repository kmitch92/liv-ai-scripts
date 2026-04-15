import type { FastifyInstance } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { ConfigSchema } from "../../src/schemas/config.schema.js";
import { atomicWriteFileSync } from "../fs-utils.js";
import type { Paths } from "../paths.js";
import {
  PROMPT_REGISTRY,
  type PromptMeta,
  getAtPath,
  getEntry,
  setAtPath,
} from "../prompt-registry.js";

interface ResolvedPrompt extends PromptMeta {
  content: string;
  configName?: string;
}

function resolveConfigPath(paths: Paths, name: string): string {
  return resolve(paths.configsDir, `${name}.json`);
}

function readConfigOrFallback(paths: Paths, name: string): unknown {
  const preferred = resolveConfigPath(paths, name);
  if (existsSync(preferred)) {
    return JSON.parse(readFileSync(preferred, "utf8"));
  }
  // Fallback to root config.json as seed if name === "default".
  const rootConfig = resolve(paths.repoRoot, "config.json");
  if (name === "default" && existsSync(rootConfig)) {
    return JSON.parse(readFileSync(rootConfig, "utf8"));
  }
  throw Object.assign(new Error(`Config preset '${name}' not found`), { statusCode: 404 });
}

function resolvePromptContent(
  paths: Paths,
  entry: PromptMeta,
  configName: string,
): string {
  if (entry.source.kind === "config") {
    const cfg = readConfigOrFallback(paths, configName);
    const value = getAtPath(cfg, entry.source.jsonPath);
    if (typeof value !== "string") return "";
    return value;
  }
  const abs = resolve(paths.repoRoot, entry.source.relPath);
  return existsSync(abs) ? readFileSync(abs, "utf8") : "";
}

export async function promptsRoutes(app: FastifyInstance, paths: Paths) {
  app.get("/api/prompts", async (req) => {
    const q = req.query as { configName?: string };
    const configName = q.configName ?? "default";
    const out: ResolvedPrompt[] = PROMPT_REGISTRY.map((entry) => ({
      ...entry,
      content: resolvePromptContent(paths, entry, configName),
      configName: entry.source.kind === "config" ? configName : undefined,
    }));
    return out;
  });

  app.get("/api/prompts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { configName?: string };
    const configName = q.configName ?? "default";
    const entry = getEntry(id);
    if (!entry) return reply.code(404).send({ error: "Unknown prompt id" });
    return {
      ...entry,
      content: resolvePromptContent(paths, entry, configName),
      configName: entry.source.kind === "config" ? configName : undefined,
    };
  });

  const PutBody = z.object({
    content: z.string(),
    configName: z.string().optional(),
  });

  app.put("/api/prompts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const entry = getEntry(id);
    if (!entry) return reply.code(404).send({ error: "Unknown prompt id" });

    const parsed = PutBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const { content, configName = "default" } = parsed.data;

    if (entry.source.kind === "file") {
      const abs = resolve(paths.repoRoot, entry.source.relPath);
      atomicWriteFileSync(abs, content);
      return { ok: true, id };
    }

    // config-sourced: load preset, patch, revalidate, atomic write.
    const path = resolveConfigPath(paths, configName);
    let current: unknown;
    if (existsSync(path)) {
      current = JSON.parse(readFileSync(path, "utf8"));
    } else {
      current = readConfigOrFallback(paths, configName);
    }
    const next = setAtPath(current as object, entry.source.jsonPath, content);
    const validated = ConfigSchema.safeParse(next);
    if (!validated.success) {
      return reply.code(400).send({
        error: "Config validation failed",
        details: validated.error.flatten(),
      });
    }
    atomicWriteFileSync(path, JSON.stringify(next, null, 2) + "\n");
    return { ok: true, id, configName };
  });
}
