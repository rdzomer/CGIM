// src/pages/DashboardPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  DocumentData,
  Query,
} from "firebase/firestore";
import { getAuth, onAuthStateChanged, User as FBUser } from "firebase/auth";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as ReTooltip,
  Legend as ReLegend,
} from "recharts";
import { getNcmSetCgim } from "../services/ncmsService";
import { makeAtribuicaoId, gerarPleitoKey } from "../services/atribuicoesService";

/* ==================== Tipos ==================== */
type MiniUser = { uid?: string; email?: string; nome?: string } | null;
type PleitoRow = Record<string, any>;

type PleitoBase = {
  id: string;
  pautaId: string;    // id da pauta exibida (doc carregado)
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
const norm = (s?: string) => (s || "").toString().replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
const normKey = (s?: string) => norm(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const onlyDigits = (s?: string) => (s || "").replace(/\D+/g, "");

const toMillis = (t: any): number => {
  if (!t) return 0;
  if (typeof t === "number") return t;
  if (t instanceof Date) return t.getTime();
  if (typeof t?.toMillis === "function") return t.toMillis();
  if (t?.seconds) return t.seconds * 1000 + (t.nanoseconds || 0) / 1e6;
  return 0;
};

const normalizeStatus = (s?: string) => {
  const v = (s || "").toLowerCase();
  if (/conclu[ií]d/.test(v)) return "concluido";
  if (/em[\s_ ]?an[aá]lis/.test(v)) return "em_analise";
  return "nao_iniciado";
};
const displayStatus = (raw?: string) => {
  const n = normalizeStatus(raw);
  if (n === "concluido") return "Concluído";
  if (n === "em_analise") return "Em Análise";
  return "Novo";
};

// headers flexíveis
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
  const kPlt  = pickKey(row, ["Pleiteante","Empresa","Requerente","Solicitante"]);
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
  const n8 = onlyDigits(ncm).slice(0, 8);
  try {
    const k = gerarPleitoKey({ NCM: n8, Produto: produto || "", Pleiteante: pleiteante || "" });
    if (k) return String(k);
  } catch {}
  return `${n8}|${normKey(produto)}|${normKey(pleiteante)}`;
}

const ANALISTAS_FIXOS = ["Todos","Pedro Reckziegel","Ricardo Zomer","Antonio Azambuja"] as const;
const STATUS_OPCOES = ["Todos", "Novo", "Em Análise", "Concluído"] as const;

function nomeMatchesFiltro(nome: string | undefined | null, filtro: typeof ANALISTAS_FIXOS[number]) {
  if (!nome) return false;
  if (filtro === "Todos") return true;
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

/* ========== Melhor análise anterior (batelada por 'in' em chunks de 10) ========== */
async function findBestPriorAnalysisBatch(
  db: any,
  keys: string[],
  excludePautaId: string
): Promise<Record<string, string | null>> {
  const col = collection(db, "atribuicoes");
  const out: Record<string, string | null> = {};
  const uniq = Array.from(new Set(keys.filter(Boolean)));
  const CHUNK = 10;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const slice = uniq.slice(i, i + CHUNK);
    const snap = await getDocs(query(col, where("pleitoKey", "in", slice)));
    const group: Record<string, Atrib[]> = {};
    snap.forEach((d) => {
      const a = { id: d.id, ...(d.data() as any) } as Atrib;
      if (a.pautaId === excludePautaId) return;
      const k = (a.pleitoKey || "").trim();
      if (!k) return;
      (group[k] = group[k] || []).push(a);
    });
    Object.entries(group).forEach(([k, arr]) => {
      arr.sort((a, b) => {
        const rank = (x: Atrib) => {
          const st = normalizeStatus(x.status);
          if (st === "concluido") return 2;
          if (x?.analise?.resumo || x?.analise?.comercio || x?.analise?.tecnica || x?.analise?.sugestao) return 1;
          return 0;
        };
        const r = rank(b) - rank(a);
        if (r !== 0) return r;
        return toMillis(b.updatedAt) - toMillis(a.updatedAt);
      });
      out[k] = arr[0]?.id || null;
    });
  }
  uniq.forEach((k) => { if (!(k in out)) out[k] = null; });
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

  const [analistaFiltro, setAnalistaFiltro] = useState<typeof ANALISTAS_FIXOS[number]>("Todos");
  const [statusFiltro, setStatusFiltro] = useState<typeof STATUS_OPCOES[number]>("Todos");
  const [somenteConcluidos, setSomenteConcluidos] = useState(false);

  const [pautaAtualId, setPautaAtualId] = useState<string>("");
  const [pautaAtualTitulo, setPautaAtualTitulo] = useState<string>("");

  const [pleitos, setPleitos] = useState<PleitoBase[]>([]);
  const [atribs, setAtribs] = useState<Atrib[]>([]);
  const [historicoCount, setHistoricoCount] = useState<number>(0);
  const [priorMap, setPriorMap] = useState<Record<string, string | null>>({}); // pleitoKey -> atribId anterior

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

        // 2) Carrega TODAS as pautas e escolhe **apenas a mais recente**
        const snapP = await getDocs(collection(db, "pautas"));
        const pautasAll = snapP.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        // ordena por meetingDate -> updatedAt -> createdAt -> criadoEm
        pautasAll.sort((a, b) => {
          const ta = toMillis(a.meetingDate) || toMillis(a.updatedAt) || toMillis(a.createdAt || a.criadoEm);
          const tb = toMillis(b.meetingDate) || toMillis(b.updatedAt) || toMillis(b.createdAt || b.criadoEm);
          return tb - ta;
        });
        const pauta = pautasAll[0] || null;
        if (!pauta) {
          setPleitos([]);
          setAtribs([]);
          setHistoricoCount(0);
          setPriorMap({});
          setPautaAtualId("");
          setPautaAtualTitulo("");
          setCarregando(false);
          return;
        }

        setPautaAtualId(pauta.id);
        setPautaAtualTitulo(
          String(pauta.title || pauta.meeting || pauta.reuniao || pauta.slug || pauta.id)
        );

        // 3) Monta lista de pleitos SOMENTE da pauta mais recente
        const all: PleitoBase[] = [];
        const secoes: any[] = Array.isArray(pauta?.sections)
          ? pauta.sections
          : (Array.isArray(pauta?.secoes) ? pauta.secoes : []);

        secoes.forEach((sec: any) => {
          const rows: PleitoRow[] = Array.isArray(sec?.rows) ? sec.rows : [];
          rows.forEach((r: any) => {
            const { ncm, produto, pleiteante, tipo } = projectLinha(r);
            const flags = r?.cgim === true || r?.isCGIM === true || r?.pertenceCGIM === true || r?.inCGIMScope === true;
            const n8 = onlyDigits(ncm).slice(0, 8);
            const aceita = flags || (!hasNcm ? true : (n8.length === 8 && ncmSet.has(n8)));
            if (!aceita) return;

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
              tituloSecao: sec?.title || sec?.titulo || ""
            });
          });
        });

        // 4) Atribuições (com filtro de analista, sem perder nada)
        let atribsAll: Atrib[] = [];
        if (analistaFiltro === "Todos") {
          const s = await getDocs(collection(db, "atribuicoes"));
          atribsAll = s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        } else {
          const col = collection(db, "atribuicoes");
          const qs: Query<DocumentData>[] = [
            query(col, where("analistaNome", "==", analistaFiltro)),
            query(col, where("atribuido.nome", "==", analistaFiltro)),
            query(col, where("responsavelNome", "==", analistaFiltro)),
          ];
          const results = await Promise.all(qs.map((q) => getDocs(q)));
          const tmp: Atrib[] = [];
          results.forEach((snap) => snap.forEach((d) => tmp.push({ id: d.id, ...(d.data() as any) })));
          const uniqA = new Map<string, Atrib>(); tmp.forEach((a) => uniqA.set(a.id, a));
          atribsAll = Array.from(uniqA.values());
        }
        atribsAll.sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));

        setPleitos(all);
        setAtribs(atribsAll);

        // 5) Histórico dinâmico: análises concluídas cuja `pleitoKey` **não** está na pauta atual
        const currentKeys = new Set(all.map((p) => p.pleitoKey));
        let historico = 0;
        for (const a of atribsAll) {
          const k = String(a.pleitoKey || "").trim();
          if (!k) continue;
          const concl = normalizeStatus(a.status) === "concluido";
          const temAnalise = !!(a?.analise?.tecnica || a?.analise?.sugestao || a?.analise?.resumo || a?.analise?.comercio);
          if (concl && temAnalise && !currentKeys.has(k)) historico++;
        }
        setHistoricoCount(historico);

        // 6) Para cada pleito ATUAL, descobre melhor análise anterior (exclui a própria pauta)
        const keys = all.map((p) => p.pleitoKey);
        const prior = await findBestPriorAnalysisBatch(db, keys, pauta.id);
        setPriorMap(prior);

      } catch (e: any) {
        console.error(e);
        setErro(e?.message || "Falha ao carregar dados do Dashboard.");
      } finally {
        setCarregando(false);
      }
    })();
  }, [authLoading, analistaFiltro, db]);

  /* ==================== JOIN + filtros ==================== */
  const itens = useMemo(() => {
    const byKey = new Map<string, Atrib>();
    for (const a of atribs) {
      const k = String(a.pleitoKey || "").trim();
      if (!k) continue;
      const prev = byKey.get(k);
      if (!prev || toMillis(a.updatedAt) > toMillis(prev?.updatedAt)) byKey.set(k, a);
    }

    let base = pleitos.map((p) => {
      const at = byKey.get(p.pleitoKey) || null;
      const analista = at?.responsavelNome || at?.analistaNome || (at as any)?.atribuido?.nome || "";
      const sugestao = at?.analise?.sugestao ? String(at.analise.sugestao) : "";
      const status = at?.status || "Não iniciado";
      return { ...p, analista, sugestao, status, _atr: at };
    });

    // filtros existentes
    base = base.filter((it) => (analistaFiltro === "Todos" ? true : nomeMatchesFiltro(it.analista, analistaFiltro)));
    base = base.filter((it) => statusMatchesFiltro(it.status, statusFiltro));
    if (somenteConcluidos) base = base.filter((it) => normalizeStatus(it.status) === "concluido");

    return base;
  }, [pleitos, atribs, analistaFiltro, statusFiltro, somenteConcluidos]);

  /* ==================== Resumo + gráfico ==================== */
  const resumo = useMemo(() => {
    const acc = { nao_iniciado: 0, em_analise: 0, concluido: 0 };
    for (const it of itens) acc[normalizeStatus(it.status) as keyof typeof acc] += 1;
    return acc;
  }, [itens]);

  const pieData = useMemo(
    () => [
      { name: "Novo", value: resumo.nao_iniciado },
      { name: "Em Análise", value: resumo.em_analise },
      { name: "Concluído", value: resumo.concluido },
    ],
    [resumo]
  );
  const PIE_COLORS = ["#9ca3af", "#60a5fa", "#34d399"];

  const openAnalyse = (pleitoKey: string, atr?: Atrib | null) => {
    const atrId = atr?.id || makeAtribuicaoId(pleitoKey);
    nav(`/analise/${encodeURIComponent(atrId)}`);
  };

  const openAnalyseReuse = (pleitoKey: string, atr?: Atrib | null) => {
    const priorId = priorMap[pleitoKey] || "";
    const atrId = atr?.id || makeAtribuicaoId(pleitoKey);
    const url = priorId
      ? `/analise/${encodeURIComponent(atrId)}?copyFrom=${encodeURIComponent(priorId)}`
      : `/analise/${encodeURIComponent(atrId)}`;
    nav(url);
  };

  /* ==================== Render ==================== */
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
          {/* Histórico dinâmico */}
          <div className="p-4 border rounded-xl bg-white/70">
            <div className="text-sm text-gray-500">Histórico (pleitoKey)</div>
            <div className="text-3xl font-semibold">{historicoCount}</div>
            <button
              className="mt-3 px-3 py-1.5 rounded border text-sm hover:bg-gray-50"
              onClick={() => nav("/minhas-tarefas")}
              title="Abrir Minhas Tarefas para reaproveitar histórico"
            >
              Reaproveitar análises
            </button>
          </div>
        </div>

        <div className="border rounded-xl bg-white/70 p-4">
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} stroke="#fff" strokeWidth={1}>
                  {pieData.map((_, index) => <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}
                </Pie>
                <ReTooltip />
                <ReLegend />
              </PieChart>
            </ResponsiveContainer>
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
                <th className="p-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {carregando && <tr><td className="p-3" colSpan={7}>Carregando…</td></tr>}
              {!carregando && itens.length === 0 && <tr><td className="p-3" colSpan={7}>Nenhum pleito encontrado.</td></tr>}
              {!carregando && itens.map((it) => {
                const showSug = !!it.sugestao;
                const rowCls = rowStyleByStatus(it.status);
                const priorId = priorMap[it.pleitoKey] || null;

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
                      <div className="flex flex-col gap-2">
                        <button
                          className="px-3 py-1 rounded border text-sm hover:bg-gray-50"
                          onClick={() => openAnalyse(it.pleitoKey, it._atr)}
                        >
                          Abrir análise
                        </button>

                        {priorId && (
                          <button
                            className="px-3 py-1 rounded border text-sm hover:bg-gray-50"
                            onClick={() => openAnalyseReuse(it.pleitoKey, it._atr)}
                            title="Há análise anterior para este pleito — clique para reaproveitar"
                          >
                            Reaproveitar análise
                          </button>
                        )}
                      </div>
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
