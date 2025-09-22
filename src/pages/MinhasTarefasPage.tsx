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
  orderBy,
  limit,
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
  analise?: {
    resumo?: string;
    comercio?: string;
    tecnica?: string;
    sugestao?: string;
  } | null;

  updatedAt?: any;
};

type AnyRow = Record<string, any>;

type PautaDoc = {
  id: string;
  title?: string;
  slug?: string;
  arquivo?: string;
  meeting?: string;
  reuniao?: string;
  meetingDate?: any;
  updatedAt?: any;
  createdAt?: any;
  isRetificadora?: boolean;
  revIndex?: number;
  diffResumo?: { baseId?: string } | null;

  secoes?: any[];
  sections?: any[];
  tabelas?: any[];
  tables?: any[];
  pleitos?: any[];
};

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
  if (t?.toDate) return t.toDate().getTime?.() || 0;
  if (t?.seconds) return t.seconds * 1000 + (t.nanoseconds || 0) / 1e6;
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

function emailToLikelyNames(email?: string): string[] {
  if (!email) return [];
  const local = email.split("@")[0] || "";
  const parts = local.split(/[.\-_]/).filter(Boolean);
  const cap = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : "");
  const title = parts.map(cap).join(" ").trim();
  return [title].filter(Boolean);
}

function pickKey(row: AnyRow, labels: string[]) {
  const keys = Object.keys(row || {});
  const nk = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const hit =
    keys.find((k) => labels.some((l) => nk(k) === nk(l))) ??
    keys.find((k) => labels.some((l) => nk(k).includes(nk(l))));
  return hit || "";
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
      sec.tabelas.forEach((tb: any) => Array.isArray(tb?.rows) && tb.rows.forEach((r: any) => out.push({ ...r, __sec: secTitle })));
    if (Array.isArray(sec?.tables))
      sec.tables.forEach((tb: any) => Array.isArray(tb?.rows) && tb.rows.forEach((r: any) => out.push({ ...r, __sec: secTitle })));
    if (Array.isArray(sec?.pleitos)) sec.pleitos.forEach((r: any) => out.push({ ...r, __sec: secTitle }));
  }
  if (Array.isArray((pauta as any)?.tabelas))
    (pauta as any).tabelas.forEach((tb: any) => Array.isArray(tb?.rows) && tb.rows.forEach((r: any) => out.push({ ...r, __sec: "" })));
  if (Array.isArray((pauta as any)?.pleitos))
    (pauta as any).pleitos.forEach((r: any) => out.push({ ...r, __sec: "" }));
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

/** Retorna, para cada pauta base, o conjunto de pleitoKeys removidos por retificadoras. */
async function getRemovedKeysByBaseIds(db: any, baseIds: string[]): Promise<Record<string, Set<string>>> {
  const out: Record<string, Set<string>> = {};
  const uniq = Array.from(new Set(baseIds.filter(Boolean)));
  for (const baseId of uniq) {
    try {
      const snap = await getDocs(query(collection(db, "pautas"), where("diffResumo.baseId", "==", baseId)));
      const set = (out[baseId] = out[baseId] || new Set<string>());
      snap.forEach((d) => {
        const p = d.data() as any;
        const arr: any[] = Array.isArray((p as any)?.removidos) ? (p as any).removidos : [];
        for (const r of arr) {
          const key = String((r as any)?.pleitoKey || tryMakeKeyFromRow(r));
          if (key) set.add(key);
        }
      });
    } catch {}
  }
  return out;
}

/** Lista pautas recentes com fallbacks. */
async function fetchRecentPautasRobusto(db: any, max = 24): Promise<PautaDoc[]> {
  const col = collection(db, "pautas");
  try {
    const snap = await getDocs(query(col, orderBy("meetingDate", "desc"), limit(max)));
    const arr: PautaDoc[] = [];
    snap.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
    if (arr.length) return arr;
  } catch {}
  try {
    const snap = await getDocs(query(col, orderBy("updatedAt", "desc"), limit(max)));
    const arr: PautaDoc[] = [];
    snap.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
    if (arr.length) return arr;
  } catch {}
  try {
    const snap = await getDocs(query(col, limit(max)));
    const arr: PautaDoc[] = [];
    snap.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
    return arr;
  } catch {
    return [];
  }
}

/** Calcula vN (número da versão) para retificadoras:
 * - usa revIndex quando existir (vN = revIndex + 1)
 * - senão, consulta TODAS as retificações daquela base, ordena por createdAt/updatedAt asc e infere vN (primeira ⇒ v2)
 */
