// src/pages/HistoricoPautasPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getFirestore, collection, getDocs, deleteDoc, doc } from "firebase/firestore";
import { getNcmSetCgim } from "../services/ncmsService";
import { norm, only8, toMillis } from "../utils/stringUtils";

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

type RawPauta = {
  id: string;
  tituloArquivo: string;
  baseName: string;        // label base (sem sufixos)
  createdAtMs: number;
  isRet: boolean;
  baseId?: string;         // diffResumo.baseId quando existir
  revIndex?: number;
  secoes: number;
  rows: PautaRow[];
  cont?: { novos?: number; alterados?: number; removidos?: number };
};

const db = getFirestore();

const safeStr = (v: any, fallback = "—") => (v == null ? fallback : (typeof v === "string" ? (v || fallback) : String(v)));

const uploadTs = (p: any) => toMillis(p.createdAt) || toMillis(p.updatedAt) || toMillis(p.meetingDate);

/** Remove qualquer sufixo "(RETIFICADA ...)" do nome base. */
function baseNameFor(p: any): string {
  const raw = norm(p?.title) || norm(p?.reuniao) || norm(p?.meeting) || norm(p?.slug) || "";
  return (raw || p?.id || "").replace(/\( *retificad[^)]*\)/i, "").trim();
}

function meetingNumberFromBase(base: string): number {
  // pega primeiro número (ex.: "65ª Reunião ..." -> 65)
  const m = base.match(/(\d{1,3})/);
  return m ? parseInt(m[1], 10) : -1;
}

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
    const hit = keys.find((k) => labels.some((l) => k.toLowerCase() === l.toLowerCase())) ||
               keys.find((k) => labels.some((l) => k.toLowerCase().includes(l.toLowerCase()))) || "";
    return String(row?.[hit] ?? "");
  };
  const ncm = by(["NCM","Código NCM","Codigo NCM","Código","Codigo","NCM 8"]);
  const produto = by(["Produto","Descrição do Produto","Descricao do Produto","Descrição","Descricao"]);
  const pleiteante = by(["Pleiteante","Requerente","Solicitante","Interessado"]);
  const tipo = by(["Tipo de Pleito","Tipo do Pleito","Tipo"]);
  return { ncm, produto, pleiteante, tipo };
}

function isRetFlag(p: any): boolean {
  return !!(p?.diffResumo?.baseId || p?.isRetificadora) || /retificad/i.test(String(p?.arquivo || ""));
}

async function buildRawList(): Promise<RawPauta[]> {
  const snap = await getDocs(collection(db, "pautas"));
  const arr: RawPauta[] = [];
  snap.forEach((d) => {
    const p = d.data() as any;
    const base = baseNameFor(p) || d.id;
    arr.push({
      id: d.id,
      tituloArquivo: safeStr(p?.arquivo, "—"),
      baseName: base,
      createdAtMs: uploadTs(p),
      isRet: isRetFlag(p),
      baseId: p?.diffResumo?.baseId ? String(p.diffResumo.baseId) : undefined,
      revIndex: typeof p?.revIndex === "number" ? p.revIndex : undefined,
      secoes: Array.isArray(p?.sections) ? p.sections.length : Array.isArray(p?.secoes) ? p.secoes.length : 0,
      rows: flattenRowsFromPauta(p),
      cont: p?.diffResumo?.contagens || p?.contagens || undefined,
    });
  });
  return arr;
}

/** Calcula vN para retificadas:
 * - Se revIndex está presente: vN = revIndex + 1 (v1 = base).
 * - Senão, por grupo (baseId se existir; caso contrário, por baseName), ordena por createdAtMs asc
 *   e numera as retificadas como v1, v2, ...
 */
function computeVersionMap(list: RawPauta[]): Map<string, number> {
  const vmap = new Map<string, number>();
  // 1) direto por revIndex
  for (const r of list) if (typeof r.revIndex === "number") vmap.set(r.id, r.revIndex + 1);
  // 2) por baseId explícito
  const byBaseId: Record<string, RawPauta[]> = {};
  for (const r of list) {
    const baseId = r.baseId || "";
    if (!baseId) continue;
    (byBaseId[baseId] = byBaseId[baseId] || []).push(r);
  }
  for (const [baseId, arr] of Object.entries(byBaseId)) {
    const sorted = [...arr].sort((a,b)=>a.createdAtMs - b.createdAtMs);
    let v = 1;
    for (const r of sorted) {
      if (r.id === baseId) continue; // base não recebe vN
      if (!vmap.has(r.id)) vmap.set(r.id, v++);
    }
  }
  // 3) fallback por baseName
  const byBaseName: Record<string, RawPauta[]> = {};
  for (const r of list) (byBaseName[r.baseName] = byBaseName[r.baseName] || []).push(r);
  for (const arr of Object.values(byBaseName)) {
    const sorted = [...arr].sort((a,b)=>a.createdAtMs - b.createdAtMs);
    let v = 1;
    for (let i=1;i<sorted.length;i++) {
      const r = sorted[i];
      if (!vmap.has(r.id)) vmap.set(r.id, v++);
    }
  }
  return vmap;
}

