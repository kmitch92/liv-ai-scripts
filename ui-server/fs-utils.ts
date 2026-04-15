import { renameSync, writeFileSync } from "node:fs";

export function atomicWriteFileSync(target: string, data: string): void {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data, "utf8");
  renameSync(tmp, target);
}
