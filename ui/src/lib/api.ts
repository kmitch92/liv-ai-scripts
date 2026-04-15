import {
  ConfigListSchema,
  ConfigSchema,
  PromptEntrySchema,
  PromptListSchema,
  RunDetailSchema,
  RunListSchema,
  RunStartResponseSchema,
  type ConfigDoc,
  type PromptEntry,
} from "./schemas";
import type { z } from "zod";

async function request<T extends z.ZodTypeAny>(
  schema: T,
  path: string,
  init?: RequestInit
): Promise<z.infer<T>> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = typeof body.error === "string" ? body.error : JSON.stringify(body.error);
      else if (body?.message) msg = body.message;
      else msg = JSON.stringify(body);
    } catch {
      /* empty */
    }
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as z.infer<T>;
  const json = await res.json();
  return schema.parse(json);
}

export const api = {
  listPrompts: (configName = "default") =>
    request(PromptListSchema, `/api/prompts?configName=${encodeURIComponent(configName)}`),
  getPrompt: (id: string, configName = "default") =>
    request(PromptEntrySchema, `/api/prompts/${encodeURIComponent(id)}?configName=${encodeURIComponent(configName)}`),
  savePrompt: (id: string, content: string, configName = "default") =>
    request(PromptEntrySchema, `/api/prompts/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ content, configName }),
    }),

  listConfigs: () => request(ConfigListSchema, "/api/configs"),
  getConfig: (name: string) =>
    request(ConfigSchema, `/api/configs/${encodeURIComponent(name)}`),
  createConfig: (name: string, from?: string) =>
    request(ConfigSchema, "/api/configs", {
      method: "POST",
      body: JSON.stringify({ name, from }),
    }),
  saveConfig: (name: string, doc: ConfigDoc) =>
    request(ConfigSchema, `/api/configs/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify(doc),
    }),
  deleteConfig: (name: string) =>
    fetch(`/api/configs/${encodeURIComponent(name)}`, { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(`delete failed: ${r.status}`);
    }),

  listRuns: () => request(RunListSchema, "/api/runs"),
  getRun: (id: string) => request(RunDetailSchema, `/api/runs/${encodeURIComponent(id)}`),
  startRun: (body: { configName: string; topic: string; output?: string }) =>
    request(RunStartResponseSchema, "/api/runs", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  abortRun: (id: string) =>
    fetch(`/api/runs/${encodeURIComponent(id)}/abort`, { method: "POST" }).then((r) => {
      if (!r.ok) throw new Error(`abort failed: ${r.status}`);
    }),
  revealRun: (id: string) =>
    fetch(`/api/runs/${encodeURIComponent(id)}/reveal`, { method: "POST" }).then((r) => {
      if (!r.ok) throw new Error(`reveal failed: ${r.status}`);
    }),
};

export type { PromptEntry, ConfigDoc };
