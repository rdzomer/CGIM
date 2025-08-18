// src/components/ExcluirPautaButton.tsx
import React, { useState } from "react";
import toast from "react-hot-toast";
import { deletePauta } from "../services/adminPautasService";

type Props = {
  pautaId: string;
  titulo?: string; // só para exibir no confirm
  onDeleted?: () => void; // recarregar lista após remoção
};

const ExcluirPautaButton: React.FC<Props> = ({ pautaId, titulo, onDeleted }) => {
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!pautaId) return;

    const baseMsg = `Deseja realmente excluir esta pauta${
      titulo ? `:\n\n${titulo}\n` : ""
    }?\n\n`;
    const cascade = window.confirm(
      baseMsg +
        "Clique em OK para EXCLUIR TUDO (pauta + atribuições relacionadas).\n" +
        "Clique em Cancelar para excluir apenas a pauta."
    );

    try {
      setLoading(true);
      await deletePauta(pautaId, { cascadeAtribuicoes: cascade });
      toast.success(
        cascade ? "Pauta e atribuições excluídas." : "Pauta excluída."
      );
      onDeleted?.();
    } catch (e: any) {
      console.error(e);
      toast.error("Falha ao excluir pauta.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="px-2 py-1 text-sm rounded border border-red-600 text-red-700 hover:bg-red-50 disabled:opacity-60"
      title="Excluir pauta"
    >
      {loading ? "Excluindo..." : "excluir"}
    </button>
  );
};

export default ExcluirPautaButton;
