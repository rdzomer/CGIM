// src/pages/DashboardPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
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

type MiniUser = { uid?: string; email?: string; nome?: string } | null;
type PleitoRow = Record<string, any>;

type PleitoBase = {
  id: string;                // id sintético
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
  analise?: { sugestao?: string } | null;
  ncm?: string;
  produto?: string;
  pleiteante?: string;
  pautaId?: string;
  tituloSecao?: string;
  updatedAt?: any;
};

// ---- helpers ----
const norm = (s?: string) => (s || "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
const normKey = (s?: string) => norm(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const onlyDigits = (s?: string) => (s || "").replace(/\D+/g, "");
const toMillis = (t: any): number => {
  if (!t) return 0;
  if (typeof t === "number") return t;
  if (t instanceof Date) return t.getTime();
  if (typeof t?.toMillis === "function") return t.toMillis();
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

// Mapeia chaves de uma linha arbitrária -> {NCM, Produto, Pleiteante, Tipo de Pleito}
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
  const kNcm = pickKey(row, ["NCM","Código NCM","Codigo NCM","Código","Codigo","NCM 8"]);
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

const ANALISTAS_FIXOS = ["Todos","Pedro Reckziegel","Ricardo Zomer","Antonio Azambuja"] as const;
const STATUS_OPCOES = ["Todos", "Novo", "Em Análise", "Concluído"] as const;

function nomeMatchesFiltro(nome: string | undefined | null, filtro: typeof ANALISTAS_FIXOS[number]) {
  if (!nome) return false;
  if (filtro === "Todos") return true;
  const a = normKey(nome);
  const b = normKey(filtro);
  return a === b || a.replace("antonio","antônio") === b || a.replace("antônio","antonio") === b;
}

function statusMatchesFiltro(statusRaw: string | undefined, filtro: typeof STATUS_OPCOES[number]) {
  if (filtro === "Todos") return true;
  const n = normalizeStatus(statusRaw);
  if (filtro === "Concluído") return n === "concluido";
  if (filtro === "Em Análise") return n === "em_analise";
  return n === "nao_iniciado"; // "Novo"
}

function rowStyleByStatus(statusRaw?: string) {
  const n = normalizeStatus(statusRaw);
  // Fundo e borda lateral esquerda para aumentar a visibilidade
  if (n === "concluido") return "bg-green-50 border-l-4 border-l-green-400";
  if (n === "em_analise") return "bg-blue-50 border-l-4 border-l-blue-300";
  return "bg-white border-l-4 border-l-gray-200";
}

// ---- auth hook ----
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

  const [pleitos, setPleitos] = useState<PleitoBase[]>([]);
  const [atribs, setAtribs] = useState<Atrib[]>([]);

  useEffect(() => {
    if (authLoading) return;
    (async () => {
      setCarregando(true);
      setErro("");
      try {
        // 1) NCMs
        let ncmSet: Set<string> = new Set();
        try { ncmSet = await getNcmSetCgim(); } catch { ncmSet = new Set(); }
        const hasNcm = ncmSet.size > 0;
        setAvisoNcm(hasNcm ? "" : "Aviso: NCMs CGIM não configuradas. Exibindo pleitos detectados sem filtrar por NCM.");

        // 2) Pautas recentes
        const snap = await getDocs(collection(db, "pautas"));
        const pautas = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        pautas.sort((a, b) => toMillis(b.createdAt || b.criadoEm) - toMillis(a.createdAt || a.criadoEm));
        const pautaIds = pautas.slice(0, 5).map((p) => p.id);

        // 3) Linhas CGIM
        const allPleitos: PleitoBase[] = [];
        for (const pautaId of pautaIds) {
          const d = pautas.find((p) => p.id === pautaId)!;
          const sections: any[] = Array.isArray(d?.sections) ? d.sections : Array.isArray(d?.secoes) ? d.secoes : [];
          sections.forEach((sec, si) => {
            const rows: PleitoRow[] = Array.isArray(sec?.rows) ? sec.rows : [];
            rows.forEach((r, ri) => {
              const { ncm, produto, pleiteante, tipo } = projectLinha(r);
              const flags = r?.cgim === true || r?.isCGIM === true || r?.pertenceCGIM === true || r?.inCGIMScope === true;
              const n8 = onlyDigits(ncm).slice(0, 8);
              const aceita = flags || (!hasNcm ? true : (n8.length === 8 && ncmSet.has(n8)));
              if (!aceita) return;
              const key = r?.key || r?.id || gerarPleitoKey({ NCM: n8, Produto: produto || "", Pleiteante: pleiteante || "" }) || `${pautaId}:${si}:${ri}`;
              allPleitos.push({
                id: String(key),
                pautaId,
                pleitoKey: String(key),
                ncm: n8,
                produto,
                pleiteante,
                tipoPleito: tipo,
                tituloSecao: sec?.title || sec?.titulo || ""
              });
            });
          });
        }
        const uniq = new Map<string, PleitoBase>();
        for (const p of allPleitos) if (!uniq.has(p.pleitoKey)) uniq.set(p.pleitoKey, p);
        const pleitosFinal = Array.from(uniq.values()).sort((a, b) => {
          const an = onlyDigits(a.ncm); const bn = onlyDigits(b.ncm);
          if (an !== bn) return an.localeCompare(bn);
          return (a.produto || "").localeCompare(b.produto || "");
        });

        // 4) Atribuições (com filtro de analista, se houver)
        let atribsAll: Atrib[] = [];
        if (analistaFiltro === "Todos") {
          const s = await getDocs(collection(db, "atribuicoes"));
          atribsAll = s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        } else {
          const col = collection(db, "atribuicoes");
          const queriesArr = [
            query(col, where("analistaNome", "==", analistaFiltro)),
            query(col, where("atribuido.nome", "==", analistaFiltro)),
            query(col, where("responsavelNome", "==", analistaFiltro)),
          ];
          const results = await Promise.all(queriesArr.map((q) => getDocs(q)));
          const tmp: Atrib[] = [];
          results.forEach((snap) => snap.forEach((d) => tmp.push({ id: d.id, ...(d.data() as any) })));
          const uniqA = new Map<string, Atrib>(); tmp.forEach((a) => uniqA.set(a.id, a));
          atribsAll = Array.from(uniqA.values());
        }
        atribsAll.sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));

        setPleitos(pleitosFinal);
        setAtribs(atribsAll);
      } catch (e: any) {
        console.error(e);
        setErro(e?.message || "Falha ao carregar dados do Dashboard.");
      } finally {
        setCarregando(false);
      }
    })();
  }, [authLoading, analistaFiltro, db]);

  // JOIN + status/sugestão
  const itens = useMemo(() => {
    const byKey = new Map<string, Atrib>();
    for (const a of atribs) {
      const k = String(a.pleitoKey || "").trim();
      if (!k) continue;
      const prev = byKey.get(k);
      if (!prev || toMillis(a.updatedAt) > toMillis(prev?.updatedAt)) byKey.set(k, a);
    }
    // mapa base
    let base = pleitos.map((p) => {
      const at = byKey.get(p.pleitoKey) || null;
      const analista = at?.responsavelNome || at?.analistaNome || (at as any)?.atribuido?.nome || "";
      const sugestao = at?.analise?.sugestao ? String(at.analise.sugestao) : "";
      const status = at?.status || "Não iniciado";
      return { ...p, analista, sugestao, status, _atr: at };
    });

    // filtro por analista
    base = base.filter((it) => analistaFiltro === "Todos" ? true : nomeMatchesFiltro(it.analista, analistaFiltro));

    // filtro por status (via select)
    base = base.filter((it) => statusMatchesFiltro(it.status, statusFiltro));

    // filtro rápido "somente concluídos"
    if (somenteConcluidos) {
      base = base.filter((it) => normalizeStatus(it.status) === "concluido");
    }

    return base;
  }, [pleitos, atribs, analistaFiltro, statusFiltro, somenteConcluidos]);

  // ====== resumo + gráfico (mantidos) ======
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

  return (
    <div className="p-6">
      <div className="w-full space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold">Pleitos CGIM</h1>

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

        {/* Cards + gráfico de status */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
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

        {/* Tabela — agora COM a coluna Status e linhas coloridas por status */}
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
                const atrId = it._atr?.id || makeAtribuicaoId(it.pleitoKey);
                const rowCls = rowStyleByStatus(it.status);
                return (
                  <tr key={it.pleitoKey} className={`border-t align-top ${rowCls}`}>
                    <td className="p-3">{it.ncm ? `${it.ncm.slice(0,4)}.${it.ncm.slice(4,6)}.${it.ncm.slice(6,8)}` : "—"}</td>
                    <td className="p-3">{it.produto || it.tituloSecao || "—"}</td>
                    <td className="p-3">{it.pleiteante || "—"}</td>
                    <td className="p-3">{it.tipoPleito || "—"}</td>
                    <td className="p-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
                        bg-white/60 border">
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
                      <button
                        className="px-3 py-1 rounded border text-sm hover:bg-gray-50"
                        onClick={() => nav(`/analise/${encodeURIComponent(atrId)}`)}
                      >
                        Abrir análise
                      </button>
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
