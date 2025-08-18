/* src/components/layout/AppShell.tsx */
import React from "react";
import Sidebar from "./Sidebar";
import Header from "./Header";

const AppShell: React.FC<React.PropsWithChildren> = ({ children }) => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 text-slate-900">
      <div className="flex">
        {/* Sidebar fixa à esquerda */}
        <Sidebar />
        {/* Área principal ocupa todo o restante, sem largura máxima */}
        <div className="flex-1 min-w-0">
          <Header />
          <main className="px-6 py-6">
            {/* Removido max-w; o conteúdo agora usa 100% da largura disponível */}
            <div className="w-full">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
};

export default AppShell;
