// src/pages/DashboardPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getFirestore,
  collection,
  getDocs,
} from "firebase/firestore";
import { getAuth, onAuthStateChanged, User as FBUser } from "firebase/auth";
import { getNcmSetCgim } from "../services/ncmsService";
import { gerarPleitoKey, carregarAtribuicoesPorChaves } from "../services/atribuicoesService";
import { norm, normKey, only8, toMillis, normalizeStatus } from "../utils/stringUtils";

/* ==================== Tipos ==================== */
type MiniUser = { uid?: string; email?: string; nome?: string } | null;
type PleitoRow = Record<string, any>;

type PleitoBase = {
  id: string;
  pautaId: string;
  pleitoKey: string;
  ncm?: string;
  produto?: string;
  pleiteante?: string;
  tipoPleito?: string;
  tituloSecao?: string;
};

type Atrib = {
  id: string;
  pleitoKey?: string;
  responsavelNome?: string;
  analistaNome?: string;
  status?: string;
  analise?: { resumo?: string; comercio?: string; tecnica?: string; sugestao?: string } | null;
  ncm?: string;
  produto?: string;
  pleiteante?: string;
  pautaId?: string;
  tituloSecao?: string;
  updatedAt?: any;
};

/* ==================== Helpers ==================== */
const displayStatus = (raw?: string) => {
  const n = normalizeStatus(raw);
  if (n === "concluido") return "Concluído";
  if (n === "em_analise") return "Em Análise";
  return "Novo";
};

function pickKey(row: PleitoRow, candidates: string[]): string | undefined {
  const keys = Object.keys(row || {});
  for (const cand of candidates) {
    const target = normKey(cand);
    const k = keys.find((kk) => normKey(kk) === target);
    if (k) return k;
  }
  for (const kk of keys) {
    const nk = normKey(kk);
    if (candidates.some((c) => nk.includes(normKey(c)))) return kk;
  }
  return undefined;
}

function projectLinha(row: PleitoRow) {
  const kNcm  = pickKey(row, ["NCM","Código NCM","Codigo NCM","Código","Codigo","NCM 8"]);
  const kProd = pickKey(row, ["Produto","Descrição do Produto","Descricao do Produto","Produto/Descrição","Descrição","Descricao"]);
  const kPlt  = pickKey(row, ["Pleiteante","Empresa","Requerente","Solicitante","Interessado"]);
  const kTipo = pickKey(row, ["Tipo de Pleito","Tipo","Pleito","Pedido"]);
  return {
    ncm: kNcm ? String(row[kNcm] ?? "") : "",
    produto: kProd ? String(row[kProd] ?? "") : "",
    pleiteante: kPlt ? String(row[kPlt] ?? "") : "",
    tipo: kTipo ? String(row[kTipo] ?? "") : "",
  };
}

/** Constrói pleitoKey quando a linha não traz `key` explícita */
function tryMakeKeyFromRow(row: PleitoRow): string {
  const { ncm, produto, pleiteante } = projectLinha(row);
  const n8 = only8(ncm);
  try {
    const k = gerarPleitoKey({ NCM: n8, Produto: produto || "", Pleiteante: pleiteante || "" });
    if (k) return String(k);
  } catch {}
  return `${n8}|${normKey(produto)}|${normKey(pleiteante)}`;
}

const ANALISTAS_FIXOS = ["Todos","Pedro Reckziegel","Ricardo Zomer","Antonio Azambuja"] as const;
const STATUS_OPCOES = ["Todos", "Novo", "Em Análise", "Concluído"] as const;

function nomeMatchesFiltro(nome: string | undefined | null, filtro: typeof ANALISTAS_FIXOS[number]) {
  if (filtro === "Todos") return true;
  if (!nome) return false;
  const a = normKey(nome); const b = normKey(filtro);
  return a === b || a.replace("antonio","antônio") === b || a.replace("antônio","antonio") === b;
}

function statusMatchesFiltro(statusRaw: string | undefined, filtro: typeof STATUS_OPCOES[number]) {
  if (filtro === "Todos") return true;
  const n = normalizeStatus(statusRaw);
  if (filtro === "Concluído") return n === "concluido";
  if (filtro === "Em Análise") return n === "em_analise";
  return n === "nao_iniciado";
}

function rowStyleByStatus(statusRaw?: string) {
  const n = normalizeStatus(statusRaw);
  if (n === "concluido") return "bg-green-50 border-l-4 border-l-green-400";
  if (n === "em_analise") return "bg-blue-50 border-l-4 border-l-blue-300";
  return "bg-white border-l-4 border-l-gray-200";
}

