import { NavLink, Outlet } from "react-router-dom";

const navClass = ({ isActive }: { isActive: boolean }) =>
  [
    "px-4 py-2 rounded-md text-sm font-medium transition-colors",
    isActive
      ? "bg-indigo-600 text-white"
      : "text-slate-300 hover:bg-slate-800 hover:text-white",
  ].join(" ");

export default function Layout() {
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
            <NavLink to="/run" className={navClass}>
              Run
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
