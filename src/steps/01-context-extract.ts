import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import pdf from "pdf-parse";
import * as logger from "../lib/logger.js";

const MAX_CHARS = 32_000; // ~8 000 tokens

async function extractFile(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();

  if (ext === ".pdf") {
    const buffer = await readFile(filePath);
    const data = await pdf(buffer);
    return data.text;
  } else if ([".md", ".txt", ".text", ".markdown"].includes(ext)) {
    return await readFile(filePath, "utf-8");
  } else {
    throw new Error(
      `Unsupported context file format: ${ext}. Use .pdf, .md, or .txt`,
    );
  }
}

export async function extractContext(filePaths: string[]): Promise<string> {
  logger.startStep("Extracting context files...");

  if (filePaths.length === 0) {
    logger.succeedStep("No context files provided, skipping extraction");
    return "";
  }

  const parts: string[] = [];
  for (const filePath of filePaths) {
    const resolved = resolve(filePath);
    const text = await extractFile(resolved);
    parts.push(text);
  }

  let combined = parts.join("\n\n---\n\n");

  if (combined.length > MAX_CHARS) {
    logger.warn(
      `Context truncated from ${combined.length} to ${MAX_CHARS} characters`,
    );
    combined = combined.slice(0, MAX_CHARS);
  }

  logger.succeedStep(`Context extracted (${combined.length} chars from ${filePaths.length} file(s))`);
  return combined;
}
