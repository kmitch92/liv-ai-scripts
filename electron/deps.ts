import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface DepCheckResult {
  ffmpeg: boolean;
  ffprobe: boolean;
  libreoffice: boolean;
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    const which = process.platform === "win32" ? "where" : "which";
    await execFileAsync(which, [cmd]);
    return true;
  } catch {
    return false;
  }
}

export async function checkDependencies(): Promise<DepCheckResult> {
  const libreofficeBin = process.platform === "win32" ? "soffice" : "libreoffice";

  const [ffmpeg, ffprobe, libreoffice] = await Promise.all([
    commandExists("ffmpeg"),
    commandExists("ffprobe"),
    commandExists(libreofficeBin),
  ]);

  return { ffmpeg, ffprobe, libreoffice };
}