/** Monta itens com contagens CGIM e aplica ordenação por reunião/versões. */
async function buildItemsOrderedByMeeting(list: RawPauta[]): Promise<PautaItem[]> {
  const versionMap = computeVersionMap(list);
  // Pré-cálculo CGIM
  let ncmSet = new Set<string>();
  try { ncmSet = await getNcmSetCgim(); } catch { ncmSet = new Set(); }

  // Agrupar por reunião (baseName)
  type Group = { key: string; meetingNum: number; baseName: string; versions: RawPauta[]; };
  const groups = new Map<string, Group>();
  for (const r of list) {
    // chave de grupo: baseId se existir; senão baseName
    const key = r.baseId || r.baseName.toLowerCase();
    const g = groups.get(key) || { key, meetingNum: meetingNumberFromBase(r.baseName), baseName: r.baseName, versions: [] };
    g.baseName = g.baseName || r.baseName;
    g.versions.push(r);
    groups.set(key, g);
  }

  // Ordenar grupos pela numeração da reunião (ASC) e estabilidade por createdAt (ASC)
  const orderedGroups = Array.from(groups.values()).sort((a,b)=>{
    const n = (a.meetingNum - b.meetingNum);
    if (n !== 0) return n;
    // fallback: pela menor data entre as versões (asc)
    const ta = Math.min(...a.versions.map(v=>v.createdAtMs||0));
    const tb = Math.min(...b.versions.map(v=>v.createdAtMs||0));
    return ta - tb;
  });

  // Para cada grupo: base primeiro, depois retificadas v1, v2...
  const items: PautaItem[] = [];
  for (const g of orderedGroups) {
    const base = g.versions.find(v => !v.isRet) || g.versions.sort((a,b)=>a.createdAtMs-b.createdAtMs)[0];
    const rets = g.versions.filter(v => v !== base).sort((a,b)=> (versionMap.get(a.id)||0) - (versionMap.get(b.id)||0));

    const push = (r: RawPauta, isRet: boolean) => {
      // CGIM count
      let cgim = 0;
      for (const row of r.rows) {
        const flagged = row?.cgim === true || row?.isCGIM === true || row?.pertenceCGIM === true || row?.inCGIMScope === true;
        if (flagged) { cgim++; continue; }
        const n8 = only8(extractFields(row).ncm);
        if (n8.length === 8 && ncmSet.has(n8)) cgim++;
      }
      const vN = versionMap.get(r.id);
      const reuniao = isRet ? `${g.baseName}${vN ? ` (RETIFICADA v${vN})` : " (RETIFICADA)"}` : g.baseName;
      items.push({
        id: r.id,
        tituloArquivo: r.tituloArquivo,
        reuniao,
        secoes: r.secoes,
        pleitos: r.rows.length,
        pleitosCgim: cgim,
        novos: r.cont?.novos ?? 0,
        alterados: r.cont?.alterados ?? 0,
        removidos: r.cont?.removidos ?? 0,
      });
    };

    if (base) push(base, false);
    for (const r of rets) push(r, true);
  }

  return items;
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
        const raw = await buildRawList();
        const list = await buildItemsOrderedByMeeting(raw);
        setItens(list);
      } catch (e: any) {
        console.error(e);
        setErro(e?.message || "Falha ao carregar histórico.");
      } finally {
        setCarregando(false);
      }
    })();
  }, []);

  const excluir = async (id: string) => {
    if (!id) return;
    if (!confirm("Tem certeza que deseja excluir esta pauta?")) return;
    try {
      await deleteDoc(doc(db, "pautas", id));
      setItens((cur) => cur.filter((x) => x.id !== id));
    } catch (e) {
      alert("Falha ao excluir.");
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Histórico de Pautas</h1>
        <p className="text-sm text-slate-600">{itens.length} itens</p>
      </div>

      {erro && <div className="p-3 rounded-xl border bg-red-50 text-red-700">{erro}</div>}

      <div className="rounded-2xl border bg-white/70 overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left bg-gray-50">
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
                    <button className="px-3 py-1 rounded border hover:bg-gray-50" onClick={() => nav(`/pauta?id=${encodeURIComponent(it.id)}`)}>
                      Abrir
                    </button>
                    <button className="px-3 py-1 rounded border bg-red-50 text-red-700 border-red-300" onClick={() => excluir(it.id)}>
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
