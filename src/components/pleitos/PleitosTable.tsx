// src/components/pleitos/PleitosTable.tsx
import React, { useMemo } from "react";
import { usePleitos } from "../../contexts/PleitosContext";

const PleitosTable: React.FC = () => {
  const { pleitos, busca } = usePleitos();

  const rows = useMemo(() => {
    const b = (busca || "").toLowerCase();
    const list = Array.isArray(pleitos) ? pleitos : [];
    if (!b) return list;
    return list.filter((p) => JSON.stringify(p).toLowerCase().includes(b));
  }, [pleitos, busca]);

  return (
    <div className="overflow-x-auto bg-white border rounded">
      <table className="min-w-full">
        <thead>
          <tr className="bg-gray-100">
            <th className="text-left px-4 py-2">NCM</th>
            <th className="text-left px-4 py-2">Descrição</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any, i: number) => (
            <tr key={i} className="border-t">
              <td className="px-4 py-2">{r.ncm || "—"}</td>
              <td className="px-4 py-2">{r.descricao || "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={2} className="px-4 py-6 text-center text-gray-500">
                Nenhum pleito encontrado.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default PleitosTable;
