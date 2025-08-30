// src/pages/NcmSearchPage.tsx
/**
 * Página de consulta por NCM.
 * Rota: /consulta-ncm
 * Busca:
 *  - Atribuições atuais (coleção raiz: atribuicoes)
 *  - Histórico de análises (raiz e subcoleções via collectionGroup: historicoAnalises)
 *  - Pleitos (collectionGroup: pleitos) como histórico derivado
 */
import React, { useMemo, useState } from "react";
import {
  collection,
  collectionGroup,
  getDocs,
  getFirestore,
  query,
  where,
  orderBy,
  limit,
  DocumentData,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";

type Analise = {
  resumo?: string;
  comercio?: string;
  tecnica?: string;
  sugestao?: string;
};

type Atrib = {
  id: string;
  ncm?: string;
  produto?: string;
  pleiteante?: string;
  pautaId?: string;
  tituloSecao?: string;
  status?: string;
  analise?: Analise | null;
  pleitoKey?: string;
  updatedAt?: any;
};

type HistItem = {
  id: string;
  ncm?: string;
  pautaId?: string;
  secao?: string;
  resumo?: string;
  tecnica?: string;
  comercio?: string;
  sugestao?: string;
  status?: string;
  encaminhadoGecex?: boolean;
  createdAt?: any;
  updatedAt?: any;
  _source: "root" | "group" | "pleitos";
};

function only8(s: string) {
  return (s || "").replace(/\D/g, "").slice(0, 8);
}
function ncmComPontos(n8: string) {
  if (n8.length !== 8) return "";
  return `${n8.slice(0, 4)}.${n8.slice(4, 6)}.${n8.slice(6)}`;
}
function uniqById<T extends { id: string }>(arr: T[]) {
  const m = new Map<string, T>();
  for (const x of arr) if (!m.has(x.id)) m.set(x.id, x);
  return Array.from(m.values());
}
function toMillisAny(v: any): number {
  try {
    if (!v) return 0;
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const t = Date.parse(v);
      return Number.isNaN(t) ? 0 : t;
    }
    if (v.toMillis) return v.toMillis();
    if (v.toDate) return v.toDate().getTime();
  } catch {}
  return 0;
}
function toLocale(dt: any) {
  try {
    if (dt?.toDate) return dt.toDate().toLocaleString("pt-BR");
    const ms = toMillisAny(dt);
    return ms ? new Date(ms).toLocaleString("pt-BR") : "";
  } catch {
    return "";
  }
}

