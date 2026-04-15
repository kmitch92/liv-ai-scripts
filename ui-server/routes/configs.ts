import type { FastifyInstance } from "fastify";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { ConfigSchema } from "../../src/schemas/config.schema.js";
import { atomicWriteFileSync } from "../fs-utils.js";
import type { Paths } from "../paths.js";

const NAME_RE = /^[a-z0-9-_]+$/i;

function presetPath(paths: Paths, name: string): string {
  return resolve(paths.configsDir, `${name}.json`);
}

function validName(name: string): boolean {
  return NAME_RE.test(name) && name.length > 0 && name.length <= 64;
}

export async function configsRoutes(app: FastifyInstance, paths: Paths) {
  app.get("/api/configs", async () => {
    if (!existsSync(paths.configsDir)) return [];
    return readdirSync(paths.configsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const full = resolve(paths.configsDir, f);
        const s = statSync(full);
        return { name: f.replace(/\.json$/, ""), mtime: s.mtimeMs };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  app.get("/api/configs/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!validName(name)) return reply.code(400).send({ error: "Invalid name" });
    const path = presetPath(paths, name);
    if (!existsSync(path)) return reply.code(404).send({ error: "Not found" });
    return JSON.parse(readFileSync(path, "utf8"));
  });

  const PostBody = z.object({
    name: z.string(),
    from: z.string().optional(),
  });

  app.post("/api/configs", async (req, reply) => {
    const parsed = PostBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const { name, from } = parsed.data;
    if (!validName(name)) return reply.code(400).send({ error: "Invalid name" });
    const target = presetPath(paths, name);
    if (existsSync(target)) return reply.code(409).send({ error: "Preset already exists" });

    const seedName = from ?? "default";
    if (!validName(seedName)) return reply.code(400).send({ error: "Invalid 'from' name" });
    const seedPath = presetPath(paths, seedName);
    let seed: string;
    if (existsSync(seedPath)) {
      seed = readFileSync(seedPath, "utf8");
    } else {
      // Fallback to root config.json if seeking default.
      const rootConfig = resolve(paths.repoRoot, "config.json");
      if (seedName === "default" && existsSync(rootConfig)) {
        seed = readFileSync(rootConfig, "utf8");
      } else {
        return reply.code(404).send({ error: `Seed preset '${seedName}' not found` });
      }
    }
    // Validate seed before cloning.
    const parsedSeed = ConfigSchema.safeParse(JSON.parse(seed));
    if (!parsedSeed.success) {
      return reply.code(400).send({ error: "Seed preset is invalid", details: parsedSeed.error.flatten() });
    }
    atomicWriteFileSync(target, seed.endsWith("\n") ? seed : seed + "\n");
    return reply.code(201).send({ ok: true, name });
  });

  app.put("/api/configs/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!validName(name)) return reply.code(400).send({ error: "Invalid name" });
    const validated = ConfigSchema.safeParse(req.body);
    if (!validated.success) {
      return reply.code(400).send({ error: "Config validation failed", details: validated.error.flatten() });
    }
    atomicWriteFileSync(presetPath(paths, name), JSON.stringify(req.body, null, 2) + "\n");
    return { ok: true, name };
  });

  app.delete("/api/configs/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!validName(name)) return reply.code(400).send({ error: "Invalid name" });
    if (name === "default") {
      return reply.code(400).send({ error: "Cannot delete the 'default' preset" });
    }
    const path = presetPath(paths, name);
    if (!existsSync(path)) return reply.code(404).send({ error: "Not found" });
    unlinkSync(path);
    return { ok: true, name };
  });
}
