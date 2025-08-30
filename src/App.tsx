import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import DashboardPage from "./pages/DashboardPage";
import MinhasTarefasPage from "./pages/MinhasTarefasPage";
import AnalisePleitoPage from "./pages/AnalisePleitoPage";
// import VisualizarPautaPage from "./pages/VisualizarPautaPage"; // ❌ não usamos mais
import HistoricoPautasPage from "./pages/HistoricoPautasPage";
import ConfiguracoesPage from "./pages/ConfiguracoesPage";
import RelatorioConsolidadoPage from "./pages/RelatorioConsolidadoPage";
import LoginPage from "./pages/LoginPage";
import { useAuth } from "./contexts/AuthContext";
import PautaCatPage from "./pages/PautaCatPage"; // ✅ sua página robusta de extração
import NcmSearchPage from "./pages/NcmSearchPage"; // ✅ NOVO

const Private: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-6 text-slate-600">Carregando…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/"
          element={
            <Private>
              <AppShell>
                <DashboardPage />
              </AppShell>
            </Private>
          }
        />

        {/* ✅ Pauta CAT = EXTRAÇÃO */}
        <Route
          path="/pauta"
          element={
            <Private>
              <AppShell>
                <PautaCatPage />
              </AppShell>
            </Private>
          }
        />

        <Route
          path="/minhas-tarefas"
          element={
            <Private>
              <AppShell>
                <MinhasTarefasPage />
              </AppShell>
            </Private>
          }
        />

        <Route
          path="/analise/:atrId"
          element={
            <Private>
              <AppShell>
                <AnalisePleitoPage />
              </AppShell>
            </Private>
          }
        />

        <Route
          path="/relatorio"
          element={
            <Private>
              <AppShell>
                <RelatorioConsolidadoPage />
              </AppShell>
            </Private>
          }
        />

        <Route
          path="/historico"
          element={
            <Private>
              <AppShell>
                <HistoricoPautasPage />
              </AppShell>
            </Private>
          }
        />

        {/* ✅ NOVO: Consulta NCM */}
        <Route
          path="/consulta-ncm"
          element={
            <Private>
              <AppShell>
                <NcmSearchPage />
              </AppShell>
            </Private>
          }
        />

        <Route path="/configuracoes"
          element={
            <Private>
              <AppShell>
                <ConfiguracoesPage />
              </AppShell>
            </Private>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
