// src/pages/VisualizarPautaPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getFirestore, doc, getDoc } from "firebase/firestore";

type Pauta = {
  meeting?: string;
  sections?: { title: string; rows?: any[] }[];
};

const VisualizarPautaPage: React.FC = () => {
  const { pautaId } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();

  const [pauta, setPauta] = useState<Pauta | null>(null);
  const [filtroSecao, setFiltroSecao] = useState<string>("");

  useEffect(() => {
    const s = sp.get("secao") || "";
    setFiltroSecao(s);
  }, [sp]);

  useEffect(() => {
    (async () => {
      if (!pautaId) return;
      const snap = await getDoc(doc(getFirestore(), "pautas", pautaId));
      setPauta((snap.data() as any) || null);
    })();
  }, [pautaId]);

  const secoesFiltradas = useMemo(() => {
    if (!pauta?.sections?.length) return [];
    const q = (filtroSecao || "").trim().toLowerCase();
    if (!q) return pauta.sections;
    return pauta.sections.filter((s) => s.title?.toLowerCase().includes(q));
  }, [pauta, filtroSecao]);

  return (
    <div className="p-2 md:p-4 lg:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Pauta (visualização)</h1>
          <div className="text-sm text-slate-600 mt-1">{pauta?.meeting || "—"}</div>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={filtroSecao}
            onChange={(e) => setFiltroSecao(e.target.value)}
            className="border rounded-xl px-4 py-2.5"
            placeholder="Filtrar por seção (ex.: 2.1.1)"
          />
          <button className="px-4 py-2.5 rounded-xl border hover:bg-gray-50" onClick={() => navigate(-1)}>
            Voltar
          </button>
        </div>
      </div>

      {secoesFiltradas.length === 0 ? (
        <div className="bg-white border rounded-2xl p-8 text-center text-gray-600 shadow-sm">
          Nenhuma seção encontrada com o filtro.
        </div>
      ) : (
        <div className="space-y-4">
          {secoesFiltradas.map((s, idx) => (
            <div key={idx} className="rounded-2xl border bg-white shadow-sm">
              <div className="p-5 border-b font-semibold">{s.title}</div>
              <div className="p-5 overflow-x-auto">
                {!s.rows || s.rows.length === 0 ? (
                  <div className="text-sm text-slate-500">Sem linhas nesta seção.</div>
                ) : (
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500">
                        {Object.keys(s.rows[0]).map((k) => (
                          <th key={k} className="px-3 py-2 border-b">{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {s.rows.map((r, i) => (
                        <tr key={i} className="border-b hover:bg-slate-50">
                          {Object.keys(s.rows[0]).map((k) => (
                            <td key={k} className="px-3 py-2 align-top">
                              {String(r[k] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VisualizarPautaPage;
