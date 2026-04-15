import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";
import ConfigEditor from "../components/ConfigEditor";

export default function ConfigsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const q = useQuery({ queryKey: ["configs"], queryFn: api.listConfigs });

  const del = useMutation({
    mutationFn: (name: string) => api.deleteConfig(name),
    onSuccess: (_d, name) => {
      toast.success(`Deleted ${name}`);
      qc.invalidateQueries({ queryKey: ["configs"] });
      if (selected === name) setSelected(null);
      setConfirmDelete(null);
    },
    onError: (e: Error) => toast.error(`Delete failed: ${e.message}`),
  });

  return (
    <div className="h-full flex overflow-hidden">
      <aside className="w-96 flex flex-col border-r border-slate-800 bg-slate-900/50 overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-sm uppercase tracking-wider text-slate-400 font-semibold">
            Presets
          </h2>
          <button
            className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-500"
            onClick={() => setShowNew(true)}
          >
            New
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {q.isLoading && <div className="p-4 text-slate-400">Loading...</div>}
          {q.isError && <div className="p-4 text-red-400">{(q.error as Error).message}</div>}
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-4 py-2">Modified</th>
                <th className="text-right px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((c) => {
                const isDefault = c.name === "default";
                return (
                  <tr
                    key={c.name}
                    className={[
                      "border-t border-slate-800 cursor-pointer hover:bg-slate-800/40",
                      selected === c.name ? "bg-indigo-900/20" : "",
                    ].join(" ")}
                    onClick={() => setSelected(c.name)}
                  >
                    <td className="px-4 py-2 font-mono">{c.name}</td>
                    <td className="px-4 py-2 text-slate-400 text-xs">
                      {c.mtime ? new Date(c.mtime).toLocaleString() : ""}
                    </td>
                    <td
                      className="px-4 py-2 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="px-2 py-1 text-xs rounded bg-red-900/40 text-red-300 hover:bg-red-900/60 disabled:opacity-30 disabled:cursor-not-allowed"
                        disabled={isDefault}
                        title={isDefault ? "Cannot delete the default preset." : undefined}
                        onClick={() => setConfirmDelete(c.name)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </aside>

      <section className="flex-1 overflow-hidden">
        {selected ? (
          <ConfigEditor name={selected} key={selected} />
        ) : (
          <div className="h-full flex items-center justify-center text-slate-500">
            Select a preset to edit
          </div>
        )}
      </section>

      {showNew && (
        <NewPresetModal
          existing={(q.data ?? []).map((c) => c.name)}
          onClose={() => setShowNew(false)}
          onCreated={(name) => {
            setShowNew(false);
            qc.invalidateQueries({ queryKey: ["configs"] });
            setSelected(name);
          }}
        />
      )}

      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(null)}>
          <h3 className="text-lg font-semibold mb-3">Delete preset?</h3>
          <p className="text-slate-300 mb-4">
            This will permanently delete{" "}
            <code className="px-1.5 py-0.5 bg-slate-800 rounded">{confirmDelete}</code>.
          </p>
          <div className="flex gap-2 justify-end">
            <button
              className="px-4 py-2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm"
              onClick={() => setConfirmDelete(null)}
            >
              Cancel
            </button>
            <button
              className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-500 text-sm"
              onClick={() => del.mutate(confirmDelete)}
              disabled={del.isPending}
            >
              {del.isPending ? "Deleting..." : "Delete"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function NewPresetModal({
  existing,
  onClose,
  onCreated,
}: {
  existing: string[];
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [from, setFrom] = useState(existing[0] ?? "default");
  const validName = /^[a-z0-9-_]+$/i.test(name) && !existing.includes(name);

  const create = useMutation({
    mutationFn: () => api.createConfig(name, from),
    onSuccess: () => {
      toast.success(`Created ${name}`);
      onCreated(name);
    },
    onError: (e: Error) => toast.error(`Create failed: ${e.message}`),
  });

  return (
    <Modal onClose={onClose}>
      <h3 className="text-lg font-semibold mb-4">New preset</h3>
      <div className="space-y-3">
        <div>
          <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
            Name
          </label>
          <input
            className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-sm"
            placeholder="e.g. macbeth-draft"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          {name && !validName && (
            <div className="mt-1 text-xs text-red-400">
              {existing.includes(name)
                ? "Name already exists"
                : "Allowed: letters, numbers, - and _"}
            </div>
          )}
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
            Clone from
          </label>
          <select
            className="w-full px-3 py-2 rounded bg-slate-900 border border-slate-700 text-sm"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          >
            {existing.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-5 flex gap-2 justify-end">
        <button
          className="px-4 py-2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-500 text-sm disabled:opacity-40"
          disabled={!validName || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "Creating..." : "Create"}
        </button>
      </div>
    </Modal>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-lg p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
