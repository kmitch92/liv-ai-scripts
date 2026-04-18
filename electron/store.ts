import * as path from "path";
import * as os from "os";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Store = require("electron-store");

const store = new Store({ encryptionKey: "liv-ai-scripts-v1" });

interface ApiKeys {
  anthropicApiKey?: string;
  openrouterApiKey?: string;
  elevenlabsApiKey?: string;
  unsplashAccessKey?: string;
}

export function loadApiKeys(): Record<string, string> {
  return store.get("apiKeys", {}) as Record<string, string>;
}

export function saveApiKeys(keys: ApiKeys): void {
  store.set("apiKeys", keys);
}

export function getOutputPath(): string {
  return store.get(
    "outputPath",
    path.join(os.homedir(), "Downloads", "liv-ai-outputs"),
  ) as string;
}

export function setOutputPath(dir: string): void {
  store.set("outputPath", dir);
}

export function getKeyStatus(): Record<string, boolean> {
  const keys = loadApiKeys();
  return {
    anthropicApiKey: !!keys.anthropicApiKey,
    openrouterApiKey: !!keys.openrouterApiKey,
    elevenlabsApiKey: !!keys.elevenlabsApiKey,
    unsplashAccessKey: !!keys.unsplashAccessKey,
  };
}
