// src/pages/MinhasTarefasPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  documentId,
  Query,
  DocumentData,
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
import { makeAtribuicaoId, gerarPleitoKey } from "../services/atribuicoesService";

/* ==================== Tipos ==================== */
type MiniUser = { uid?: string; email?: string; nome?: string } | null;

type Atribuicao = {
  id: string;
  pautaId?: string;
  pleitoKey?: string;

  tituloSecao?: string;
  ncm?: string;
  produto?: string;
  pleiteante?: string;
  tipoPleito?: string;

  analistaUid?: string;
  analistaEmail?: string;
  analistaNome?: string;

  atribuido?: { uid?: string; email?: string; nome?: string } | string;
  atribuidoPara?: { uid?: string; email?: string; nome?: string } | string;
  assignedToUid?: string;
  assignedToEmail?: string;
  assignedToName?: string;

  responsavelUid?: string;
  responsavelEmail?: string;
  responsavelNome?: string;

  assigneeKeys?: string[];

  status?: string;
  updatedAt?: any;
  createdAt?: any;

  analise?: {
    resumo?: string;
    comercio?: string;
    tecnica?: string;
    sugestao?: string;
  };

  [k: string]: any;
};

type AnyRow = Record<string, any>;
type PautaDoc = any;

/* ==================== Helpers ==================== */
const norm = (s?: string) =>
  (s ?? "").toString().replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();

const normKey = (s?: string) =>
  norm(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const onlyDigits = (s?: string) => (s ?? "").replace(/\D+/g, "");

const renderStr = (v: any, fallback = "—") =>
  typeof v === "string" ? (norm(v) || fallback) : typeof v === "number" ? String(v) : fallback;

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

const fmtNCM = (s?: string) => {
  const n8 = onlyDigits(s).slice(0, 8);
  return n8.length === 8 ? `${n8.slice(0, 4)}.${n8.slice(4, 6)}.${n8.slice(6, 8)}` : renderStr(s);
};

/* ====== nomes prováveis com base no e-mail ====== */
function emailToLikelyNames(email?: string): string[] {
  if (!email) return [];
  const local = email.split("@")[0] || "";
  const parts = local.split(/[.\-_]/).filter(Boolean);
  const cap = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : "");
  const title = parts.map(cap).join(" ").trim();
  const set = new Set<string>([title].filter(Boolean) as string[]);
  if (/zomer/i.test(local)) set.add("Ricardo Zomer");
  if (/reck/i.test(local) || /pedro/i.test(local)) set.add("Pedro Reckziegel");
  if (/azambuja|antonio|ant[ôo]nio/i.test(local)) set.add("Antonio Azambuja");
  return Array.from(set);
}

