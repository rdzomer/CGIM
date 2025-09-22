// src/pages/HistoricoPautasPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getFirestore, collection, getDocs, deleteDoc, doc } from "firebase/firestore";
import { getNcmSetCgim } from "../services/ncmsService";

type PautaRow = Record<string, any>;

type PautaItem = {
  id: string;
  tituloArquivo: string;
  reuniao: string;
  secoes: number;
  pleitos: number;
  pleitosCgim: number;
  novos?: number; alterados?: number; removidos?: number;
};

const norm = (s?: string) => (s ?? "").toString().replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
const only8 = (s?: string) => (s ?? "").replace(/\D+/g, "").slice(0, 8);
const safeStr = (v: any, fallback = "—") => (v == null ? fallback : (typeof v === "string" ? (v || fallback) : String(v)));

function flattenRowsFromPauta(p: any): PautaRow[] {
  const out: PautaRow[] = [];
  const secList = (Array.isArray(p?.sections) ? p.sections : undefined) ?? (Array.isArray(p?.secoes) ? p.secoes : undefined) ?? [];
  const pushRows = (rows?: any[]) => { if (!Array.isArray(rows)) return; for (const r of rows) out.push(r as PautaRow); };
  for (const sec of secList) {
    pushRows(sec?.rows);
    if (Array.isArray(sec?.tabelas)) for (const tb of sec.tabelas) pushRows(tb?.rows);
    if (Array.isArray(sec?.tables)) for (const tb of sec.tables) pushRows(tb?.rows);
    if (Array.isArray(sec?.pleitos)) pushRows(sec?.pleitos);
  }
  if (Array.isArray(p?.tabelas)) for (const tb of p.tabelas) pushRows(tb?.rows);
  if (Array.isArray(p?.pleitos)) pushRows(p?.pleitos);
  return out;
}

function extractFields(row: PautaRow) {
  const keys = Object.keys(row || {});
  const by = (labels: string[]) => {
    const hit = keys.find((k) => labels.some((l) => k.toLowerCase() === l.toLowerCase()) || labels.some((l) => k.toLowerCase().includes(l.toLowerCase()))) || "";
    return String(row?.[hit] ?? "");
  };
  const ncm = by(["NCM","Código NCM","Codigo NCM","Código","Codigo","NCM 8"]);
  const produto = by(["Produto","Descrição do Produto","Descricao do Produto","Descrição","Descricao"]);
  const pleiteante = by(["Pleiteante","Requerente","Solicitante","Interessado"]);
  const tipo = by(["Tipo de Pleito","Tipo do Pleito","Tipo"]);
  return { ncm, produto, pleiteante, tipo };
}

const db = getFirestore();

function toMillis(t: any): number {
  if (!t) return 0;
  if (typeof t === "number") return t;
  if (t instanceof Date) return t.getTime();
  if (t?.toDate) return t.toDate().getTime?.() || 0;
  if (t?.seconds) return t.seconds * 1000 + (t.nanoseconds || 0) / 1e6;
  return 0;
}

function pautaDisplay(p: any): string {
  const title = norm(p?.title) || "";
  const meeting = norm(p?.meeting) || "";
  if (title) return title;
  if (meeting) return meeting;
  const ms = toMillis(p?.meetingDate || p?.createdAt);
  if (ms) {
    const d = new Date(ms);
    const str = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    return `Reunião CAT — ${str[0].toUpperCase()}${str.slice(1)}`;
  }
  return p?.slug || p?.id || "—";
}

