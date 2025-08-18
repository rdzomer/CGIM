// src/components/layout/Header.tsx
import React from "react";
import { useAuth } from "../../contexts/AuthContext";
import { getAuth, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";

const Header: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut(getAuth());
    navigate("/login");
  };

  return (
    <header className="sticky top-0 z-30 bg-white/70 backdrop-blur border-b">
      <div className="px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-indigo-600 text-white grid place-items-center font-bold">
            C
          </div>
          <div>
            <div className="font-semibold leading-tight">
              CGIM — Gestão de Pleitos
            </div>
            <div className="text-xs text-slate-500">
              Administração de pautas e análises
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {user && (
            <div className="hidden sm:block text-sm text-slate-600">
              {user.email}
            </div>
          )}
          <button
            onClick={handleLogout}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 text-white hover:bg-red-700"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
