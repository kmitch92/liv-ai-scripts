import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import PromptsPage from "./pages/PromptsPage";
import ConfigsPage from "./pages/ConfigsPage";
import RunPage from "./pages/RunPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/prompts" replace />} />
        <Route path="prompts" element={<PromptsPage />} />
        <Route path="configs" element={<ConfigsPage />} />
        <Route path="run" element={<RunPage />} />
        <Route path="run/:runId" element={<RunPage />} />
        <Route path="*" element={<Navigate to="/prompts" replace />} />
      </Route>
    </Routes>
  );
}
