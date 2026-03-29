import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const BASE_TMP = join(homedir(), ".liv-ai-scripts", "tmp");

export async function createTempDir(): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  await mkdir(BASE_TMP, { recursive: true });
  const path = await mkdtemp(join(BASE_TMP, "session-"));
  return {
    path,
    cleanup: async () => {
      await rm(path, { recursive: true, force: true });
    },
  };
}
