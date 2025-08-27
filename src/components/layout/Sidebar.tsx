/* src/components/layout/Sidebar.tsx */
import React from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, FileText, History, ListChecks, Settings } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";

const Sidebar: React.FC = () => {
  const { user } = useAuth();
  const linkBase =
    "flex items-center gap-3 px-5 py-3 rounded-xl text-base font-medium hover:bg-white/70 transition";
  const active = "bg-white shadow-sm text-indigo-700";

  return (
    <aside
      className="
        hidden md:flex md:flex-col
        h-screen sticky top-0
        border-r bg-white/70 backdrop-blur
        shrink-0 w-80 lg:w-[360px]
      "
      style={{ width: 360 }}
    >
      <div className="p-6 border-b">
        <div className="text-2xl font-semibold tracking-tight">CGIM</div>
        <div className="mt-1 text-sm text-slate-600 truncate">{user?.nome || "Usuário"}</div>
        <div className="text-xs text-slate-500 truncate">{user?.email || ""}</div>
      </div>

      <nav className="p-4 space-y-1">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `${linkBase} ${isActive ? active : "text-slate-700"}`}
        >
          <LayoutDashboard className="h-5 w-5" />
          <span>Dashboard</span>
        </NavLink>

        <NavLink
          to="/pauta"
          className={({ isActive }) => `${linkBase} ${isActive ? active : "text-slate-700"}`}
        >
          <FileText className="h-5 w-5" />
          <span>Pauta CAT</span>
        </NavLink>

        <NavLink
          to="/relatorio"
          className={({ isActive }) => `${linkBase} ${isActive ? active : "text-slate-700"}`}
        >
          <FileText className="h-5 w-5" />
          <span>Relatório</span>
        </NavLink>

        <NavLink
          to="/historico"
          className={({ isActive }) => `${linkBase} ${isActive ? active : "text-slate-700"}`}
        >
          <History className="h-5 w-5" />
          <span>Histórico de Pautas</span>
        </NavLink>

        <NavLink
          to="/minhas-tarefas"
          className={({ isActive }) => `${linkBase} ${isActive ? active : "text-slate-700"}`}
        >
          <ListChecks className="h-5 w-5" />
          <span>Minhas Tarefas</span>
        </NavLink>

        <NavLink
          to="/configuracoes"
          className={({ isActive }) => `${linkBase} ${isActive ? active : "text-slate-700"}`}
        >
          <Settings className="h-5 w-5" />
          <span>Configurações</span>
        </NavLink>
      </nav>

      <div className="mt-auto p-4 text-xs text-slate-400">
        © {new Date().getFullYear()} CGIM
      </div>
    </aside>
  );
};

export default Sidebar;
