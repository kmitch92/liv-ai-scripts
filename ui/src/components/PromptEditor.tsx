import CodeEditor from "@uiw/react-textarea-code-editor";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type PromptEntry } from "../lib/api";

interface Props {
  prompt: PromptEntry;
  configName: string;
}

export default function PromptEditor({ prompt, configName }: Props) {
  const [buffer, setBuffer] = useState(prompt.content);
  const qc = useQueryClient();

  useEffect(() => {
    setBuffer(prompt.content);
  }, [prompt.id, prompt.content, configName]);

  const dirty = buffer !== prompt.content;

  const saveMutation = useMutation({
    mutationFn: () => api.savePrompt(prompt.id, buffer, configName),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["prompts", configName] });
      qc.invalidateQueries({ queryKey: ["prompt", prompt.id, configName] });
    },
    onError: (e: Error) => {
      toast.error(`Save failed: ${e.message}`);
    },
  });

  const sourceLabel =
    prompt.source.kind === "config"
      ? `config.${prompt.source.path}`
      : prompt.source.relPath;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-800 space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-slate-100">{prompt.label}</h2>
          {dirty && (
            <span className="px-2 py-0.5 text-xs rounded bg-amber-600/30 text-amber-300 border border-amber-700/50">
              Modified
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
            step: {prompt.pipelineStep}
          </span>
          <span className="px-2 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
            source: {prompt.source.kind}
          </span>
          <span className="px-2 py-1 rounded bg-slate-800 text-slate-400 border border-slate-700 font-mono">
            {sourceLabel}
          </span>
          {prompt.source.kind === "config" && (
            <span className="px-2 py-1 rounded bg-indigo-900/40 text-indigo-300 border border-indigo-800">
              preset: {configName}
            </span>
          )}
        </div>
        <div className="rounded-md border border-indigo-800/60 bg-indigo-950/50 p-4">
          <div className="text-xs uppercase tracking-wider text-indigo-300/80 font-semibold mb-1">
            Purpose
          </div>
          <div className="text-slate-100 leading-relaxed">{prompt.purpose}</div>
        </div>
        {prompt.variables && prompt.variables.length > 0 && (
          <div className="text-sm text-slate-400">
            <span className="font-medium text-slate-300">Template variables:</span>{" "}
            {prompt.variables.map((v, i) => (
              <span key={v}>
                <code className="px-1.5 py-0.5 bg-slate-800 rounded text-indigo-300">
                  {`{{${v}}}`}
                </code>
                {i < prompt.variables!.length - 1 && ", "}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto bg-slate-900">
        <CodeEditor
          value={buffer}
          language="markdown"
          onChange={(e) => setBuffer(e.target.value)}
          padding={16}
          minHeight={600}
          style={{
            fontSize: 13,
            backgroundColor: "rgb(15 23 42)",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            minHeight: "100%",
          }}
          data-color-mode="dark"
        />
      </div>

      <div className="px-6 py-3 border-t border-slate-800 bg-slate-900 flex gap-3 justify-end">
        <button
          className="px-4 py-2 rounded-md text-sm font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={!dirty || saveMutation.isPending}
          onClick={() => setBuffer(prompt.content)}
        >
          Revert
        </button>
        <button
          className="px-4 py-2 rounded-md text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={!dirty || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
