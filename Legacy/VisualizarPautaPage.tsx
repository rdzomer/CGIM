// src/pages/VisualizarPautaPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getFirestore, doc, getDoc } from "firebase/firestore";

type Pauta = {
  meeting?: string;
  tituloArquivo?: string;
  diffResumo?: { baseId?: string; contagens?: { novos: number; alterados: number; removidos: number; mantidos: number } };
  isRetificadora?: boolean;
  sections?: { title: string; rows?: any[] }[];
};

const VisualizarPautaPage: React.FC = () => {
  const { pautaId } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();

  const [pauta, setPauta] = useState<Pauta | null>(null);

  const [filtroSecao, setFiltroSecao] = useState(sp.get("secao") || "");

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

  // É retificadora?
  const isRetificadora =
    !!(pauta?.diffResumo?.baseId || pauta?.isRetificadora) ||
    /retificad/i.test(String(pauta?.tituloArquivo || "")) ||
    /retificad/i.test(String(pauta?.meeting || ""));

  // Contagens por statusVigencia (se existir)
  const contagens = useMemo(() => {
    const c = { novos: 0, alterados: 0, mantidos: 0 };
    try {
      for (const s of pauta?.sections || []) {
        for (const r of s.rows || []) {
          const st = String((r as any)?.statusVigencia || "").toLowerCase();
          if (st === "novo" || st === "novos") c.novos++;
          else if (st.startsWith("alter")) c.alterados++;
          else if (st.startsWith("mant")) c.mantidos++;
        }
      }
    } catch {}
    return c;
  }, [pauta]);

  return (
    <div className="p-2 md:p-4 lg:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Pauta (visualização)</h1>
          <div className="text-sm text-slate-600 mt-1">
            {(pauta?.meeting || "—") + (isRetificadora ? " (RETIFICADA)" : "")}
            {isRetificadora && (
              <span className="ml-2 inline-flex gap-1 text-xs align-middle">
                <span className="px-1.5 py-0.5 rounded border bg-emerald-100 text-emerald-800 border-emerald-200">+{contagens.novos} novos</span>
                <span className="px-1.5 py-0.5 rounded border bg-amber-100 text-amber-800 border-amber-200">~{contagens.alterados} alterados</span>
              </span>
            )}
          </div>
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
                        {Array.from(new Set((s.rows || []).flatMap((r) => Object.keys(r || {}))))
                          .filter((k) => k !== "statusVigencia")
                          .map((k) => (
                            <th key={k} className="px-3 py-2 border-b">
                              {k}
                            </th>
                          ))}
                        {s.rows.some((r: any) => r && r.statusVigencia) ? (
                          <th className="px-3 py-2 border-b">Δ</th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {s.rows.map((r, i) => (
                        <tr key={i} className="border-b hover:bg-slate-50">
                          {Array.from(new Set((s.rows || []).flatMap((rr) => Object.keys(rr || {}))))
                            .filter((k) => k !== "statusVigencia")
                            .map((k) => (
                              <td key={k} className="px-3 py-2 align-top">
                                {String(r[k] ?? "")}
                              </td>
                            ))}
                          {r && r.statusVigencia ? (
                            <td className="px-3 py-2 align-top whitespace-nowrap">
                              {(() => {
                                const st = String(r.statusVigencia).toLowerCase();
                                const label = st.startsWith("novo")
                                  ? "Novo"
                                  : st.startsWith("alter")
                                  ? "Alterado"
                                  : st.startsWith("mant")
                                  ? "Mantido"
                                  : st;
                                const cls = st.startsWith("novo")
                                  ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                                  : st.startsWith("alter")
                                  ? "bg-amber-100 text-amber-800 border-amber-200"
                                  : "bg-gray-100 text-gray-700 border-gray-200";
                                return <span className={"inline-flex px-2 py-0.5 text-xs rounded border " + cls}>{label}</span>;
                              })()}
                            </td>
                          ) : null}
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
