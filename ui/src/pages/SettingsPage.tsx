import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getSettings, getDeps, saveKeys } from "../lib/api";
import { useSearchParams } from "react-router-dom";

const KEY_FIELDS = [
  { name: "anthropicApiKey", label: "Anthropic API Key", hint: "Required unless using OpenRouter" },
  { name: "openrouterApiKey", label: "OpenRouter API Key", hint: "Alternative to Anthropic" },
  { name: "elevenlabsApiKey", label: "ElevenLabs API Key", hint: "Required — for text-to-speech" },
  { name: "unsplashAccessKey", label: "Unsplash Access Key", hint: "Optional — for slide images" },
] as const;

function StatusBadge({ configured }: { configured: boolean }) {
  return configured ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400">
      Configured
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400">
      Not configured
    </span>
  );
}

function DepStatus({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm">{label}</span>
      {ok ? (
        <span className="text-green-400 text-sm font-medium">✓ Installed</span>
      ) : (
        <span className="text-red-400 text-sm font-medium">✗ Missing</span>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [searchParams] = useSearchParams();
  const showWelcome = searchParams.get("welcome") === "1";
  const qc = useQueryClient();

  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const settings = settingsQ.data;

  const [keyValues, setKeyValues] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(keyValues)) {
      if (v.trim()) payload[k] = v.trim();
    }
    if (Object.keys(payload).length === 0) {
      toast.error("No keys to save");
      return;
    }
    setSaving(true);
    try {
      await saveKeys(payload);
      toast.success("API keys saved");
      setKeyValues({});
      await qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const recheckDeps = async () => {
    try {
      const deps = await getDeps();
      qc.setQueryData(["settings"], (prev: typeof settings) =>
        prev ? { ...prev, deps } : prev
      );
      toast.success("Dependencies re-checked");
    } catch {
      toast.error("Re-check failed");
    }
  };

  if (settingsQ.isLoading) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="text-slate-400 text-sm">Loading settings…</div>
      </div>
    );
  }

  if (settingsQ.isError || !settings) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="text-red-400 text-sm">
          Failed to load settings: {(settingsQ.error as Error)?.message ?? "Unknown error"}
        </div>
      </div>
    );
  }

  const libreOfficeMissing = settings.deps.libreoffice === false;
  const ffmpegMissing = settings.deps.ffmpeg === false;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8 overflow-auto h-full">
      <h1 className="text-2xl font-semibold">Settings</h1>

      {showWelcome && (
        <div className="rounded-md border border-indigo-700 bg-indigo-900/30 p-4 text-indigo-200">
          <div className="font-semibold mb-1">Welcome!</div>
          <p className="text-sm">Configure your API keys to get started.</p>
        </div>
      )}

      {/* ── API Keys ── */}
      <section className="space-y-4">
        <h2 className="text-sm uppercase tracking-wider text-slate-400 font-semibold">
          API Keys
        </h2>
        <div className="space-y-3">
          {KEY_FIELDS.map((f) => (
            <div key={f.name} className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">{f.label}</label>
                <StatusBadge configured={!!settings.keys[f.name]} />
              </div>
              <div className="relative">
                <input
                  type={visible[f.name] ? "text" : "password"}
                  className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-sm font-mono pr-16"
                  placeholder={settings.keys[f.name] ? "••••••••  (leave blank to keep)" : "Paste key here"}
                  value={keyValues[f.name] ?? ""}
                  onChange={(e) =>
                    setKeyValues((prev) => ({ ...prev, [f.name]: e.target.value }))
                  }
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-200 px-2 py-1"
                  onClick={() =>
                    setVisible((prev) => ({ ...prev, [f.name]: !prev[f.name] }))
                  }
                >
                  {visible[f.name] ? "Hide" : "Show"}
                </button>
              </div>
              <p className="text-xs text-slate-500">{f.hint}</p>
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <button
            className="px-5 py-2 rounded bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? "Saving…" : "Save Keys"}
          </button>
        </div>
      </section>

      {/* ── System Dependencies ── */}
      <section className="space-y-4">
        <h2 className="text-sm uppercase tracking-wider text-slate-400 font-semibold">
          System Dependencies
        </h2>
        <div className="divide-y divide-slate-800">
          <DepStatus ok={!!settings.deps.ffmpeg} label="ffmpeg" />
          <DepStatus ok={!!settings.deps.ffprobe} label="ffprobe" />
          <DepStatus ok={!!settings.deps.libreoffice} label="LibreOffice" />
        </div>

        {libreOfficeMissing && (
          <div className="rounded-md border border-red-700 bg-red-900/30 p-4 space-y-2">
            <div className="text-red-300 font-semibold text-sm">LibreOffice is required</div>
            <p className="text-red-200 text-sm">{settings.libreOfficeInstallHint}</p>
            <div className="flex items-center gap-3">
              <a
                href={settings.libreOfficeInstallUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm underline text-red-300 hover:text-red-100"
              >
                Download LibreOffice
              </a>
              <button
                className="text-sm px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
                onClick={recheckDeps}
              >
                Re-check
              </button>
            </div>
          </div>
        )}

        {ffmpegMissing && (
          <div className="rounded-md border border-red-700 bg-red-900/30 p-4 space-y-2">
            <div className="text-red-300 font-semibold text-sm">ffmpeg is missing</div>
            <p className="text-red-200 text-sm">
              ffmpeg is required for video processing. Install it via your system package manager.
            </p>
            <button
              className="text-sm px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
              onClick={recheckDeps}
            >
              Re-check
            </button>
          </div>
        )}

        {!libreOfficeMissing && !ffmpegMissing && (
          <button
            className="text-sm px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
            onClick={recheckDeps}
          >
            Re-check dependencies
          </button>
        )}
      </section>

      {/* ── Output Folder ── */}
      <section className="space-y-4">
        <h2 className="text-sm uppercase tracking-wider text-slate-400 font-semibold">
          Output Folder
        </h2>
        <div className="flex items-center gap-3">
          <code className="flex-1 px-3 py-2 rounded bg-slate-900 border border-slate-700 text-sm font-mono text-slate-300 truncate">
            {settings.outputPath}
          </code>
          {window.electronAPI ? (
            <button
              className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-200"
              onClick={async () => {
                const folder = await window.electronAPI!.selectFolder();
                if (folder) {
                  toast.success(`Output folder set to ${folder}`);
                  await qc.invalidateQueries({ queryKey: ["settings"] });
                }
              }}
            >
              Change
            </button>
          ) : (
            <span className="text-xs text-slate-500">
              Set via LIVAI_OUTPUT_DIR env var
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
