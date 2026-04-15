import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { defaultPaths, type Paths } from "./paths.js";
import { validateRegistry } from "./prompt-registry.js";
import { configsRoutes } from "./routes/configs.js";
import { promptsRoutes } from "./routes/prompts.js";
import { runsRoutes } from "./routes/runs.js";
import { RunManager } from "./run-manager.js";

export interface BuildOptions {
  paths?: Paths;
  runManager?: RunManager;
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
  await app.register(cors, {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
  });

  await promptsRoutes(app, paths);
  await configsRoutes(app, paths);
  await runsRoutes(app, paths, runs);

  app.get("/api/health", async () => ({ ok: true }));

  return app;
}

async function main() {
  const app = await buildServer();
  const port = Number(process.env.UI_SERVER_PORT ?? 4317);
  await app.listen({ host: "127.0.0.1", port });
  // eslint-disable-next-line no-console
  console.log(`[ui-server] listening on http://127.0.0.1:${port}`);
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
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[ui-server] fatal", err);
    process.exit(1);
  });
}
