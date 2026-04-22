import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn, execFileSync, type ChildProcess } from "child_process";
import * as path from "path";
import { loadApiKeys, saveApiKeys, getKeyStatus, getOutputPath, setOutputPath } from "./store";
import { checkDependencies } from "./deps";

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;

/** Spawn the ESM ui-server as a child process and wait for it to report its URL. */
function spawnServer(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const keys = loadApiKeys();
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      UI_SERVER_PORT: "0",
      ELECTRON_RUN_AS_NODE: "1",
      LIVAI_APP_ROOT: path.resolve(__dirname, ".."),
    };

    // Inject stored API keys into the child env.
    for (const [k, v] of Object.entries(keys)) {
      if (!v) continue;
      // Convert camelCase key names to UPPER_SNAKE env var names.
      const envName = k.replace(/([A-Z])/g, "_$1").toUpperCase();
      env[envName] = v;
    }

    const serverScript = path.join(__dirname, "..", "ui-server", "dist", "index.cjs");
    const child = spawn(process.execPath, [serverScript], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    serverProcess = child;

    const timeout = setTimeout(() => {
      reject(new Error("Server did not start within 10 seconds"));
    }, 10_000);

    let stdoutBuffer = "";

    child.stdout!.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      // The server prints: [ui-server] listening on http://127.0.0.1:<port>
      const match = stdoutBuffer.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      // eslint-disable-next-line no-console
      console.error("[server:stderr]", chunk.toString());
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

function killServer(): void {
  if (!serverProcess || serverProcess.killed) return;
  const pid = serverProcess.pid;
  if (!pid) {
    serverProcess = null;
    return;
  }
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      serverProcess.kill("SIGTERM");
    }
  } catch {
    // Process may already be gone — fine.
  }
  serverProcess = null;
}

/** Restart the server child process (e.g. after settings change). */
async function restartServer(): Promise<string> {
  killServer();
  const url = await spawnServer();
  if (mainWindow) {
    mainWindow.loadURL(url);
  }
  return url;
}

// ---------------------------------------------------------------------------
// IPC Handlers
// ---------------------------------------------------------------------------

function registerIpcHandlers(): void {
  ipcMain.handle("get-settings", () => {
    return {
      keys: getKeyStatus(),
      outputPath: getOutputPath(),
    };
  });

  ipcMain.handle("save-settings", async (_event, keys: Record<string, string>) => {
    saveApiKeys(keys);
    await restartServer();
    return { ok: true };
  });

  ipcMain.handle("check-deps", async () => {
    return checkDependencies();
  });

  ipcMain.handle("select-folder", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const selected = result.filePaths[0];
    setOutputPath(selected);
    return selected;
  });

  ipcMain.handle("open-path", async (_event, targetPath: string) => {
    return shell.openPath(targetPath);
  });

  ipcMain.handle("get-platform", () => {
    return process.platform;
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  registerIpcHandlers();

  let serverUrl: string;
  try {
    serverUrl = await spawnServer();
  } catch (err) {
    dialog.showErrorBox(
      "Server failed to start",
      `The backend server could not start.\n\n${(err as Error).message}`,
    );
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(serverUrl);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
});

app.on("before-quit", () => {
  killServer();
});

app.on("window-all-closed", () => {
  killServer();
  app.quit();
});