const NcmSearchPage: React.FC = () => {
  const [ncm, setNcm] = useState("");
  const [loading, setLoading] = useState(false);
  const [resHistorico, setResHistorico] = useState<HistItem[]>([]);
  const [resAtrib, setResAtrib] = useState<Atrib[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [permDenied, setPermDenied] = useState(false);

  const navigate = useNavigate();
  const ncm8 = useMemo(() => only8(ncm), [ncm]);

  async function onBuscar() {
    const target = ncm8;
    if (!target || target.length !== 8) {
      setResAtrib([]);
      setResHistorico([]);
      setErr(null);
      setPermDenied(false);
      return;
    }

    setLoading(true);
    setErr(null);
    setPermDenied(false);

    const db = getFirestore();
    const targetDot = ncmComPontos(target);

    try {
      // =========================
      // 1) ATRIBUIÇÕES (raiz)
      // =========================
      let atribs: Atrib[] = [];
      const atribRef = collection(db, "atribuicoes");
      try {
        const qAtrib = query(
          atribRef,
          where("ncm", "==", target),
          orderBy("updatedAt", "desc"),
          limit(100)
        );
        const snapAtrib = await getDocs(qAtrib);
        atribs = snapAtrib.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      } catch {
        // Fallback sem orderBy (não exibe link de índice)
        const qAtribNoOrder = query(atribRef, where("ncm", "==", target), limit(100));
        const snapAtrib2 = await getDocs(qAtribNoOrder);
        atribs = snapAtrib2.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

        // Tenta também com formato pontuado, caso os docs estejam assim
        if (atribs.length === 0 && targetDot) {
          try {
            const snapAtrib3 = await getDocs(
              query(atribRef, where("ncm", "in", [target, targetDot]), limit(100))
            );
            atribs = snapAtrib3.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
          } catch {}
        }
      }

      // =========================
      // 2) HISTÓRICO - raiz
      // =========================
      let rootDocs: HistItem[] = [];
      const histRootRef = collection(db, "historicoAnalises");
      try {
        const qHistRoot = query(
          histRootRef,
          where("ncm", "==", target),
          orderBy("createdAt", "desc"),
          limit(100)
        );
        const snapRoot = await getDocs(qHistRoot);
        rootDocs = snapRoot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as DocumentData),
          _source: "root" as const,
        }));
      } catch {
        // Fallback sem orderBy
        const snapRoot2 = await getDocs(
          query(histRootRef, where("ncm", "==", target), limit(100))
        );
        rootDocs = snapRoot2.docs.map((d) => ({
          id: d.id,
          ...(d.data() as DocumentData),
          _source: "root" as const,
        }));
        if (rootDocs.length === 0 && targetDot) {
          try {
            const snapRoot3 = await getDocs(
              query(histRootRef, where("ncm", "in", [target, targetDot]), limit(100))
            );
            rootDocs = snapRoot3.docs.map((d) => ({
              id: d.id,
              ...(d.data() as DocumentData),
              _source: "root" as const,
            }));
          } catch {}
        }
      }

      // =========================
      // 3) HISTÓRICO - collectionGroup
      // =========================
      let groupDocs: HistItem[] = [];
      try {
        const qHistCg = query(
          collectionGroup(db, "historicoAnalises"),
          where("ncm", "==", target),
          orderBy("createdAt", "desc"),
          limit(100)
        );
        const snapCg = await getDocs(qHistCg);
        groupDocs = snapCg.docs.map((d) => ({
          id: d.id,
          ...(d.data() as DocumentData),
          _source: "group" as const,
        }));
      } catch {
        // Fallback sem orderBy
        const snapCg2 = await getDocs(
          query(collectionGroup(db, "historicoAnalises"), where("ncm", "==", target), limit(100))
        );
        groupDocs = snapCg2.docs.map((d) => ({
          id: d.id,
          ...(d.data() as DocumentData),
          _source: "group" as const,
        }));
        if (groupDocs.length === 0 && targetDot) {
          try {
            const snapCg3 = await getDocs(
              query(
                collectionGroup(db, "historicoAnalises"),
                where("ncm", "in", [target, targetDot]),
                limit(100)
              )
            );
            groupDocs = snapCg3.docs.map((d) => ({
              id: d.id,
              ...(d.data() as DocumentData),
              _source: "group" as const,
            }));
          } catch {}
        }
      }

      // =========================
      // 4) PLEITOS - collectionGroup (histórico derivado)
      // =========================
      let pleitosDocs: HistItem[] = [];
      try {
        const pleitosQ = query(
          collectionGroup(db, "pleitos"),
          where("ncm", "==", target),
          orderBy("updatedAt", "desc"),
          limit(100)
        );
        const snapPleitos = await getDocs(pleitosQ);
        pleitosDocs = snapPleitos.docs.map((d) => {
          const pautaId = d.ref.parent?.parent?.id;
          const data = d.data() as DocumentData;
          return {
            id: d.id,
            ncm: data.ncm,
            resumo: data.resumo,
            tecnica: data.tecnica,
            sugestao: data.sugestao,
            comercio: data.comercio,
            pautaId: pautaId || data.pautaId,
            secao: data.secao || data.tituloSecao,
            status: data.status,
            encaminhadoGecex:
              data.encaminhamento?.gecex === true ||
              data.encaminhamento === "gecex" ||
              data.encaminhadoGecex === true,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            _source: "pleitos" as const,
          };
        });
      } catch {
        // Fallback sem orderBy
        const snapPleitos2 = await getDocs(
          query(collectionGroup(db, "pleitos"), where("ncm", "==", target), limit(100))
        );
        pleitosDocs = snapPleitos2.docs.map((d) => {
          const pautaId = d.ref.parent?.parent?.id;
          const data = d.data() as DocumentData;
          return {
            id: d.id,
            ncm: data.ncm,
            resumo: data.resumo,
            tecnica: data.tecnica,
            sugestao: data.sugestao,
            comercio: data.comercio,
            pautaId: pautaId || data.pautaId,
            secao: data.secao || data.tituloSecao,
            status: data.status,
            encaminhadoGecex:
              data.encaminhamento?.gecex === true ||
              data.encaminhamento === "gecex" ||
              data.encaminhadoGecex === true,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            _source: "pleitos" as const,
          };
        });
      }

      // Merge + ordenação final
      const merged = uniqById([...rootDocs, ...groupDocs, ...pleitosDocs]).sort((a, b) => {
        const aT = toMillisAny(a.createdAt) || toMillisAny(a.updatedAt);
        const bT = toMillisAny(b.createdAt) || toMillisAny(b.updatedAt);
        return bT - aT;
      });

      setResAtrib(atribs);
      setResHistorico(merged);
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Erro ao buscar NCM.");
      if (e?.code === "permission-denied") setPermDenied(true);
    } finally {
      setLoading(false);
    }
  }

  function goToAnalise(atrId: string) {
    if (!atrId) return;
    navigate(`/analise/${atrId}`);
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Consulta por NCM</h1>

      <div className="bg-white border rounded p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="border rounded px-3 py-2 w-48"
            placeholder="NCM (8 dígitos)"
            value={ncm}
            onChange={(e) => setNcm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onBuscar()}
          />
          <button
            className="px-4 py-2 rounded bg-gray-100 hover:bg-gray-200"
            onClick={onBuscar}
            disabled={loading}
          >
            {loading ? "Buscando..." : "Buscar"}
          </button>
          {permDenied && (
            <span className="text-sm text-red-600">Acesso negado pelas regras do Firestore.</span>
          )}
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>

      {/* ATRIBUIÇÕES */}
      <div className="bg-white border rounded p-4 mb-6">
        <h2 className="font-semibold mb-2">Atribuições existentes</h2>
        {resAtrib.length === 0 ? (
          <div className="text-sm text-gray-500">Nenhuma atribuição para esta NCM.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full table-auto">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="px-3 py-2">NCM</th>
                  <th className="px-3 py-2">Produto</th>
                  <th className="px-3 py-2">Pleiteante</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Atualizado em</th>
                  <th className="px-3 py-2 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {resAtrib.map((a) => (
                  <tr key={a.id} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap font-medium">{a.ncm}</td>
                    <td className="px-3 py-2 break-words">{a.produto}</td>
                    <td className="px-3 py-2 break-words">{a.pleiteante}</td>
                    <td className="px-3 py-2">{a.status || "—"}</td>
                    <td className="px-3 py-2 text-sm text-gray-600">{toLocale(a.updatedAt)}</td>
                    <td className="px-3 py-2">
                      <button
                        className="px-2 py-1 text-sm rounded bg-gray-100 hover:bg-gray-200"
                        onClick={() => goToAnalise(a.id)}
                      >
                        abrir análise
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* HISTÓRICO (de várias fontes) */}
      <div className="bg-white border rounded p-4">
        <h2 className="font-semibold mb-2">Histórico de análises</h2>
        {resHistorico.length === 0 ? (
          <div className="text-sm text-gray-500">
            Nenhum registro de histórico para esta NCM nas fontes consultadas.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full table-auto">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="px-3 py-2">Fonte</th>
                  <th className="px-3 py-2">Pauta</th>
                  <th className="px-3 py-2">Seção</th>
                  <th className="px-3 py-2">Resumo</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Enc. GE CEX</th>
                  <th className="px-3 py-2">Criado</th>
                  <th className="px-3 py-2">Atualizado</th>
                </tr>
              </thead>
              <tbody>
                {resHistorico.map((h) => (
                  <tr key={h.id} className="border-t align-top">
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {h._source === "pleitos"
                        ? "pleitos"
                        : h._source === "group"
                        ? "historico (subcoleção)"
                        : "historico (raiz)"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{h.pautaId || "—"}</td>
                    <td className="px-3 py-2 break-words">{h.secao || "—"}</td>
                    <td className="px-3 py-2 break-words">{h.resumo || "—"}</td>
                    <td className="px-3 py-2">{h.status || "—"}</td>
                    <td className="px-3 py-2">{h.encaminhadoGecex ? "Sim" : "—"}</td>
                    <td className="px-3 py-2 text-sm text-gray-600">{toLocale(h.createdAt)}</td>
                    <td className="px-3 py-2 text-sm text-gray-600">{toLocale(h.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default NcmSearchPage;
