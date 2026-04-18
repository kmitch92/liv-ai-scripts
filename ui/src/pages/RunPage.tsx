import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";
import CostConfirmModal from "../components/CostConfirmModal";
import RunConsole from "../components/RunConsole";

export default function RunPage() {
  const { runId } = useParams();
  if (runId) return <RunConsole runId={runId} />;
  return <RunForm />;
}

function RunForm() {
  const nav = useNavigate();
  const configsQ = useQuery({ queryKey: ["configs"], queryFn: api.listConfigs });
  const runsQ = useQuery({ queryKey: ["runs"], queryFn: api.listRuns });

  const [configName, setConfigName] = useState("default");
  const [output, setOutput] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);

  const start = useMutation({
    mutationFn: () =>
      api.startRun({
        configName,
        output: output.trim() || undefined,
      }),
    onSuccess: (r) => {
      setShowConfirm(false);
      nav(`/run/${r.runId}`);
    },
    onError: (e: Error & { status?: number }) => {
      setShowConfirm(false);
      if (e.status === 409) {
        toast.error("A run is already in progress");
      } else {
        toast.error(`Start failed: ${e.message}`);
      }
    },
  });

  const canStart = !!configName;

  const activeRun = (runsQ.data ?? []).find((r) => r.status === "running");

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6 overflow-auto h-full">
      <h1 className="text-2xl font-semibold">Start a run</h1>

      <div className="rounded-md border border-amber-700/60 bg-amber-950/40 p-4 text-amber-200">
        <div className="font-semibold mb-1">Paid APIs ahead</div>
        <p className="text-sm">
          Runs call paid LLM, TTS, and image APIs. Real money. Confirm before
          starting.
        </p>
      </div>

      {activeRun && (
        <div className="rounded-md border border-indigo-700/60 bg-indigo-950/40 p-3 text-sm">
          A run is already in progress:{" "}
          <Link to={`/run/${activeRun.id}`} className="underline text-indigo-300">
            {activeRun.topic ?? activeRun.id}
          </Link>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
            Config preset
          </label>
          <select
            className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-sm"
            value={configName}
            onChange={(e) => setConfigName(e.target.value)}
          >
            {(configsQ.data ?? []).map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
            Output path (optional)
          </label>
          <input
            className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-sm font-mono"
            placeholder="output/my-run"
            value={output}
            onChange={(e) => setOutput(e.target.value)}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          className="px-5 py-2.5 rounded bg-amber-600 text-white font-medium hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={!canStart}
          onClick={() => setShowConfirm(true)}
        >
          Start run
        </button>
      </div>

      {showConfirm && (
        <CostConfirmModal
          configName={configName}
          onCancel={() => setShowConfirm(false)}
          onConfirm={() => start.mutate()}
          pending={start.isPending}
        />
      )}

      <div className="pt-4 border-t border-slate-800">
        <h2 className="text-sm uppercase tracking-wider text-slate-400 font-semibold mb-2">
          Recent runs
        </h2>
        <div className="space-y-1">
          {(runsQ.data ?? []).slice(0, 10).map((r) => (
            <Link
              key={r.id}
              to={`/run/${r.id}`}
              className="block px-3 py-2 rounded bg-slate-900 hover:bg-slate-800 text-sm"
            >
              <div className="flex items-center justify-between">
                <span className="truncate mr-3">{r.topic ?? r.id}</span>
                <span className="text-xs text-slate-500">{r.status}</span>
              </div>
            </Link>
          ))}
          {(runsQ.data ?? []).length === 0 && (
            <div className="text-slate-500 text-sm">No runs yet</div>
          )}
        </div>
      </div>
    </div>
  );
}