/* ========= flatten de pleitos (cobre rows, tabelas/tables/pleitos na seção e no topo) ========= */
function flattenPleitosFromPauta(pauta: any) {
  const out: (PleitoRow & { __sec?: string })[] = [];
  const secoes = Array.isArray(pauta?.sections) ? pauta.sections : Array.isArray(pauta?.secoes) ? pauta.secoes : [];
  for (const sec of secoes) {
    const secTitle = String(sec?.title ?? sec?.titulo ?? "");
    if (Array.isArray(sec?.rows)) sec.rows.forEach((r: any) => out.push({ ...r, __sec: secTitle }));
    if (Array.isArray(sec?.tabelas)) {
      sec.tabelas.forEach((tb: any) => {
        if (Array.isArray(tb?.rows)) tb.rows.forEach((r: any) => out.push({ ...r, __sec: secTitle }));
      });
    }
    if (Array.isArray(sec?.tables)) {
      sec.tables.forEach((tb: any) => {
        if (Array.isArray(tb?.rows)) tb.rows.forEach((r: any) => out.push({ ...r, __sec: secTitle }));
      });
    }
    if (Array.isArray(sec?.pleitos)) sec.pleitos.forEach((r: any) => out.push({ ...r, __sec: secTitle }));
  }
  if (Array.isArray(pauta?.tabelas)) {
    pauta.tabelas.forEach((tb: any) => {
      if (Array.isArray(tb?.rows)) tb.rows.forEach((r: any) => out.push({ ...r, __sec: "" }));
    });
  }
  if (Array.isArray(pauta?.tables)) {
    pauta.tables.forEach((tb: any) => {
      if (Array.isArray(tb?.rows)) tb.rows.forEach((r: any) => out.push({ ...r, __sec: "" }));
    });
  }
  if (Array.isArray(pauta?.pleitos)) pauta.pleitos.forEach((r: any) => out.push({ ...r, __sec: "" }));
  return out;
}

/* ==================== Auth ==================== */
function useCurrentUser(): { loading: boolean; user: MiniUser } {
  const [state, setState] = useState<{ loading: boolean; user: MiniUser }>({ loading: true, user: null });
  useEffect(() => {
    const unsub = onAuthStateChanged(getAuth(), (fb: FBUser | null) => {
      if (!fb) setState({ loading: false, user: null });
      else setState({ loading: false, user: { uid: fb.uid, email: fb.email || undefined, nome: fb.displayName || undefined } });
    });
    return () => unsub();
  }, []);
  return state;
}

