import React, { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import { useAuth } from "./contexts/AuthContext";

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const MinhasTarefasPage = lazy(() => import("./pages/MinhasTarefasPage"));
const AnalisePleitoPage = lazy(() => import("./pages/AnalisePleitoPage"));
const HistoricoPautasPage = lazy(() => import("./pages/HistoricoPautasPage"));
const ConfiguracoesPage = lazy(() => import("./pages/ConfiguracoesPage"));
const RelatorioConsolidadoPage = lazy(() => import("./pages/RelatorioConsolidadoPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const PautaCatPage = lazy(() => import("./pages/PautaCatPage"));
const NcmSearchPage = lazy(() => import("./pages/NcmSearchPage"));

const Private: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-6 text-slate-600">Carregando…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="p-6 text-slate-600 flex justify-center items-center min-h-screen">Carregando página...</div>}>
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
      </Suspense>
    </BrowserRouter>
  );
};

export default App;
