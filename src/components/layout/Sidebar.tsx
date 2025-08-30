import React from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  FileText,
  History,
  ListChecks,
  Settings,
  Search,
} from "lucide-react";

const Sidebar: React.FC = () => {
  const base =
    "flex items-center gap-3 px-5 py-3 rounded-xl text-base font-medium transition hover:bg-white/70";
  const active = "bg-white shadow-sm text-indigo-700";

  return (
    <aside className="hidden md:flex md:flex-col h-screen sticky top-0 w-[300px] border-r bg-white/70 backdrop-blur">
      {/* Cabeçalho */}
      <div className="p-6 border-b">
        <div className="text-2xl font-semibold tracking-tight">CGIM — Pleitos</div>
        <div className="text-xs text-slate-500">Administração de pautas e análises</div>
      </div>

      {/* Navegação */}
      <nav className="flex-1 p-4 space-y-1">
        <NavLink to="/" end className={({ isActive }) => `${base} ${isActive ? active : ""}`}>
          <LayoutDashboard className="h-5 w-5" />
          <span>Dashboard</span>
        </NavLink>

        <NavLink to="/pauta" className={({ isActive }) => `${base} ${isActive ? active : ""}`}>
          <FileText className="h-5 w-5" />
          <span>Pauta CAT</span>
        </NavLink>

        <NavLink to="/minhas-tarefas" className={({ isActive }) => `${base} ${isActive ? active : ""}`}>
          <ListChecks className="h-5 w-5" />
          <span>Minhas Tarefas</span>
        </NavLink>

        <NavLink to="/relatorio" className={({ isActive }) => `${base} ${isActive ? active : ""}`}>
          <FileText className="h-5 w-5" />
          <span>Relatório</span>
        </NavLink>

        <NavLink to="/historico" className={({ isActive }) => `${base} ${isActive ? active : ""}`}>
          <History className="h-5 w-5" />
          <span>Histórico de Pautas</span>
        </NavLink>

        {/* Consulta por NCM */}
        <NavLink to="/consulta-ncm" className={({ isActive }) => `${base} ${isActive ? active : ""}`}>
          <Search className="h-5 w-5" />
          <span>Consulta por NCM</span>
        </NavLink>
      </nav>

      {/* Rodapé com Configurações */}
      <div className="p-4 border-t">
        <NavLink to="/configuracoes" className={({ isActive }) => `${base} ${isActive ? active : ""}`}>
          <Settings className="h-5 w-5" />
          <span>Configurações</span>
        </NavLink>
      </div>
    </aside>
  );
};

export default Sidebar;