/* ==================== Página ==================== */
const DashboardPage: React.FC = () => {
  const db = getFirestore();
  const nav = useNavigate();
  const { loading: authLoading } = useCurrentUser();

  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [avisoNcm, setAvisoNcm] = useState("");

  // >>> filtro deve iniciar SEMPRE em "Todos"
  const [analistaFiltro, setAnalistaFiltro] = useState<typeof ANALISTAS_FIXOS[number]>("Todos");
  const [statusFiltro, setStatusFiltro] = useState<typeof STATUS_OPCOES[number]>("Todos");
  const [somenteConcluidos, setSomenteConcluidos] = useState(false);

  const [pautaAtualId, setPautaAtualId] = useState<string>("");
  const [pautaAtualTitulo, setPautaAtualTitulo] = useState<string>("");

  const [pleitos, setPleitos] = useState<PleitoBase[]>([]);
  const [atribs, setAtribs] = useState<Atrib[]>([]);
  // >>> mapa oficial vindo da Pauta CAT: pleitoKey -> responsavelNome
  const [respPorChave, setRespPorChave] = useState<Record<string, string>>({});

  useEffect(() => {
    if (authLoading) return;
    (async () => {
      setCarregando(true);
      setErro("");
      try {
        // 1) NCMs CGIM
        let ncmSet: Set<string> = new Set();
        try { ncmSet = await getNcmSetCgim(); } catch { ncmSet = new Set(); }
        const hasNcm = ncmSet.size > 0;
        setAvisoNcm(hasNcm ? "" : "Aviso: NCMs CGIM não configuradas. Exibindo pleitos detectados sem filtrar por NCM.");

        // 2) Carrega todas as pautas e pega a mais recente
        const snapP = await getDocs(collection(db, "pautas"));
        const pautasAll = snapP.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        pautasAll.sort((a, b) => {
          const ta = toMillis(a.meetingDate) || toMillis(a.updatedAt) || toMillis(a.createdAt || a.criadoEm);
          const tb = toMillis(b.meetingDate) || toMillis(b.updatedAt) || toMillis(b.createdAt || b.criadoEm);
          return tb - ta;
        });
        const pauta = pautasAll[0] || null;
        if (!pauta) {
          setPleitos([]); setAtribs([]); setRespPorChave({});
          setPautaAtualId(""); setPautaAtualTitulo("");
          setCarregando(false);
          return;
        }

        setPautaAtualId(pauta.id);
        setPautaAtualTitulo(String(pauta.title || pauta.meeting || pauta.reuniao || pauta.slug || pauta.id));

        // 3) Monta lista de pleitos da pauta mais recente (com flatten completo)
        const all: PleitoBase[] = [];
        const flat = flattenPleitosFromPauta(pauta);
        flat.forEach((r: any) => {
          const { ncm, produto, pleiteante, tipo } = projectLinha(r);
          const n8 = only8(ncm);
          if (hasNcm && n8.length !== 8) return;
          if (hasNcm && !ncmSet.has(n8)) return;

          const keyRaw = r?.key || r?.id || tryMakeKeyFromRow(r);
          const key = String(keyRaw || "");
          all.push({
            id: key,
            pautaId: pauta.id,
            pleitoKey: key,
            ncm: n8,
            produto,
            pleiteante,
            tipoPleito: tipo,
            tituloSecao: String(r?.__sec || "")
          });
        });

        // 4) Atribuições completas (para status/sugestão e fallback global)
        const s = await getDocs(collection(db, "atribuicoes"));
        const atribsAll: Atrib[] = s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        atribsAll.sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));

        // 5) Mapa de responsável por chave — MESMA FONTE DA PAUTA CAT
        let nomes: Record<string, string> = {};
        try {
          const keys = Array.from(new Set(all.map((p) => p.pleitoKey).filter(Boolean)));
          nomes = await carregarAtribuicoesPorChaves(keys);
        } catch {
          nomes = {};
        }

        setPleitos(all);
        setAtribs(atribsAll);
        setRespPorChave(nomes);
      } catch (e: any) {
        console.error(e);
        setErro(e?.message || "Falha ao carregar dados do Dashboard.");
      } finally {
        setCarregando(false);
      }
    })();
  }, [authLoading, db]);

  /* ==================== JOIN + filtros (nome vindo da Pauta CAT) ==================== */
  const itens = useMemo(() => {
    // Última atribuição por pleitoKey dentro da PAUTA ATUAL (para status/sugestão)
    const byKeyScoped = new Map<string, Atrib>();
    // Última atribuição GLOBAL por pleitoKey (qualquer pauta) — fallback para status/sugestão
    const byKeyGlobal = new Map<string, Atrib>();

    for (const a of atribs) {
      const k = String(a.pleitoKey || "").trim();
      if (!k) continue;

      const prevG = byKeyGlobal.get(k);
      if (!prevG || toMillis(a.updatedAt) > toMillis(prevG?.updatedAt)) byKeyGlobal.set(k, a);

      if (a.pautaId && a.pautaId === pautaAtualId) {
        const prevS = byKeyScoped.get(k);
        if (!prevS || toMillis(a.updatedAt) > toMillis(prevS?.updatedAt)) byKeyScoped.set(k, a);
      }
    }

    let base = pleitos.map((p) => {
      // Status/Sugestão: usa scoped -> global
      const at = byKeyScoped.get(p.pleitoKey) || byKeyGlobal.get(p.pleitoKey) || null;

      // Analista (filtro e exibição): **sempre** o da Pauta CAT quando existir
      const analistaCat = respPorChave[p.pleitoKey] || "";
      const analista = analistaCat || (at?.responsavelNome || at?.analistaNome || (at as any)?.atribuido?.nome || "");

      const sugestao = at?.analise?.sugestao ? String(at.analise.sugestao) : "";
      const status = at?.status || "Não iniciado";

      return { ...p, analista, sugestao, status, _atr: at };
    });

    base = base.filter((it) => (analistaFiltro === "Todos" ? true : nomeMatchesFiltro(it.analista, analistaFiltro)));
    base = base.filter((it) => statusMatchesFiltro(it.status, statusFiltro));
    if (somenteConcluidos) base = base.filter((it) => normalizeStatus(it.status) === "concluido");

    return base;
  }, [pleitos, atribs, respPorChave, analistaFiltro, statusFiltro, somenteConcluidos, pautaAtualId]);

  /* ==================== Resumo + gráfico (layout original) ==================== */
  const resumo = useMemo(() => {
    const acc = { nao_iniciado: 0, em_analise: 0, concluido: 0 };
    for (const it of itens) acc[normalizeStatus(it.status) as keyof typeof acc] += 1;
    return acc;
  }, [itens]);


  /* ==================== Navegação (somente leitura) ==================== */
  const openViewAnalyse = (atr: Atrib) => {
    // Abre a análise existente em modo somente leitura
    nav(`/analise/${encodeURIComponent(atr.id)}?readonly=1`);
  };

  /* ==================== Render (layout intacto) ==================== */
  return (
    <div className="p-6">
      <div className="w-full space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Pleitos CGIM</h1>
            {pautaAtualTitulo && (
              <div className="text-sm text-slate-600">
                Exibindo a pauta mais recente: {pautaAtualTitulo}
              </div>
            )}
          </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            {/* Filtro Analista */}
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 whitespace-nowrap">Analista</label>
              <select
                className="border rounded px-2 py-1 text-sm"
                value={analistaFiltro}
                onChange={(e) => setAnalistaFiltro(e.target.value as typeof ANALISTAS_FIXOS[number])}
              >
                {ANALISTAS_FIXOS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>

            {/* Filtro Status */}
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 whitespace-nowrap">Status do pleito</label>
              <select
                className="border rounded px-2 py-1 text-sm"
                value={statusFiltro}
                onChange={(e) => setStatusFiltro(e.target.value as typeof STATUS_OPCOES[number])}
              >
                {STATUS_OPCOES.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>

            {/* Somente concluídos */}
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={somenteConcluidos}
                onChange={(e) => setSomenteConcluidos(e.target.checked)}
              />
              Somente concluídos
            </label>
          </div>
        </div>

        {avisoNcm && <div className="p-3 border rounded-xl bg-amber-50 text-amber-800">{avisoNcm}</div>}
        {erro && <div className="p-3 border rounded-xl bg-red-50 text-red-700">{erro}</div>}

        {/* Cards + gráfico */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          <div className="p-4 border rounded-xl bg-white/70">
            <div className="text-sm text-gray-500">Total</div>
            <div className="text-3xl font-semibold">{itens.length}</div>
          </div>
          <div className="p-4 border rounded-xl bg-white/70">
            <div className="text-sm text-gray-500">Novo</div>
            <div className="text-3xl font-semibold">{resumo.nao_iniciado}</div>
          </div>
          <div className="p-4 border rounded-xl bg-white/70">
            <div className="text-sm text-gray-500">Em Análise</div>
            <div className="text-3xl font-semibold">{resumo.em_analise}</div>
          </div>
          <div className="p-4 border rounded-xl bg-white/70">
            <div className="text-sm text-gray-500">Concluído</div>
            <div className="text-3xl font-semibold">{resumo.concluido}</div>
          </div>
          {/* Atalho para Minhas Tarefas */}
          <div className="p-4 border rounded-xl bg-white/70">
            <div className="text-sm text-gray-500">Atribuições</div>
            <button
              className="mt-2 px-3 py-1.5 rounded border text-sm hover:bg-gray-50"
              onClick={() => nav("/minhas-tarefas")}
              title="Abrir Minhas Tarefas"
            >
              Ver Minhas Tarefas
            </button>
          </div>
        </div>

        {/* Tabela */}
        <div className="border rounded-xl bg-white/70 overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="p-3 font-medium">NCM</th>
                <th className="p-3 font-medium">Produto</th>
                <th className="p-3 font-medium">Pleiteante</th>
                <th className="p-3 font-medium">Tipo de Pleito</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Sugestão</th>
                <th className="p-3 font-medium">Análise</th>
              </tr>
            </thead>
            <tbody>
              {carregando && <tr><td className="p-3" colSpan={7}>Carregando…</td></tr>}
              {!carregando && itens.length === 0 && <tr><td className="p-3" colSpan={7}>Nenhum pleito encontrado.</td></tr>}
              {!carregando && itens.map((it) => {
                const showSug = !!it.sugestao;
                const rowCls = rowStyleByStatus(it.status);
                const atr = it._atr as Atrib | null;

                return (
                  <tr key={it.pleitoKey} className={`border-t align-top ${rowCls}`}>
                    <td className="p-3">{it.ncm ? `${it.ncm.slice(0,4)}.${it.ncm.slice(4,6)}.${it.ncm.slice(6,8)}` : "—"}</td>
                    <td className="p-3">{it.produto || it.tituloSecao || "—"}</td>
                    <td className="p-3">{it.pleiteante || "—"}</td>
                    <td className="p-3">{it.tipoPleito || "—"}</td>
                    <td className="p-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-white/60 border">
                        {displayStatus(it.status)}
                      </span>
                    </td>
                    <td className="p-3">
                      {showSug ? (
                        <span title={it.sugestao}>
                          {String(it.sugestao).length > 120 ? String(it.sugestao).slice(0,120) + "…" : String(it.sugestao)}
                        </span>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="p-3">
                      {atr ? (
                        <button
                          className="px-3 py-1 rounded border text-sm hover:bg-gray-50"
                          onClick={() => openViewAnalyse(atr)}
                          title="Visualizar análise (somente leitura)"
                        >
                          Ver análise
                        </button>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
};

export default DashboardPage;