/* ====== util para varrer headers flexíveis ====== */
function pickKey(row: AnyRow, candidates: string[]): string | undefined {
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

function projectLinha(row: AnyRow) {
  const kNcm = pickKey(row, ["NCM", "Código NCM", "Codigo NCM", "Código", "Codigo", "NCM 8"]);
  const kProd = pickKey(row, [
    "Produto",
    "Descrição do Produto",
    "Descricao do Produto",
    "Produto/Descrição",
    "Descrição",
    "Descricao",
  ]);
  const kPlt = pickKey(row, ["Pleiteante", "Empresa", "Requerente", "Solicitante"]);
  const kTipo = pickKey(row, ["Tipo de Pleito", "Tipo", "Pleito", "Pedido"]);
  return {
    ncm: kNcm ? renderStr(row[kNcm], "") : "",
    produto: kProd ? renderStr(row[kProd], "") : "",
    pleiteante: kPlt ? renderStr(row[kPlt], "") : "",
    tipoPleito: kTipo ? renderStr(row[kTipo], "") : "",
  };
}

function tryMakeKeyFromRow(row: AnyRow): string {
  const { ncm, produto, pleiteante } = projectLinha(row);
  const n8 = onlyDigits(ncm).slice(0, 8);
  try {
    const k = gerarPleitoKey({ NCM: n8, Produto: produto || "", Pleiteante: pleiteante || "" });
    if (k) return String(k);
  } catch {}
  return `${n8}|${normKey(produto)}|${normKey(pleiteante)}`;
}

/* ==================== Pauta helpers + cache ==================== */
const pautaCache = new Map<string, PautaDoc>();

function flattenPleitosFromPauta(pauta: PautaDoc) {
  const out: (AnyRow & { __sec?: string })[] = [];
  const secoes = Array.isArray(pauta?.secoes)
    ? pauta.secoes
    : Array.isArray(pauta?.sections)
    ? pauta.sections
    : [];
  for (const sec of secoes) {
    const secTitle = renderStr(sec?.title ?? sec?.titulo ?? "", "");
    if (Array.isArray(sec?.rows)) sec.rows.forEach((r: any) => out.push({ ...r, __sec: secTitle }));
    if (Array.isArray(sec?.tabelas))
      for (const tb of sec.tabelas)
        if (Array.isArray(tb?.rows)) tb.rows.forEach((r: any) => out.push({ ...r, __sec: secTitle }));
    if (Array.isArray(sec?.pleitos)) sec.pleitos.forEach((r: any) => out.push({ ...r, __sec: secTitle }));
    if (Array.isArray(sec?.itens)) sec.itens.forEach((r: any) => out.push({ ...r, __sec: secTitle }));
  }
  if (Array.isArray(pauta?.tabelas))
    for (const tb of pauta.tabelas)
      if (Array.isArray(tb?.rows)) tb.rows.forEach((r: any) => out.push({ ...r, __sec: "" }));
  if (Array.isArray(pauta?.pleitos)) pauta.pleitos.forEach((r: any) => out.push({ ...r, __sec: "" }));
  return out;
}

async function getPautasByIdsCached(db: any, ids: string[]): Promise<Record<string, PautaDoc>> {
  const out: Record<string, PautaDoc> = {};
  const toFetch: string[] = [];
  for (const id of ids) {
    if (pautaCache.has(id)) out[id] = pautaCache.get(id)!;
    else toFetch.push(id);
  }
  if (toFetch.length) {
    const CHUNK = 10;
    for (let i = 0; i < toFetch.length; i += CHUNK) {
      const slice = toFetch.slice(i, i + CHUNK);
      const snap = await getDocs(query(collection(db, "pautas"), where(documentId(), "in", slice)));
      snap.docs.forEach((d) => {
        const v = { id: d.id, ...(d.data() as any) };
        pautaCache.set(d.id, v);
        out[d.id] = v;
      });
    }
  }
  return out;
}

/* ==================== Auth ==================== */
function useCurrentUser(): { loading: boolean; user: MiniUser } {
  const [state, setState] = useState<{ loading: boolean; user: MiniUser }>({
    loading: true,
    user: null,
  });
  useEffect(() => {
    const unsub = onAuthStateChanged(getAuth(), (fb: FBUser | null) => {
      if (!fb) setState({ loading: false, user: null });
      else
        setState({
          loading: false,
          user: { uid: fb.uid, email: fb.email || undefined, nome: fb.displayName || undefined },
        });
    });
    return () => unsub();
  }, []);
  return state;
}

/* ==================== Firestore helpers (paralelas) ==================== */
async function runQueriesUnionParallel(qs: Query<DocumentData>[]): Promise<Atribuicao[]> {
  const snaps = await Promise.allSettled(qs.map((qx) => getDocs(qx)));
  const map: Record<string, Atribuicao> = {};
  for (const r of snaps) {
    if (r.status !== "fulfilled") continue;
    r.value.forEach((d) => (map[d.id] = { id: d.id, ...(d.data() as any) }));
  }
  return Object.values(map);
}

/** Consulta cobre UID, e-mail, nome e variantes; tenta antes assigneeKeys. */
async function fetchAtribuicoesDoUsuario(db: any, user: NonNullable<MiniUser>): Promise<Atribuicao[]> {
  const col = collection(db, "atribuicoes");
  const uid = user.uid || "";
  const email = (user.email || "").toLowerCase();
  const names = new Set<string>([user.nome || "", ...emailToLikelyNames(email)]);
  const keys = Array.from(new Set<string>([uid, email, ...Array.from(names)].filter(Boolean)));
  const qs: Query<DocumentData>[] = [];

  if (keys.length) {
    const CHUNK = 10;
    for (let i = 0; i < keys.length; i += CHUNK) {
      const slice = keys.slice(i, i + CHUNK);
      qs.push(query(col, where("assigneeKeys", "array-contains-any", slice)));
    }
  }

  if (uid) {
    qs.push(query(col, where("analistaUid", "==", uid)));
    qs.push(query(col, where("responsavelUid", "==", uid)));
    qs.push(query(col, where("atribuido.uid", "==", uid)));
    qs.push(query(col, where("atribuidoPara.uid", "==", uid)));
    qs.push(query(col, where("assignedToUid", "==", uid)));
  }
  if (email) {
    qs.push(query(col, where("analistaEmail", "==", email)));
    qs.push(query(col, where("responsavelEmail", "==", email)));
    qs.push(query(col, where("atribuido.email", "==", email)));
    qs.push(query(col, where("atribuidoPara.email", "==", email)));
    qs.push(query(col, where("assignedToEmail", "==", email)));
    qs.push(query(col, where("atribuido", "==", email)));
  }
  for (const nome of Array.from(names).filter(Boolean)) {
    qs.push(query(col, where("analistaNome", "==", nome)));
    qs.push(query(col, where("responsavelNome", "==", nome)));
    qs.push(query(col, where("atribuido.nome", "==", nome)));
    qs.push(query(col, where("atribuidoPara.nome", "==", nome)));
    qs.push(query(col, where("assignedToName", "==", nome)));
    qs.push(query(col, where("atribuido", "==", nome)));
  }

  return runQueriesUnionParallel(qs);
}

/* ==================== Busca da melhor análise anterior ==================== */
const reaproveitoCache = new Map<string, string | null>(); // pleitoKey -> atribuiçãoId (ou null)

async function findBestPriorAnalysisId(
  db: any,
  pleitoKey?: string,
  excludePautaId?: string
): Promise<string | null> {
  const k = (pleitoKey || "").trim();
  if (!k) return null;

  if (reaproveitoCache.has(k)) return reaproveitoCache.get(k)!;

  const col = collection(db, "atribuicoes");
  const snap = await getDocs(query(col, where("pleitoKey", "==", k)));
  const cand: Atribuicao[] = [];
  snap.forEach((d) => {
    const a = { id: d.id, ...(d.data() as any) } as Atribuicao;
    if (excludePautaId && a.pautaId === excludePautaId) return;
    cand.push(a);
  });

  cand.sort((a, b) => {
    const rank = (x: Atribuicao) => {
      const st = normalizeStatus(x.status);
      if (st === "concluido") return 2;
      if (x?.analise?.resumo || x?.analise?.comercio || x?.analise?.tecnica || x?.analise?.sugestao)
        return 1;
      return 0;
    };
    const r = rank(b) - rank(a);
    if (r !== 0) return r;
    return toMillis(b.updatedAt) - toMillis(a.updatedAt);
  });

  const best = cand[0];
  const bestId = best ? best.id : null;
  reaproveitoCache.set(k, bestId);
  return bestId;
}

/* ==================== Página ==================== */
const MinhasTarefasPage: React.FC = () => {
  const db = getFirestore();
  const nav = useNavigate();
  const { loading: authLoading, user } = useCurrentUser();

  const [loading, setLoading] = useState(true);
  const [tarefas, setTarefas] = useState<Atribuicao[]>([]);
  const [copyLoading, setCopyLoading] = useState<Record<string, boolean>>({});
  const [priorMap, setPriorMap] = useState<Record<string, string | null>>({}); // atrId -> priorId (ou null)

  useEffect(() => {
    if (authLoading) return;
    (async () => {
      setLoading(true);
      try {
        if (!user) {
          setTarefas([]);
          setPriorMap({});
          return;
        }

        // 1) atribuições do usuário
        const mine = await fetchAtribuicoesDoUsuario(db, user);

        // 2) DEDUPE por pauta: chave = pautaId|pleitoKey (fallback pautaId|NCM8|Produto)
        const byScopedKey = new Map<string, Atribuicao>();
        for (const a of mine) {
          const ncm8 = onlyDigits(a.ncm).slice(0, 8);
          const produtoNk = normKey(a.produto || "");
          const scopedKey = `${norm(a.pautaId)}|${
            norm(a.pleitoKey) || `${ncm8}|${produtoNk}`
          }`;

        const prev = byScopedKey.get(scopedKey);
        if (!prev) byScopedKey.set(scopedKey, a);
        else {
            const pick =
              toMillis(a.updatedAt) > toMillis(prev.updatedAt)
                ? a
                : toMillis(a.updatedAt) < toMillis(prev.updatedAt)
                ? prev
                : a.produto
                ? a
                : prev;
            byScopedKey.set(scopedKey, pick);
          }
        }
        const merged = Array.from(byScopedKey.values());

        // 3) completar dados a partir da pauta (com cache)
        const need = merged.filter(
          (l) => !(l.ncm && l.produto && l.tipoPleito && l.tituloSecao)
        );
        if (need.length) {
          const pautaIds = Array.from(new Set(need.map((l) => l.pautaId).filter(Boolean))) as string[];
          const pautas = await getPautasByIdsCached(db, pautaIds);
          for (const t of need) {
            const pauta = pautas[t.pautaId || ""];
            if (!pauta) continue;
            const rows = flattenPleitosFromPauta(pauta);

            // match por key explícita
            let found: AnyRow | undefined = rows.find((r) => {
              const k = String((r as any)?.key || (r as any)?.id || "");
              return t.pleitoKey && k && normKey(k) === normKey(t.pleitoKey);
            });

            // fallback por key derivada
            if (!found && t.pleitoKey) {
              found = rows.find((r) => {
                const k = tryMakeKeyFromRow(r);
                return k && normKey(k) === normKey(t.pleitoKey);
              });
            }

            if (found) {
              const proj = projectLinha(found);
              t.ncm = t.ncm || proj.ncm;
              t.produto = t.produto || proj.produto;
              t.pleiteante = t.pleiteante || proj.pleiteante;
              t.tipoPleito = t.tipoPleito || proj.tipoPleito;
              t.tituloSecao = t.tituloSecao || renderStr((found as any).__sec, "");
            }
          }
        }

        // 4) ordenação
        merged.sort((a, b) => {
          const rank = (s?: string) => {
            const n = normalizeStatus(s);
            if (n === "em_analise") return 0;
            if (n === "nao_iniciado") return 1;
            return 2;
          };
          const r = rank(a.status) - rank(b.status);
          if (r !== 0) return r;
          return toMillis(b.updatedAt) - toMillis(a.updatedAt);
        });

        setTarefas(merged);

        // 5) PREFETCH: descobrir se há análise anterior por pleitoKey
        const entries = await Promise.all(
          merged.map(async (t) => {
            const prior = await findBestPriorAnalysisId(db, t.pleitoKey, t.pautaId);
            return [t.id, prior] as const;
          })
        );
        const map: Record<string, string | null> = {};
        entries.forEach(([id, prior]) => (map[id] = prior));
        setPriorMap(map);
      } finally {
        setLoading(false);
      }
    })();
  }, [authLoading, user, db]);

  // ====== gráfico de status ======
  const resumo = useMemo(() => {
    const acc = { nao_iniciado: 0, em_analise: 0, concluido: 0 };
    for (const t of tarefas) acc[normalizeStatus(t.status) as keyof typeof acc] += 1;
    return acc;
  }, [tarefas]);

  const pieData = useMemo(
    () => [
      { name: "Novo", value: resumo.nao_iniciado },
      { name: "Em Análise", value: resumo.em_analise },
      { name: "Concluído", value: resumo.concluido },
    ],
    [resumo]
  );
  const PIE_COLORS = ["#9ca3af", "#60a5fa", "#34d399"];

  // ====== ação: reaproveitar análise ======
  function openAnalyse(t: Atribuicao) {
    const atrId = t.id || makeAtribuicaoId(t.pleitoKey || "");
    const url = `/analise/${encodeURIComponent(atrId)}`;
    nav(url);
  }

  function onReaproveitar(t: Atribuicao) {
    const sourceId = priorMap[t.id] || null;
    if (!sourceId) return;
    const atrId = t.id || makeAtribuicaoId(t.pleitoKey || "");
    const url = `/analise/${encodeURIComponent(atrId)}?copyFrom=${encodeURIComponent(sourceId)}`;
    nav(url);
  }

  return (
    <div className="w-full space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Minhas Tarefas</h1>
      </div>

      {/* Cards + gráfico de status */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        <div className="p-4 border rounded-xl bg-white/70">
          <div className="text-sm text-gray-500">Total</div>
          <div className="text-3xl font-semibold">{tarefas.length}</div>
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
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} stroke="#fff" strokeWidth={1}>
                {pieData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <ReTooltip />
              <ReLegend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tabela — linhas clicáveis (SEM a coluna Status) */}
      <div className="bg-white rounded border overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-3 text-left">Seção</th>
              <th className="p-3 text-left">NCM</th>
              <th className="p-3 text-left">Produto</th>
              <th className="p-3 text-left">Pleiteante</th>
              <th className="p-3 text-left">Tipo</th>
              <th className="p-3 text-left w-56">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td className="p-4 text-gray-500" colSpan={6}>
                  Carregando…
                </td>
              </tr>
            )}
            {!loading && tarefas.length === 0 && (
              <tr>
                <td className="p-4 text-gray-500" colSpan={6}>
                  Nenhuma tarefa atribuída a você.
                </td>
              </tr>
            )}
            {!loading &&
              tarefas.map((t) => {
                const canReuse = !!(t.pleitoKey && priorMap[t.id]);
                return (
                  <tr
                    key={t.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => openAnalyse(t)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openAnalyse(t);
                      }
                    }}
                  >
                    <td className="p-3">{renderStr(t.tituloSecao)}</td>
                    <td className="p-3">{fmtNCM(t.ncm)}</td>
                    <td className="p-3">{renderStr(t.produto)}</td>
                    <td className="p-3">{renderStr(t.pleiteante)}</td>
                    <td className="p-3">{renderStr(t.tipoPleito)}</td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-2">
                        <button
                          className="px-3 py-1 rounded border text-sm hover:bg-gray-100"
                          onClick={() => openAnalyse(t)}
                          aria-label="Abrir análise"
                        >
                          Abrir
                        </button>
                        {canReuse && (
                          <button
                            className="px-3 py-1 rounded border text-sm hover:bg-gray-100"
                            onClick={() => onReaproveitar(t)}
                            aria-label="Reaproveitar análise anterior"
                            title="Reaproveitar análise anterior"
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
  );
};

export default MinhasTarefasPage;