async function computeVersionNumbers(
  db: any,
  list: PautaDoc[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  // 1) já preenche usando revIndex
  for (const p of list) {
    if (typeof p.revIndex === "number") out.set(p.id, p.revIndex + 1);
  }
  // 2) para as que têm baseId e NÃO têm revIndex, buscamos do Firestore
  const baseIds = Array.from(
    new Set(
      list
        .filter((p) => p?.diffResumo?.baseId && typeof p.revIndex !== "number")
        .map((p) => String(p.diffResumo?.baseId))
        .filter(Boolean)
    )
  );
  for (const baseId of baseIds) {
    try {
      const snap = await getDocs(query(collection(db, "pautas"), where("diffResumo.baseId", "==", baseId)));
      const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as PautaDoc[];
      // Ordena pela data de criação (fallback updatedAt)
      arr.sort((a, b) => (toMillis(a.createdAt) || toMillis(a.updatedAt)) - (toMillis(b.createdAt) || toMillis(b.updatedAt)));
      arr.forEach((p, i) => {
        const vN = typeof p.revIndex === "number" ? p.revIndex + 1 : i + 2;
        out.set(p.id, vN);
      });
    } catch {
      /* ignore */
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

  if (!cand.length) {
    reaproveitoCache.set(k, null);
    return null;
  }

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

  const best = cand[0]?.id || null;
  reaproveitoCache.set(k, best);
  return best;
}

/* ==================== Componente ==================== */
const PIE_COLORS = ["#9ca3af", "#60a5fa", "#34d399"]; // Novo, Em análise, Concluído

// Monta rótulo amigável: adiciona (RETIFICADA vN) quando aplicável
function makePautaLabel(p: PautaDoc, versionMap?: Map<string, number>): string {
  const baseTitle =
    renderStr(p.title, "") ||
    renderStr(p.reuniao, "") ||
    renderStr(p.meeting, "") ||
    renderStr(p.slug, "");

  const ts =
    toMillis(p.meetingDate) ||
    toMillis(p.updatedAt) ||
    toMillis(p.createdAt);

  const mesAno = ts
    ? new Date(ts).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    : "";

  const isRet =
    !!(p?.diffResumo?.baseId || p?.isRetificadora) ||
    /retificad/i.test(String(baseTitle)) ||
    /retificad/i.test(String(p.arquivo || ""));

  const vN = versionMap?.get(p.id);

  const prefix = baseTitle || (mesAno ? `Reunião do CAT — ${mesAno}` : p.id);
  return `${prefix}${isRet ? ` (RETIFICADA${vN ? ` v${vN}` : ""})` : ""}`;
}

const MinhasTarefasPage: React.FC = () => {
  const db = getFirestore();
  const nav = useNavigate();
  const { loading: authLoading, user } = useCurrentUser();

  const [loading, setLoading] = useState(true);
  const [tarefas, setTarefas] = useState<Atribuicao[]>([]);
  const [copyLoading, setCopyLoading] = useState<Record<string, boolean>>({});
  const [priorMap, setPriorMap] = useState<Record<string, string | null>>({}); // atrId -> priorId (ou null)

  // ====== PAUTAS (seletor) ======
  const [pautas, setPautas] = useState<PautaDoc[]>([]);
  const [pautaId, setPautaId] = useState<string>("");
  const [isLoadingPautas, setIsLoadingPautas] = useState<boolean>(true);
  const [versionMap, setVersionMap] = useState<Map<string, number>>(new Map()); // pautaId -> vN

  // Carrega pautas (robusto) e calcula vN
  useEffect(() => {
    if (authLoading) return;
    (async () => {
      setIsLoadingPautas(true);
      try {
        let list = await fetchRecentPautasRobusto(db, 24);

        // Derivar via atribuições se vazio
        if ((!list || list.length === 0) && user) {
          const mine = await fetchAtribuicoesDoUsuario(db, user);
          const ids = Array.from(new Set(mine.map((m) => m.pautaId).filter(Boolean))) as string[];
          if (ids.length) {
            const map = await getPautasByIdsCached(db, ids);
            list = ids.map((id) => map[id]).filter(Boolean) as PautaDoc[];
            list.sort((a, b) => toMillis(b.meetingDate) - toMillis(a.meetingDate));
          }
        }

        setPautas(list || []);
        if (!pautaId && list && list.length) setPautaId(list[0].id);

        // calcula versões (vN) para exibição
        const vmap = await computeVersionNumbers(db, list || []);
        setVersionMap(vmap);
      } catch {
        setPautas([]);
        setVersionMap(new Map());
      } finally {
        setIsLoadingPautas(false);
      }
    })();
  }, [db, authLoading, user]);

  // carrega atribuições do usuário e aplica filtro por pauta
  useEffect(() => {
    if (authLoading || !pautaId) return;
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

        // 2) Filtrar por pauta selecionada
        const mineScoped = mine.filter((a) => (a.pautaId || "") === pautaId);

        // 3) DEDUPE por pauta (já é single pauta)
        const byScopedKey = new Map<string, Atribuicao>();
        for (const a of mineScoped) {
          const ncm8 = onlyDigits(a.ncm).slice(0, 8);
          const produtoNk = normKey(a.produto || "");
          const scopedKey = `${norm(a.pautaId)}|${norm(a.pleitoKey) || `${ncm8}|${produtoNk}`}`;

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

        // 4) completar dados a partir da pauta (com cache)
        const need = merged.filter((l) => !(l.ncm && l.produto && l.tipoPleito && l.tituloSecao));
        if (need.length) {
          const pautasMap = await getPautasByIdsCached(db, [pautaId]);
          const pauta = pautasMap[pautaId];
          if (pauta) {
            const rows = flattenPleitosFromPauta(pauta);
            for (const t of need) {
              // match por key explícita
              let found: AnyRow | undefined = rows.find((r) => {
                const k = String((r as any)?.key || (r as any)?.id || "");
                return t.pleitoKey && k && normKey(k) === normKey(t.pleitoKey);
              });

              // fallback por key derivada
              if (!found && t.pleitoKey) {
                found = rows.find((r) => {
                  const k = tryMakeKeyFromRow(r);
                  return k && normKey(k) === normKey(t.pleitoKey!);
                });
              }

              // fallback por NCM+Produto
              if (!found) {
                const n8 = onlyDigits(t.ncm).slice(0, 8);
                const prodNk = normKey(t.produto || "");
                found = rows.find((r) => {
                  const pr = projectLinha(r);
                  return onlyDigits(pr.ncm).slice(0, 8) === n8 && normKey(pr.produto) === prodNk;
                });
              }

              if (found) {
                const pr = projectLinha(found);
                t.ncm = t.ncm || pr.ncm;
                t.produto = t.produto || pr.produto;
                t.pleiteante = t.pleiteante || pr.pleiteante;
                t.tipoPleito = t.tipoPleito || pr.tipoPleito;
                t.tituloSecao = t.tituloSecao || String((found as any)?.__sec || "");
              }
            }
          }
        }

        // 4.1) marcar RETIRADOS (retificação) somente para a pauta corrente
        try {
          const removedByBase = await getRemovedKeysByBaseIds(db, [pautaId]);
          const keyFor = (t: Atribuicao) => {
            const k = String(t.pleitoKey || "");
            if (k) return k;
            const n8 = onlyDigits(t.ncm).slice(0, 8);
            try {
              return String(gerarPleitoKey({ NCM: n8, Produto: t.produto || "", Pleiteante: t.pleiteante || "" }));
            } catch {}
            return `${n8}|${normKey(t.produto || "")}|${normKey(t.pleiteante || "")}`;
          };
          for (const t of merged) {
            const baseId = pautaId;
            const k = keyFor(t);
            if (baseId && k && removedByBase[baseId]?.has(k)) {
              (t as any).__retirado = true;
            }
          }
        } catch {}

        // 5) ordenar: em_analise > nao_iniciado > concluido; depois por atualização
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

        // 6) PREFETCH: descobrir se há análise anterior por pleitoKey (ignora mesma pauta)
        const entries = await Promise.all(
          merged.map(async (t) => {
            const prior = await findBestPriorAnalysisId(db, t.pleitoKey, pautaId);
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
  }, [authLoading, user, db, pautaId]);

  // ====== gráfico de status (com base no filtro atual) ======
  const resumo = useMemo(() => {
    const c = { em_analise: 0, nao_iniciado: 0, concluido: 0 };
    for (const t of tarefas) c[normalizeStatus(t.status) as keyof typeof c]++;
    return c;
  }, [tarefas]);

  const pieData = useMemo(
    () => [
      { name: "Novo", value: resumo.nao_iniciado },
      { name: "Em análise", value: resumo.em_analise },
      { name: "Concluído", value: resumo.concluido },
    ],
    [resumo]
  );

  const openAnalyse = (t: Atribuicao) => {
    const atrId = t.id || makeAtribuicaoId(t.pleitoKey || "");
    const url = `/analise/${encodeURIComponent(atrId)}`;
    const el = document.activeElement as HTMLElement | null;
    el?.blur?.();
    nav(url);
  };

  function onReaproveitar(t: Atribuicao) {
    const sourceId = priorMap[t.id] || null;
    if (!sourceId) return;
    const atrId = t.id || makeAtribuicaoId(t.pleitoKey || "");
    const url = `/analise/${encodeURIComponent(atrId)}?copyFrom=${encodeURIComponent(sourceId)}`;
    const el = document.activeElement as HTMLElement | null;
    el?.blur?.();
    nav(url);
  }

  const statusBadge = (s?: string) => {
    const n = normalizeStatus(s);
    const map: Record<string, string> = {
      em_analise: "bg-amber-50 border border-amber-200 text-amber-800",
      nao_iniciado: "bg-slate-50 border border-slate-200 text-slate-700",
      concluido: "bg-emerald-50 border border-emerald-200 text-emerald-800",
    };
    const label: Record<string, string> = {
      em_analise: "Em análise",
      nao_iniciado: "Novo",
      concluido: "Concluído",
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${map[n] || ""}`}>
        {label[n] || "—"}
      </span>
    );
  };

  const CardSkeleton: React.FC = () => (
    <div className="rounded-xl border bg-white/70 p-4 animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div className="h-5 w-40 bg-gray-200 rounded" />
        <div className="h-5 w-20 bg-gray-200 rounded" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="h-4 w-full bg-gray-200 rounded" />
        <div className="h-4 w-full bg-gray-200 rounded" />
        <div className="h-4 w-full bg-gray-200 rounded" />
        <div className="h-4 w-1/2 bg-gray-200 rounded" />
      </div>
      <div className="mt-4 h-9 w-28 bg-gray-200 rounded" />
    </div>
  );

  const pautaSelect = useMemo(() => {
    if (isLoadingPautas) {
      return <span className="text-sm text-gray-400">carregando pautas…</span>;
    }
    if (!pautas.length) {
      return <span className="text-sm text-gray-400">nenhuma pauta encontrada ou sem permissão</span>;
    }
    return (
      <select
        className="border rounded px-2 py-1"
        value={pautaId}
        onChange={(e) => setPautaId(e.target.value)}
        aria-label="Selecionar pauta"
      >
        {pautas.map((p) => (
          <option key={p.id} value={p.id}>
            {makePautaLabel(p, versionMap)}
          </option>
        ))}
      </select>
    );
  }, [pautas, pautaId, isLoadingPautas, versionMap]);

  return (
    <div className="w-full space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">Minhas Tarefas</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Filtrar por pauta:</span>
          {pautaSelect}
        </div>
      </div>

      {/* Resumo + gráfico de status */}
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

      {/* ====== Cards ====== */}
      <div className="w-full">
        {/* carregando */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        )}

        {/* lista */}
        {!loading && (
          <>
            {tarefas.length === 0 ? (
              <div className="rounded-xl border bg-white/70 p-8 text-center text-slate-600">
                {pautaId ? "Nenhuma tarefa atribuída a você nesta pauta." : "Selecione uma pauta para listar suas tarefas."}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {tarefas.map((t) => {
                  const canReuse = !!(t.pleitoKey && priorMap[t.id]);
                  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openAnalyse(t);
                    }
                  };

                  return (
                    <div
                      key={t.id}
                      className="rounded-xl border bg-white/70 p-4 hover:shadow-sm transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
                      role="button"
                      tabIndex={0}
                      onClick={() => openAnalyse(t)}
                      onKeyDown={handleKeyDown}
                    >
                      {/* Cabeçalho */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs text-gray-500">{renderStr(t.tituloSecao)}</div>
                          <div className="mt-0.5 font-semibold truncate">{renderStr(t.produto)}</div>
                        </div>
                        {statusBadge(t.status)}
                        {(t as any).__retirado ? (
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800 border border-rose-200">
                            Retirado (retificação)
                          </span>
                        ) : null}
                      </div>

                      {/* Infos principais */}
                      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                        <div className="space-y-1">
                          <div className="text-xs text-gray-500">NCM</div>
                          <div className="font-medium">{fmtNCM(t.ncm)}</div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-gray-500">Tipo de Pleito</div>
                          <div className="font-medium">{renderStr(t.tipoPleito)}</div>
                        </div>
                        <div className="space-y-1 col-span-2">
                          <div className="text-xs text-gray-500">Pleiteante</div>
                          <div className="font-medium truncate">{renderStr(t.pleiteante)}</div>
                        </div>
                      </div>

                      {/* Ações */}
                      <div className="mt-4 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="px-3 py-1.5 rounded border text-sm hover:bg-gray-100"
                          onClick={() => openAnalyse(t)}
                          aria-label="Abrir análise"
                        >
                          Abrir
                        </button>
                        {canReuse && (
                          <button
                            className="px-3 py-1.5 rounded border text-sm hover:bg-gray-100"
                            onClick={() => onReaproveitar(t)}
                            disabled={!!copyLoading[t.id]}
                          >
                            {copyLoading[t.id] ? "Abrindo…" : "Reaproveitar análise anterior"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default MinhasTarefasPage;
