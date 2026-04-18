import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import Layout from "./components/Layout";
import PromptsPage from "./pages/PromptsPage";
import ConfigsPage from "./pages/ConfigsPage";
import RunPage from "./pages/RunPage";
import SettingsPage from "./pages/SettingsPage";
import { getSettings } from "./lib/api";

function FirstRunGuard({ children }: { children: React.ReactNode }) {
  const nav = useNavigate();
  const location = useLocation();
  const settingsQ = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!settingsQ.data) return;
    const keys = settingsQ.data.keys;
    const hasLlm = keys.anthropicApiKey || keys.openrouterApiKey;
    const hasTts = keys.elevenlabsApiKey;
    if (!hasLlm && !hasTts && location.pathname !== "/settings") {
      nav("/settings?welcome=1", { replace: true });
    }
  }, [settingsQ.data, location.pathname, nav]);

  return <>{children}</>;
}

export default function App() {
  return (
    <FirstRunGuard>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/prompts" replace />} />
          <Route path="prompts" element={<PromptsPage />} />
          <Route path="configs" element={<ConfigsPage />} />
          <Route path="run" element={<RunPage />} />
          <Route path="run/:runId" element={<RunPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/prompts" replace />} />
        </Route>
      </Routes>
    </FirstRunGuard>
  );
}
