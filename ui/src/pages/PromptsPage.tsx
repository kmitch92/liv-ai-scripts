import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import PromptEditor from "../components/PromptEditor";

export default function PromptsPage() {
  const [configName, setConfigName] = useState("default");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const configsQ = useQuery({ queryKey: ["configs"], queryFn: api.listConfigs });
  const promptsQ = useQuery({
    queryKey: ["prompts", configName],
    queryFn: () => api.listPrompts(configName),
  });

  const grouped = useMemo(() => {
    const map = new Map<string, typeof promptsQ.data>();
    for (const p of promptsQ.data ?? []) {
      const arr = map.get(p.pipelineStep) ?? [];
      arr.push(p);
      map.set(p.pipelineStep, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [promptsQ.data]);

  const selected = promptsQ.data?.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="h-full flex overflow-hidden">
      <aside className="w-80 flex flex-col border-r border-slate-800 bg-slate-900/50 overflow-hidden">
        <div className="p-4 border-b border-slate-800 space-y-2">
          <label className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
            Config preset
          </label>
          <select
            value={configName}
            onChange={(e) => setConfigName(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100 text-sm"
          >
            {(configsQ.data ?? [{ name: "default", mtime: "" }]).map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 overflow-auto">
          {promptsQ.isLoading && (
            <div className="p-4 text-slate-400 text-sm">Loading...</div>
          )}
          {promptsQ.isError && (
            <div className="p-4 text-red-400 text-sm">
              {(promptsQ.error as Error).message}
            </div>
          )}
          {grouped.map(([step, items]) => (
            <div key={step} className="mb-2">
              <div className="px-4 py-2 text-xs uppercase tracking-wider text-slate-500 font-semibold bg-slate-900/80">
                {step}
              </div>
              {items?.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={[
                    "w-full text-left px-4 py-2 text-sm transition-colors border-l-2",
                    selectedId === p.id
                      ? "bg-indigo-900/30 border-indigo-500 text-white"
                      : "border-transparent text-slate-300 hover:bg-slate-800/60",
                  ].join(" ")}
                >
                  {p.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>

      <section className="flex-1 overflow-hidden">
        {selected ? (
          <PromptEditor prompt={selected} configName={configName} />
        ) : (
          <div className="h-full flex items-center justify-center text-slate-500">
            Select a prompt to edit
          </div>
        )}
      </section>
    </div>
  );
}
