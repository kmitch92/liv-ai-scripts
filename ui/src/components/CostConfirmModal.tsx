import { useState } from "react";

interface Props {
  topic: string;
  configName: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending?: boolean;
}

export default function CostConfirmModal({
  topic,
  configName,
  onCancel,
  onConfirm,
  pending,
}: Props) {
  const [typed, setTyped] = useState("");
  const enabled = typed === "RUN" && !pending;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        className="bg-slate-900 border border-amber-700 rounded-lg p-6 w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-amber-300 mb-3">
          Confirm paid run
        </h3>
        <div className="space-y-3 text-sm">
          <p className="text-slate-200">
            This will spend real money on LLM, TTS, and image APIs.
          </p>
          <div className="bg-slate-950/60 border border-slate-700 rounded p-3 font-mono text-xs space-y-1">
            <div>
              <span className="text-slate-500">preset:</span> {configName}
            </div>
            <div>
              <span className="text-slate-500">topic:</span> {topic}
            </div>
          </div>
          <p className="text-slate-300">
            Type <code className="px-1.5 py-0.5 bg-slate-800 rounded text-amber-300">RUN</code> to
            enable the confirm button.
          </p>
          <input
            className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-700 text-sm font-mono"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
          />
        </div>
        <div className="mt-5 flex gap-2 justify-end">
          <button
            className="px-4 py-2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 rounded bg-amber-600 text-white hover:bg-amber-500 text-sm disabled:opacity-30 disabled:cursor-not-allowed"
            disabled={!enabled}
            onClick={onConfirm}
          >
            {pending ? "Starting..." : "Start run"}
          </button>
        </div>
      </div>
    </div>
  );
}