const HistoricoPautasPage: React.FC = () => {
  const nav = useNavigate();

  const [itens, setItens] = useState<PautaItem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    (async () => {
      setCarregando(true);
      setErro("");
      try {
        let ncmSet = new Set<string>();
        try { ncmSet = await getNcmSetCgim(); } catch { ncmSet = new Set(); }

        // --- carrega tudo ---
        const snap = await getDocs(collection(db, "pautas"));
        type RawP = {
          id: string;
          tituloArquivo: string;
          reuniaoBase: string;
          createdAtMs: number;
          isRet: boolean;
          baseId?: string;
          revIndex?: number; // 0=base; 1=1ª retif (v2)...
          secoes: number;
          rows: PautaRow[];
          cont?: { novos?: number; alterados?: number; removidos?: number };
        };
        const rawList: RawP[] = [];

        for (const docSnap of snap.docs) {
          const p: any = { id: docSnap.id, ...(docSnap.data() as any) };

          const tituloArquivo = safeStr(p?.tituloArquivo) || safeStr(p?.fileName) || safeStr(p?.arquivo) || "—";
          const reuniaoBase = pautaDisplay(p);

          const createdAtMs = toMillis(p?.createdAt) || toMillis(p?.updatedAt);
          const baseId = p?.diffResumo?.baseId || undefined;
          const revIndex = typeof p?.revIndex === "number" ? p.revIndex : undefined;

          const isRet = !!(baseId || p?.isRetificadora) ||
                        /retificad/i.test(String(tituloArquivo)) ||
                        /retificad/i.test(String(reuniaoBase));

          const secoesArr = Array.isArray(p?.sections) ? p.sections : Array.isArray(p?.secoes) ? p.secoes : [];
          const rows = flattenRowsFromPauta(p);

          const cont = (p?.diffResumo && p.diffResumo.contagens) ? p.diffResumo.contagens : {
            novos: (Array.isArray(p?.novos) ? p.novos.length : undefined),
            removidos: (Array.isArray(p?.removidos) ? p.removidos.length : undefined),
            alterados: undefined,
          };

          rawList.push({
            id: p.id,
            tituloArquivo,
            reuniaoBase,
            createdAtMs,
            isRet,
            baseId,
            revIndex,
            secoes: secoesArr.length,
            rows,
            cont,
          });
        }

        // --- calcula vN por base, respeitando revIndex quando existir ---
        const byBase: Record<string, RawP[]> = {};
        rawList.forEach((r) => {
          if (r.baseId) {
            (byBase[r.baseId] = byBase[r.baseId] || []).push(r);
          }
        });
        const versionMap = new Map<string, number>(); // pautaId -> vN (2,3,...)
        Object.entries(byBase).forEach(([, arr]) => {
          // ordena por createdAt asc para inferir ordem das retificações
          arr.sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
          arr.forEach((r, i) => {
            if (typeof r.revIndex === "number") {
              versionMap.set(r.id, r.revIndex + 1); // 1 => v2
            } else {
              versionMap.set(r.id, i + 2); // primeira retificação => v2
            }
          });
        });

        // --- computa métricas CGIM e monta lista final ---
        const list: PautaItem[] = rawList.map((r) => {
          let cgim = 0;
          for (const row of r.rows) {
            const flagged = row?.cgim === true || row?.isCGIM === true || row?.pertenceCGIM === true || row?.inCGIMScope === true;
            if (flagged) { cgim++; continue; }
            const n8 = only8(extractFields(row).ncm);
            if (n8.length === 8 && ncmSet.has(n8)) cgim++;
          }
          const vN = versionMap.get(r.id);
          const reuniao = r.isRet ? `${r.reuniaoBase}${vN ? ` (RETIFICADA v${vN})` : " (RETIFICADA)"}` : r.reuniaoBase;

          return {
            id: r.id,
            tituloArquivo: r.tituloArquivo,
            reuniao,
            secoes: r.secoes,
            pleitos: r.rows.length,
            pleitosCgim: cgim,
            novos: r.cont?.novos ?? 0,
            alterados: r.cont?.alterados ?? 0,
            removidos: r.cont?.removidos ?? 0,
          };
        });

        // mantém ordenação atual (sem mexer no seu UX)
        setItens(list);
      } catch (e: any) {
        console.error(e);
        setErro(e?.message || "Falha ao carregar histórico.");
      } finally { setCarregando(false); }
    })();
  }, []);

  const total = useMemo(() => itens.length, [itens]);

  const excluir = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir esta pauta?")) return;
    await deleteDoc(doc(db, "pautas", id));
    setItens((prev) => prev.filter((x) => x.id !== id));
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Histórico de Pautas</h1>
          <div className="text-sm text-slate-600 mt-1">{total} itens</div>
        </div>
      </div>

      {erro && <div className="p-4 rounded-xl border bg-red-50 text-red-800">{erro}</div>}

      <div className="rounded-2xl border bg-white shadow-sm overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-600">
              <th className="p-3 font-medium">Reunião</th>
              <th className="p-3 font-medium">Arquivo</th>
              <th className="p-3 font-medium">Seções</th>
              <th className="p-3 font-medium">Pleitos</th>
              <th className="p-3 font-medium">Pleitos CGIM</th>
              <th className="p-3 font-medium">Novos</th>
              <th className="p-3 font-medium">Alterados</th>
              <th className="p-3 font-medium">Removidos</th>
              <th className="p-3 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr><td className="p-3" colSpan={9}>Carregando…</td></tr>
            )}
            {!carregando && itens.length === 0 && (
              <tr><td className="p-3" colSpan={9}>Nenhuma pauta encontrada.</td></tr>
            )}
            {!carregando && itens.map((it) => (
              <tr key={it.id} className="border-t hover:bg-slate-50">
                <td className="p-3">{it.reuniao}</td>
                <td className="p-3">{it.tituloArquivo}</td>
                <td className="p-3">{it.secoes}</td>
                <td className="p-3">{it.pleitos}</td>
                <td className="p-3">{it.pleitosCgim}</td>
                <td className="p-3">{it.novos ?? "—"}</td>
                <td className="p-3">{it.alterados ?? "—"}</td>
                <td className="p-3">{it.removidos ?? "—"}</td>
                <td className="p-3">
                  <div className="flex gap-2">
                    <button className="px-3 py-1 rounded border text-sm hover:bg-gray-50" onClick={() => nav(`/pauta?id=${encodeURIComponent(it.id)}`)}>
                      Abrir
                    </button>
                    <button className="px-3 py-1 rounded border text-sm hover:bg-red-50 text-red-700 border-red-300" onClick={() => excluir(it.id)}>
                      excluir
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default HistoricoPautasPage;
