interface ElectronAPI {
  getSettings: () => Promise<unknown>;
  saveSettings: (keys: Record<string, string>) => Promise<void>;
  checkDeps: () => Promise<unknown>;
  selectFolder: () => Promise<string | null>;
  openPath: (path: string) => Promise<void>;
  getPlatform: () => Promise<string>;
  isElectron: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
export {};
