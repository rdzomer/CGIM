import React from "react";
import Sidebar from "./Sidebar";
import { useAuth } from "../../contexts/AuthContext";
import LogoutButton from "../../LogoutButton";

/**
 * Shell de layout: Sidebar fixo + topo simples e o conteúdo das páginas.
 * Não limita largura do conteúdo (w-full), para o Relatório ocupar a página toda.
 */
const AppShell: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { user } = useAuth();

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Lateral */}
      <Sidebar />

      {/* Conteúdo */}
      <div className="flex-1 flex flex-col">
        {/* Topbar enxuta */}
        <header className="flex items-center justify-end gap-3 h-14 px-4 border-b bg-white/70 backdrop-blur">
          <span className="text-sm text-slate-600">{user?.email ?? ""}</span>
          <LogoutButton />
        </header>

        {/* Área principal — sem max-w, ocupa largura total */}
        <main className="flex-1 p-4 md:p-6 w-full">{children}</main>
      </div>
    </div>
  );
};

export default AppShell;
