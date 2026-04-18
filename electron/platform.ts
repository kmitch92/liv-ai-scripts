export function getLibreOfficeInstallUrl(): string {
  return "https://www.libreoffice.org/download/download-libreoffice/";
}

export function getLibreOfficeInstallHint(): string {
  return process.platform === "win32"
    ? "Download and install from libreoffice.org"
    : "Run: sudo apt install libreoffice (Debian/Ubuntu) or install via your package manager";
}
