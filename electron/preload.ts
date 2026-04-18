const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (keys: Record<string, string>) => ipcRenderer.invoke("save-settings", keys),
  checkDeps: () => ipcRenderer.invoke("check-deps"),
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  openPath: (targetPath: string) => ipcRenderer.invoke("open-path", targetPath),
  getPlatform: () => ipcRenderer.invoke("get-platform"),
  isElectron: true,
});
