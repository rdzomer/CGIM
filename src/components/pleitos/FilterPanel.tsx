// src/components/pleitos/FilterPanel.tsx
import React from "react";
import { usePleitos } from "../../contexts/PleitosContext";

const FilterPanel: React.FC = () => {
  const { busca, setBusca } = usePleitos();

  return (
    <div className="mb-3 flex gap-2">
      <input
        value={busca ?? ""}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar pleitos..."
        className="border rounded px-3 py-2 w-full"
      />
    </div>
  );
};

export default FilterPanel;
