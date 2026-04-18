import { NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

const navClass = ({ isActive }: { isActive: boolean }) =>
  [
    "px-4 py-2 rounded-md text-sm font-medium transition-colors",
    isActive
      ? "bg-indigo-600 text-white"
      : "text-slate-300 hover:bg-slate-800 hover:text-white",
  ].join(" ");

export default function Layout() {
  const { data: runs } = useQuery({
    queryKey: ["runs"],
    queryFn: () => api.listRuns(),
    refetchInterval: 30_000,
  });

  const activeRun = runs?.find((r) => r.status === "running");
  const runLink = activeRun ? `/run/${activeRun.id}` : "/run";

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-slate-800 bg-slate-900">
        <div className="max-w-full px-6 py-3 flex items-center gap-6">
          <div className="text-slate-100 font-semibold tracking-tight">
            liv-ai-scripts
          </div>
          <nav className="flex gap-1">
            <NavLink to="/prompts" className={navClass}>
              Prompts
            </NavLink>
            <NavLink to="/configs" className={navClass}>
              Configs
            </NavLink>
            <NavLink to={runLink} className={navClass}>
              <span className="flex items-center gap-2">
                Run
                {activeRun && (
                  <>
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-green-400 text-xs">Running…</span>
                  </>
                )}
              </span>
            </NavLink>
            <NavLink to="/settings" className={navClass}>
              Settings
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
