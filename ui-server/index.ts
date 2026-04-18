import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defaultPaths, type Paths } from "./paths.js";
import { validateRegistry } from "./prompt-registry.js";
import { configsRoutes } from "./routes/configs.js";
import { promptsRoutes } from "./routes/prompts.js";
import { runsRoutes } from "./routes/runs.js";
import { recutRoutes } from "./routes/recut.js";
import { settingsRoutes } from "./routes/settings.js";
import { RunManager } from "./run-manager.js";

export interface BuildOptions {
  paths?: Paths;
  runManager?: RunManager;
}

export interface StartServerResult {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export async function buildServer(options: BuildOptions = {}): Promise<FastifyInstance> {
  validateRegistry();
  const paths = options.paths ?? defaultPaths();
  const runs =
    options.runManager ??
    new RunManager({
      repoRoot: paths.repoRoot,
      runsDir: paths.runsDir,
      configsDir: paths.configsDir,
    });

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  await promptsRoutes(app, paths);
  await configsRoutes(app, paths);
  await runsRoutes(app, paths, runs);
  await recutRoutes(app, paths, runs);
  await settingsRoutes(app, paths);

  app.get("/api/health", async () => ({ ok: true }));

  // Serve static UI build if present (production / Electron).
  const uiDistDir = resolve(paths.repoRoot, "ui", "dist");
  if (existsSync(resolve(uiDistDir, "index.html"))) {
    await app.register(fastifyStatic, { root: uiDistDir, prefix: "/" });

    // SPA fallback: non-API GET requests return index.html.
    app.setNotFoundHandler(async (req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not found" });
    });
  }

  return app;
}

export async function startServer(
  options?: { port?: number },
): Promise<StartServerResult> {
  const app = await buildServer();
  const requestedPort = options?.port ?? Number(process.env.UI_SERVER_PORT ?? 4317);
  await app.listen({ host: "127.0.0.1", port: requestedPort });

  const addr = app.server.address();
  const actualPort = typeof addr === "object" && addr !== null ? addr.port : requestedPort;
  const url = `http://127.0.0.1:${actualPort}`;

  // eslint-disable-next-line no-console
  console.log(`[ui-server] listening on ${url}`);

  return {
    url,
    port: actualPort,
    close: () => app.close(),
  };
}

// Only run main when invoked directly (tsx/node), not when imported by tests.
const isDirectRun = (() => {
  try {
    const invoked = process.argv[1];
    if (!invoked) return false;
    return invoked.endsWith("ui-server/index.ts") || invoked.endsWith("ui-server/index.js");
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  startServer().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[ui-server] fatal", err);
    process.exit(1);
  });
}
