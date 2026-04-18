import CodeEditor from "@uiw/react-textarea-code-editor";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";

interface Props {
  name: string;
}

type Phonetic = { from: string; to: string };

function get(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur && typeof cur === "object" && k in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[k];
    } else {
      return undefined;
    }
  }
  return cur;
}

function setPath(obj: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  if (path.length === 0) return obj;
  const next = { ...obj };
  let cur: Record<string, unknown> = next;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    const existing = cur[k];
    const child = existing && typeof existing === "object" ? { ...(existing as Record<string, unknown>) } : {};
    cur[k] = child;
    cur = child as Record<string, unknown>;
  }
  cur[path[path.length - 1]] = value;
  return next;
}

export default function ConfigEditor({ name }: Props) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["config", name], queryFn: () => api.getConfig(name) });
  const [doc, setDoc] = useState<Record<string, unknown> | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [rawText, setRawText] = useState("");
  const [rawError, setRawError] = useState<string | null>(null);

  useEffect(() => {
    if (q.data) {
      setDoc(q.data as Record<string, unknown>);
      setRawText(JSON.stringify(q.data, null, 2));
      setRawError(null);
    }
  }, [q.data, name]);

  const dirty = useMemo(() => {
    if (!doc || !q.data) return false;
    return JSON.stringify(doc) !== JSON.stringify(q.data);
  }, [doc, q.data]);

  const save = useMutation({
    mutationFn: (d: Record<string, unknown>) => api.saveConfig(name, d),
    onSuccess: () => {
      toast.success("Config saved");
      qc.invalidateQueries({ queryKey: ["config", name] });
      qc.invalidateQueries({ queryKey: ["configs"] });
    },
    onError: (e: Error) => toast.error(`Save failed: ${e.message}`),
  });

  if (q.isLoading) return <div className="p-6 text-slate-400">Loading...</div>;
  if (q.isError) return <div className="p-6 text-red-400">{(q.error as Error).message}</div>;
  if (!doc) return null;

  const speakerIdentity = (get(doc, ["script", "speakerIdentity"]) as string) ?? "";
  const targetAudience = (get(doc, ["script", "targetAudience"]) as string) ?? "";
  const durationMinutes = (get(doc, ["script", "durationMinutes"]) as number) ?? 15;
  const contextFiles = (get(doc, ["script", "contextFiles"]) as string[]) ?? [];
  const phonetics = (get(doc, ["script", "phoneticsOverrides"]) as Phonetic[]) ?? [];
  const voiceId = (get(doc, ["elevenlabs", "voiceId"]) as string) ?? "";
  const modelId = (get(doc, ["elevenlabs", "modelId"]) as string) ?? "";
  const stability = (get(doc, ["elevenlabs", "stability"]) as number) ?? 0.5;
  const similarityBoost = (get(doc, ["elevenlabs", "similarityBoost"]) as number) ?? 0.75;
  const style = (get(doc, ["elevenlabs", "style"]) as number) ?? 0;
  const speed = (get(doc, ["elevenlabs", "speed"]) as number) ?? 1;
  const useSpeakerBoost = (get(doc, ["elevenlabs", "useSpeakerBoost"]) as boolean) ?? true;

  const systemPrompt = (get(doc, ["script", "systemPrompt"]) as string) ?? "";
  const slideStructureNotes = (get(doc, ["script", "slideStructureNotes"]) as string) ?? "";

  const useIterativeContent = (get(doc, ["pipeline", "useIterativeContent"]) as boolean) ?? false;
  const enableCritic = (get(doc, ["pipeline", "enableCritic"]) as boolean) ?? false;
  const enableDesignValidation = (get(doc, ["pipeline", "enableDesignValidation"]) as boolean) ?? false;
  const useTemplateEngine = (get(doc, ["pipeline", "useTemplateEngine"]) as boolean) ?? false;
  const enableImageQueryGeneration = (get(doc, ["pipeline", "enableImageQueryGeneration"]) as boolean) ?? false;

  const update = (path: string[], value: unknown) =>
    setDoc((prev) => (prev ? setPath(prev, path, value) : prev));

  const handleSave = () => {
    if (showRaw) {
      try {
        const parsed = JSON.parse(rawText);
        setRawError(null);
        save.mutate(parsed);
        setDoc(parsed);
      } catch (e) {
        setRawError((e as Error).message);
      }
    } else {
      save.mutate(doc);
    }
  };

  const handleRevert = () => {
    if (q.data) {
      setDoc(q.data as Record<string, unknown>);
      setRawText(JSON.stringify(q.data, null, 2));
      setRawError(null);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-xl font-semibold">{name}</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={showRaw}
              onChange={(e) => {
                setShowRaw(e.target.checked);
                if (e.target.checked) setRawText(JSON.stringify(doc, null, 2));
              }}
            />
            Show raw JSON
          </label>
          {dirty && (
            <span className="px-2 py-0.5 text-xs rounded bg-amber-600/30 text-amber-300 border border-amber-700/50">
              Modified
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {showRaw ? (
          <div className="p-4">
            {rawError && (
              <div className="mb-2 p-3 rounded bg-red-950/60 border border-red-800 text-red-300 text-sm font-mono">
                Invalid JSON: {rawError}
              </div>
            )}
            <CodeEditor
              value={rawText}
              language="json"
              onChange={(e) => {
                setRawText(e.target.value);
                try {
                  JSON.parse(e.target.value);
                  setRawError(null);
                } catch (err) {
                  setRawError((err as Error).message);
                }
              }}
              padding={16}
              minHeight={500}
              style={{
                fontSize: 13,
                backgroundColor: "rgb(15 23 42)",
                fontFamily: "ui-monospace, monospace",
              }}
              data-color-mode="dark"
            />
          </div>
        ) : (
          <div className="p-6 space-y-6 max-w-3xl">
            <Field label="Speaker identity">
              <textarea
                className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-sm"
                rows={2}
                value={speakerIdentity}
                onChange={(e) => update(["script", "speakerIdentity"], e.target.value)}
              />
            </Field>
            <Field label="Target audience">
              <textarea
                className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-sm"
                rows={2}
                value={targetAudience}
                onChange={(e) => update(["script", "targetAudience"], e.target.value)}
              />
            </Field>
            <Field label="Duration (minutes)">
              <input
                type="number"
                min={1}
                max={60}
                className="w-32 px-3 py-2 rounded bg-slate-900 border border-slate-700 text-sm"
                value={durationMinutes}
                onChange={(e) => update(["script", "durationMinutes"], Number(e.target.value))}
              />
            </Field>

            <Field label="Context files">
              <StringList
                items={contextFiles}
                onChange={(next) => update(["script", "contextFiles"], next)}
                placeholder="e.g. ozymandias.txt"
              />
            </Field>

            <Field label="Phonetics overrides">
              <PhoneticsList
                items={phonetics}
                onChange={(next) => update(["script", "phoneticsOverrides"], next)}
              />
            </Field>

            <Field label="System Prompt">
              <p className="text-xs text-slate-500 mb-1">
                Top-level narration charter. Also editable on the Prompts page.
              </p>
              <textarea
                className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-sm font-mono"
                rows={12}
                value={systemPrompt}
                onChange={(e) => update(["script", "systemPrompt"], e.target.value)}
              />
            </Field>

            <Field label="Slide Structure Notes">
              <p className="text-xs text-slate-500 mb-1">
                File path — edit content on the Prompts page
              </p>
              <input
                className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-sm text-slate-400"
                value={slideStructureNotes}
                readOnly
              />
            </Field>

            {/* ── ElevenLabs ────────────────────────────────────────── */}
            <h3 className="text-sm font-semibold text-slate-300 pt-4 border-t border-slate-800">
              ElevenLabs
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Voice ID">
                <input
                  className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-sm"
                  value={voiceId}
                  onChange={(e) => update(["elevenlabs", "voiceId"], e.target.value)}
                />
              </Field>
              <Field label="Model ID">
                <input
                  className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-sm"
                  value={modelId}
                  onChange={(e) => update(["elevenlabs", "modelId"], e.target.value)}
                />
              </Field>
            </div>

            <RangeField
              label="Stability"
              value={stability}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => update(["elevenlabs", "stability"], v)}
            />
            <RangeField
              label="Similarity Boost"
              value={similarityBoost}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => update(["elevenlabs", "similarityBoost"], v)}
            />
            <RangeField
              label="Style"
              value={style}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => update(["elevenlabs", "style"], v)}
            />
            <RangeField
              label="Speed"
              value={speed}
              min={0.5}
              max={2}
              step={0.05}
              onChange={(v) => update(["elevenlabs", "speed"], v)}
            />

            <Field label="Speaker Boost">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={useSpeakerBoost}
                  onChange={(e) => update(["elevenlabs", "useSpeakerBoost"], e.target.checked)}
                />
                Enhance clarity and presence
              </label>
            </Field>

            {/* ── Pipeline ──────────────────────────────────────────── */}
            <h3 className="text-sm font-semibold text-slate-300 pt-4 border-t border-slate-800">
              Pipeline
            </h3>

            <div className="space-y-3">
              <Toggle
                label="Iterative content (multi-step narration → slides instead of single-shot)"
                checked={useIterativeContent}
                onChange={(v) => update(["pipeline", "useIterativeContent"], v)}
              />
              <Toggle
                label="Critic pass (review slides for coverage gaps)"
                checked={enableCritic}
                onChange={(v) => update(["pipeline", "enableCritic"], v)}
              />
              <Toggle
                label="Design validation (check slides against layout constraints)"
                checked={enableDesignValidation}
                onChange={(v) => update(["pipeline", "enableDesignValidation"], v)}
              />
              <Toggle
                label="Template engine (use designer PPTX template)"
                checked={useTemplateEngine}
                onChange={(v) => update(["pipeline", "useTemplateEngine"], v)}
              />
              <Toggle
                label="Image query refinement (LLM-refined Unsplash queries)"
                checked={enableImageQueryGeneration}
                onChange={(v) => update(["pipeline", "enableImageQueryGeneration"], v)}
              />
            </div>
          </div>
        )}
      </div>

      <div className="px-6 py-3 border-t border-slate-800 flex gap-3 justify-end bg-slate-900">
        <button
          className="px-4 py-2 rounded text-sm bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40"
          disabled={!dirty || save.isPending}
          onClick={handleRevert}
        >
          Revert
        </button>
        <button
          className="px-4 py-2 rounded text-sm bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40"
          disabled={save.isPending || (showRaw && !!rawError)}
          onClick={handleSave}
        >
          {save.isPending ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function StringList({
  items,
  onChange,
  placeholder,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="space-y-2">
      {items.map((v, i) => (
        <div key={i} className="flex gap-2">
          <input
            className="flex-1 px-3 py-2 rounded bg-slate-900 border border-slate-700 text-sm"
            value={v}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <button
            className="px-3 py-2 rounded bg-red-900/40 text-red-300 text-sm hover:bg-red-900/60"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          className="flex-1 px-3 py-2 rounded bg-slate-900 border border-slate-700 text-sm"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          className="px-3 py-2 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-500 disabled:opacity-40"
          disabled={!draft.trim()}
          onClick={() => {
            onChange([...items, draft.trim()]);
            setDraft("");
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-indigo-500"
        />
        <span className="w-12 text-right text-sm tabular-nums text-slate-300">
          {value.toFixed(step < 0.1 ? 2 : 2)}
        </span>
      </div>
    </Field>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function PhoneticsList({
  items,
  onChange,
}: {
  items: Phonetic[];
  onChange: (next: Phonetic[]) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  return (
    <div className="space-y-2">
      {items.map((p, i) => (
        <div key={i} className="flex gap-2">
          <input
            className="flex-1 px-3 py-2 rounded bg-slate-900 border border-slate-700 text-sm"
            value={p.from}
            onChange={(e) => {
              const next = [...items];
              next[i] = { ...p, from: e.target.value };
              onChange(next);
            }}
          />
          <span className="px-2 self-center text-slate-500">→</span>
          <input
            className="flex-1 px-3 py-2 rounded bg-slate-900 border border-slate-700 text-sm"
            value={p.to}
            onChange={(e) => {
              const next = [...items];
              next[i] = { ...p, to: e.target.value };
              onChange(next);
            }}
          />
          <button
            className="px-3 py-2 rounded bg-red-900/40 text-red-300 text-sm hover:bg-red-900/60"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          className="flex-1 px-3 py-2 rounded bg-slate-900 border border-slate-700 text-sm"
          placeholder="from"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span className="px-2 self-center text-slate-500">→</span>
        <input
          className="flex-1 px-3 py-2 rounded bg-slate-900 border border-slate-700 text-sm"
          placeholder="to"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <button
          className="px-3 py-2 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-500 disabled:opacity-40"
          disabled={!from.trim() || !to.trim()}
          onClick={() => {
            onChange([...items, { from: from.trim(), to: to.trim() }]);
            setFrom("");
            setTo("");
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
