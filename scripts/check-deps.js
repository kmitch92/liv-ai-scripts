#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

const deps = [
  { cmd: "ffmpeg", required: true, install: "sudo apt install -y ffmpeg" },
  { cmd: "libreoffice", required: true, install: "sudo apt install -y libreoffice-impress" },
];

let missing = false;

console.log("\n  Checking system dependencies ...\n");

for (const dep of deps) {
  try {
    await exec("which", [dep.cmd]);
    console.log(`  \u2713 ${dep.cmd} found`);
  } catch {
    missing = true;
    const label = dep.required ? "\u2717 REQUIRED" : "\u26A0 RECOMMENDED";
    console.log(`  ${label}: ${dep.cmd} not found`);
    console.log(`    Install: ${dep.install}`);
    console.log(`    Or run: npm run setup`);
  }
}

if (missing) {
  console.log("\n  Run 'npm run setup' to install system dependencies.\n");
}
