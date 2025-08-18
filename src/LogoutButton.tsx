// src/components/LogoutButton.tsx
import React from "react";
import { getAuth, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

const LogoutButton: React.FC = () => {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await signOut(getAuth());
      toast.success("Você saiu da sua conta.");
      navigate("/login");
    } catch (error: any) {
      console.error(error);
      toast.error("Falha ao sair. Tente novamente.");
    }
  };

  return (
    <button
      onClick={handleLogout}
      className="px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700"
    >
      Sair
    </button>
  );
};

export default LogoutButton;
