import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";

interface LogLine {
  type: "stdout" | "stderr" | "exit";
  line?: string;
  code?: number | null;
  timestamp?: string;
}

interface Props {
  runId: string;
}

export default function RunConsole({ runId }: Props) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["run", runId], queryFn: () => api.getRun(runId) });

  const [lines, setLines] = useState<LogLine[]>([]);
  const [filter, setFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [finished, setFinished] = useState(false);
  const [exitCode, setExitCode] = useState<number | null | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);

  // Seed from existing log (for completed runs)
  useEffect(() => {
    if (q.data?.log && !initializedRef.current) {
      setLines(q.data.log as LogLine[]);
      initializedRef.current = true;
    }
  }, [q.data]);

  // SSE
  useEffect(() => {
    const src = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
    src.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as LogLine;
        if (parsed.type === "exit") {
          setFinished(true);
          setExitCode(parsed.code ?? null);
          src.close();
          qc.invalidateQueries({ queryKey: ["run", runId] });
          qc.invalidateQueries({ queryKey: ["runs"] });
        } else {
          setLines((prev) => [...prev, parsed]);
        }
      } catch {
        // ignore
      }
    };
    src.onerror = () => {
      src.close();
    };
    return () => src.close();
  }, [runId, qc]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    setAutoScroll(atBottom);
  };

  const filtered = useMemo(() => {
    if (!filter) return lines;
    const f = filter.toLowerCase();
    return lines.filter((l) => (l.line ?? "").toLowerCase().includes(f));
  }, [lines, filter]);

  const meta = q.data;
  const status = finished ? (exitCode === 0 ? "completed" : "failed") : meta?.status ?? "running";
  const running = !finished && status === "running";

  const copyLog = async () => {
    const text = lines.map((l) => l.line ?? "").join("\n");
    await navigator.clipboard.writeText(text);
    toast.success("Log copied");
  };

  const abort = async () => {
    try {
      await api.abortRun(runId);
      toast.success("Abort sent");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const reveal = async () => {
    try {
      await api.revealRun(runId);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-3 border-b border-slate-800 bg-slate-900 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-slate-400 truncate">
            <span className="text-slate-500">topic:</span> {meta?.topic ?? "—"}{" "}
            <span className="text-slate-500 ml-3">preset:</span> {meta?.configName ?? "—"}
          </div>
          <div className="text-xs text-slate-500 mt-0.5 font-mono">{runId}</div>
        </div>
        <StatusBadge status={status} />
        <div className="flex gap-2">
          {running && (
            <button
              className="px-3 py-1.5 rounded bg-red-600 text-white text-sm hover:bg-red-500"
              onClick={abort}
            >
              Abort
            </button>
          )}
          {finished && exitCode === 0 && (
            <button
              className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-500"
              onClick={reveal}
            >
              Reveal archive
            </button>
          )}
          <button
            className="px-3 py-1.5 rounded bg-slate-800 text-slate-200 text-sm hover:bg-slate-700"
            onClick={copyLog}
          >
            Copy log
          </button>
        </div>
      </div>

      <div className="px-6 py-2 border-b border-slate-800 bg-slate-900/60 flex items-center gap-3">
        <input
          placeholder="Filter..."
          className="flex-1 px-3 py-1.5 rounded bg-slate-950 border border-slate-700 text-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {filter && (
          <button
            className="text-xs text-slate-400 hover:text-slate-200"
            onClick={() => setFilter("")}
          >
            Clear filter
          </button>
        )}
        <label className="text-xs text-slate-400 flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          Auto-scroll
        </label>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto bg-slate-950 font-mono text-xs p-3"
        style={{ maxHeight: "calc(100vh - 220px)" }}
      >
        {filtered.length === 0 && (
          <div className="text-slate-600 italic">
            {running ? "Waiting for output..." : "No log lines"}
          </div>
        )}
        {filtered.map((l, i) => (
          <div
            key={i}
            className={[
              "whitespace-pre-wrap break-words leading-5",
              l.type === "stderr" ? "text-red-300" : "text-slate-300",
            ].join(" ")}
          >
            {l.line}
          </div>
        ))}
        {finished && (
          <div
            className={[
              "mt-3 pt-2 border-t border-slate-800",
              exitCode === 0 ? "text-emerald-400" : "text-red-400",
            ].join(" ")}
          >
            --- exit code {exitCode ?? "?"} ---
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "running"
      ? "bg-indigo-900/50 text-indigo-300 border-indigo-700"
      : status === "completed"
      ? "bg-emerald-900/40 text-emerald-300 border-emerald-700"
      : status === "aborted"
      ? "bg-amber-900/40 text-amber-300 border-amber-700"
      : "bg-red-900/40 text-red-300 border-red-700";
  return (
    <span className={`px-2 py-1 text-xs rounded border ${cls}`}>{status}</span>
  );
}
