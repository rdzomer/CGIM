// src/pages/RelatorioConsolidadoPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc,
  query,
  where,
} from "firebase/firestore";
import { Download, Printer } from "lucide-react";
import { exportRelatorioDocx, CabecalhoRelatorio } from "../services/relatorioExport";

/** ===================== Utils ===================== */
const norm = (s?: any) =>
  String(s ?? "")
    .replace(/\u00A0/g, " ")      // NBSP -> espaço normal
    .replace(/\s+/g, " ")
    .trim();

/** Normaliza mantendo quebras de linha (não colapsa \n) */
const normKeepBreaks = (s?: any) => {
  let t = String(s ?? "");
  t = t.replace(/\u00A0/g, " ");
  t = t
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n");
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return t;
};

const normKey = (s?: any) =>
  norm(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const softKey = (s?: any) =>
  normKey(s)
    .replace(/[^\w|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const only8 = (s?: any) => norm(s).replace(/\D+/g, "").slice(0, 8);

const fmtNcm = (s?: any) => {
  const n = only8(s);
  return n.length === 8 ? `${n.slice(0, 4)}.${n.slice(4, 6)}.${n.slice(6, 8)}` : norm(s);
};

const normalizeStatus = (s?: string) => {
  const v = (s || "").toLowerCase();
  if (/conclu[ií]d/.test(v)) return "concluido";
  if (/andament|em[\s_]?anal/.test(v)) return "em_analise";
  return "nao_iniciado";
};

/** Escapa HTML */
function escapeHtml(input?: any) {
  const str = String(input ?? "");
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return str.replace(/[&<>"']/g, (ch) => map[ch]);
}

/** \n -> <br/> (com escape) */
function renderWithBreaks(input?: any) {
  if (input == null) return "";
  const esc = escapeHtml(String(input));
  return esc.replace(/\n/g, "<br/>");
}

/**
 * Limpa HTML preservando quebras:
 * - Converte <br> em \n
 * - Converte transições e fechamentos de tags de BLOCO em \n antes de remover as tags
 * - Remove o restante, normaliza e mantém \n
 */
function cleanRichText(input?: any) {
  let t = String(input ?? "");
  if (!t) return "";

  // 1) normalizações simples
  t = t
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/[\u2000-\u200B]/g, " ") // espaços finos/zero-width
    .replace(/[–—−]/g, "-");

  // 2) <br> => \n
  t = t.replace(/<\s*br\s*\/?>/gi, "\n");

  // 3) separadores de parágrafo/lista entre blocos comuns => \n
  const block = "(?:p|div|li|h[1-6]|tr|section|article|blockquote|pre|ul|ol)";
  // a) ...</block>\s*<block>... => adiciona quebra
  t = t.replace(new RegExp(`</\\s*${block}\\s*>\\s*<\\s*${block}\\s*>`, "gi"), "\n");
  // b) fechamento de block => quebra
  t = t.replace(new RegExp(`</\\s*${block}\\s*>`, "gi"), "\n");
  // c) abertura de <li> sugere novo item (caso não venha com </li> anterior)
  t = t.replace(/<\s*li[^>]*>/gi, "\n");

  // 4) </p><p> padrão (por redundância)
  t = t.replace(/<\/p>\s*<p>/gi, "\n");

  // 5) remove demais tags
  t = t.replace(/<[^>]+>/g, " ");

  // 6) normalização preservando \n
  t = normKeepBreaks(t);

  // 7) linhas só com traços => vazio
  if (/^[-–—]+$/.test(t)) return "";
  return t;
}

function hasTecnicaOuSugestaoBloco(bl?: AnaliseBloco | null) {
  if (!bl) return false;
  const t = cleanRichText(bl.tecnica);
  const s = cleanRichText(bl.sugestao);
  return t.length > 0 || s.length > 0;
}

/** ===================== Tipos ===================== */
type PautaDoc = {
  id: string;
  meeting?: string;
  tituloArquivo?: string;
  createdAt?: any;
  sections?: any[];
  secoes?: any[]; // legado
  diffResumo?: { baseId?: string } | null;
  isRetificadora?: boolean;
};

type AnaliseBloco = {
  resumo?: string;
  comercio?: string;
  tecnica?: string;
  sugestao?: string;
} | null;

type Atribuicao = {
  id: string;
  pautaId?: string;
  pleitoKey?: string;
  tituloSecao?: string;
  ncm?: string;
  produto?: string;
  pleiteante?: string;
  tipoPleito?: string;
  status?: string;
  analise?: AnaliseBloco | (AnaliseBloco & { analiseTecnica?: string; sugestaoCgim?: string }) | null;
  updatedAt?: any;
  // campos legados (raiz)
  resumo?: string;
  dadosComercio?: string;
  analiseTecnica?: string;
  sugestaoCgim?: string;
};

type ItemRelatorio = {
  indice: number;
  secaoTitulo: string;
  tipoPleito: string;
  ncm: string;
  produto: string;
  pleiteante: string;
  infoDaPauta: Record<string, string>;
  analise: NonNullable<AnaliseBloco>;
  atribId?: string;
};

type PautaOption = {
  id: string;
  meeting: string;
  titulo: string;
  isRet: boolean;
  baseKey: string;
  createdAtMs: number;
  versaoRet?: number;
};

/** ===================== Helpers de pauta ===================== */
function retBaseKey(meeting?: string) {
  const s = norm(meeting);
  return s.replace(/\(retificad[ao](?:[^)]*)?\)/gi, "").replace(/\s+/g, " ").trim();
}

function flattenPauta(p: PautaDoc): Array<{ secao: string; row: any }> {
  const out: Array<{ secao: string; row: any }> = [];
  const list =
    (Array.isArray(p.sections) ? p.sections : undefined) ??
    (Array.isArray(p.secoes) ? p.secoes : undefined) ??
    [];

  const pushRows = (secTitle: string, rows?: any[]) => {
    if (!Array.isArray(rows)) return;
    rows.forEach((r) => out.push({ secao: secTitle, row: r }));
  };

  for (const sec of list as any[]) {
    const secTitle = String(sec?.title ?? sec?.titulo ?? "") || "";
    pushRows(secTitle, sec?.rows);
    if (Array.isArray(sec?.tabelas)) {
      for (const t of sec.tabelas) pushRows(secTitle, t?.rows);
    }
    if (Array.isArray(sec?.tables)) {
      for (const t of sec.tables) pushRows(secTitle, t?.rows);
    }
  }
  return out;
}

/** Mapeia campos core de uma linha de pauta */
function projectLinha(row: Record<string, any>) {
  const keys = Object.keys(row || {});
  const by = (labels: string[]) => {
    const hit =
      keys.find((k) => labels.some((l) => normKey(k) === normKey(l))) ??
      keys.find((k) => labels.some((l) => normKey(k).includes(normKey(l))));
    return hit ? String(row[hit] ?? "") : "";
  };

  const ncm = by(["NCM", "Código NCM", "Codigo NCM", "Código", "Codigo", "NCM 8"]);
  const produto = by([
    "Produto",
    "Descrição do Produto",
    "Descricao do Produto",
    "Produto/Descrição",
    "Produto/Descricao",
    "Descrição",
    "Descricao",
  ]);
  const pleiteante = by(["Pleiteante", "Requerente", "Solicitante", "Empresa"]);
  const tipoPleito = by(["Tipo de Pleito", "Tipo do Pleito", "Tipo", "Pleito", "Pedido"]);

  return { ncm, produto, pleiteante, tipoPleito };
}

/** Gera a mesma chave usada nas atribuições (com normalização tolerante) */
function gerarPleitoKeyFromRow(row: any) {
  const { ncm, produto, pleiteante } = projectLinha(row);
  const key = [only8(ncm), softKey(produto), softKey(pleiteante)].filter(Boolean).join("|");
  return key;
}

/** Consolida análise a partir de todos os formatos possíveis (novo e legados) */
function unificarAnalise(a: Atribuicao): NonNullable<AnaliseBloco> {
  const an = (a.analise ?? {}) as any;
  const resumo =
    cleanRichText(an?.resumo) || cleanRichText(a.resumo);
  const comercio =
    cleanRichText(an?.comercio) || cleanRichText(a.dadosComercio);
  const tecnica =
    cleanRichText(an?.tecnica) ||
    cleanRichText(an?.analiseTecnica) ||   // legado aninhado
    cleanRichText(a.analiseTecnica);       // legado raiz
  const sugestao =
    cleanRichText(an?.sugestao) ||
    cleanRichText(an?.sugestaoCgim) ||     // legado aninhado
    cleanRichText(a.sugestaoCgim);         // legado raiz

  return { resumo, comercio, tecnica, sugestao };
}

/** Heurística: remover artefatos de OCR/planilha como "Col_1", etc. */
function isColArtefact(key: string) {
  const k = normKey(key);
  if (/^col[\s._-]*\d+$/.test(k)) return true;
  if (/^col[\s._-]*\d+\s*\(.+\)$/.test(k)) return true;
  if (/^col\.\s*\d+$/.test(k)) return true;
  return false;
}

/** Normaliza o título da seção */
function normalizarSecao(input: string) {
  const original = norm(input);
  let nk = normKey(original)
    .replace(/^\s*\d+(?:\.\d+)*\s+/, "")
    .replace(/\s+(no|na)\s+cat\b/g, "")
    .replace(/\s+(no|na)\s+comit[eê]\b/g, "")
    .trim();
  if (/\bpleitos?\s+novos?\b/.test(nk)) return "Pleitos Novos";
  if (/\breanalisad/.test(nk)) return "Pleitos Reanalisados";
  return original.replace(/^\s*\d+(?:\.\d+)*\s+/, "").replace(/\s+(no|na)\s+CAT\b/i, "").trim();
}

/** ===================== Página ===================== */
const RelatorioConsolidadoPage: React.FC = () => {
  const db = getFirestore();
  const [sp, setSp] = useSearchParams();

  const [pautas, setPautas] = useState<PautaOption[]>([]);
  const [pautaSel, setPautaSel] = useState<string>(""); // pautaId
  const [pautaDoc, setPautaDoc] = useState<PautaDoc | null>(null);

  const [atribuicoes, setAtribuicoes] = useState<Atribuicao[]>([]);
  const [loading, setLoading] = useState(true);

  // Carrega opções de pautas (dropdown)
  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, "pautas"));
      const temp: Omit<PautaOption, "versaoRet">[] = [];
      snap.forEach((d) => {
        const v = d.data() as any;
        const meetingRaw = String(v?.meeting || v?.titulo || d.id || "");
        const fileTitle = String(v?.tituloArquivo || v?.fileName || "");
        const isRet =
          !!(v?.diffResumo?.baseId || v?.isRetificadora) ||
          /retificad/i.test(meetingRaw) ||
          /retificad/i.test(fileTitle);
        const meeting = `${meetingRaw}${isRet ? " (RETIFICADA)" : ""}`;
        const baseKey = String(
          v?.diffResumo?.baseId ||
            retBaseKey(meetingRaw) ||
            retBaseKey(fileTitle) ||
            retBaseKey(d.id)
        );
        const createdAtMs =
          typeof v?.createdAt?.toMillis === "function"
            ? v.createdAt.toMillis()
            : v?.createdAt instanceof Date
            ? v.createdAt.getTime()
            : 0;
        temp.push({
          id: d.id,
          meeting,
          titulo: String(v?.titulo || v?.meeting || ""),
          isRet,
          baseKey,
          createdAtMs,
        });
      });

      // numera retificações por baseKey
      const byBase = new Map<string, PautaOption[]>();
      for (const p of temp) {
        const arr = byBase.get(p.baseKey) || [];
        arr.push({ ...p, versaoRet: undefined });
        byBase.set(p.baseKey, arr);
      }
      const out: PautaOption[] = [];
      byBase.forEach((arr) => {
        const sorted = arr.sort((a, b) => a.createdAtMs - b.createdAtMs);
        let v = 0;
        for (const it of sorted) {
          if (it.isRet) {
            v += 1;
            out.push({ ...it, versaoRet: v });
          } else {
            out.push({ ...it, versaoRet: undefined });
          }
        }
      });

      const opts = out
        .map((o) => {
          const hasV = o.isRet && o.versaoRet && o.versaoRet > 0;
          const meetingLabel = hasV
            ? String(o.meeting || "").replace(/\(RETIFICADA\)/i, `(RETIFICADA v${o.versaoRet})`)
            : o.meeting;
          return { ...o, meeting: meetingLabel || o.meeting };
        })
        .sort((a, b) => b.createdAtMs - a.createdAtMs);

      setPautas(opts);

      const urlPid = sp.get("pautaId") || sp.get("pauta") || "";
      const def = urlPid || (opts.length ? opts[0].id : "");
      if (def) setPautaSel(def);
    })().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Atualiza URL quando muda seleção
  useEffect(() => {
    if (!pautaSel) return;
    const next = new URLSearchParams(sp);
    next.set("pautaId", pautaSel);
    setSp(next, { replace: true });
  }, [pautaSel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Carrega pauta selecionada
  useEffect(() => {
    if (!pautaSel) return;
    (async () => {
      setLoading(true);
      try {
        const ref = doc(db, "pautas", pautaSel);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setPautaDoc(null);
          setAtribuicoes([]);
          return;
        }
        const v = snap.data() as any;
        setPautaDoc({ id: snap.id, ...v });
      } finally {
        setLoading(false);
      }
    })();
  }, [pautaSel, db]);

  // Carrega atribuições da pauta e complementa por pleitoKey
  useEffect(() => {
    if (!pautaSel) return;
    (async () => {
      setLoading(true);
      try {
        const col = collection(db, "atribuicoes");
        const arr: Atribuicao[] = [];

        const snap1 = await getDocs(query(col, where("pautaId", "==", pautaSel)));
        snap1.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));

        if (pautaDoc) {
          const rows = flattenPauta(pautaDoc);
          const keysSet = new Set<string>();
          for (const { row } of rows) {
            const k = gerarPleitoKeyFromRow(row);
            if (k) keysSet.add(softKey(k));
          }

          const jaTem = new Set<string>(
            arr.map((a) => softKey(String(a.pleitoKey || ""))).filter(Boolean)
          );

          const missing = Array.from(keysSet).filter((k) => k && !jaTem.has(k));

          for (let i = 0; i < missing.length; i += 10) {
            const chunk = missing.slice(i, i + 10);
            const snap2 = await getDocs(query(col, where("pleitoKey", "in", chunk)));
            snap2.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
          }
        }

        const dedupMap = new Map<string, Atribuicao>();
        for (const a of arr) dedupMap.set(a.id, a);
        const dedup = Array.from(dedupMap.values());

        const ajustados = dedup.map((a) => ({ ...a, status: normalizeStatus(a.status) }));

        setAtribuicoes(ajustados);
      } finally {
        setLoading(false);
      }
    })().catch(console.error);
  }, [pautaSel, pautaDoc, db]);

  /** Monta itens finais seguindo a ordem da pauta. */
  const itensBase: ItemRelatorio[] = useMemo(() => {
    if (!pautaDoc) return [];

    const rows = flattenPauta(pautaDoc);
    const out: ItemRelatorio[] = [];
    let i = 1;

    const byKey = new Map<string, Atribuicao>();
    const byPair = new Map<string, Atribuicao>();   // ncm|produto (soft)
    const byPair2 = new Map<string, Atribuicao>();  // ncm|pleiteante (soft)

    for (const a of atribuicoes) {
      const ncm8 = only8(a.ncm);
      const prod = softKey(a.produto);
      const pl = softKey(a.pleiteante || "");
      const pair = `${ncm8}|${prod}`;
      const pair2 = `${ncm8}|${pl}`;
      if (a.pleitoKey) byKey.set(softKey(a.pleitoKey), a);
      if (ncm8 && prod) byPair.set(pair, a);
      if (ncm8 && pl) byPair2.set(pair2, a);
    }

    function isOk(at?: Atribuicao) {
      if (!at) return false;
      if (normalizeStatus(at.status) !== "concluido") return false;
      const an = unificarAnalise(at);
      return hasTecnicaOuSugestaoBloco(an);
    }

    for (const { secao, row } of rows) {
      const { ncm, produto, pleiteante, tipoPleito } = projectLinha(row);
      const keySoft = gerarPleitoKeyFromRow(row);
      const n8 = only8(ncm);
      const prodSoft = softKey(produto);
      const pleitSoft = softKey(pleiteante);

      let a: Atribuicao | undefined =
        byKey.get(keySoft) ||
        byPair.get(`${n8}|${prodSoft}`) ||
        byPair2.get(`${n8}|${pleitSoft}`);

      if (!a && n8) {
        const cands = atribuicoes.filter((x) => only8(x.ncm) === n8);
        const found = cands.find((x) => {
          const ps = softKey(x.produto);
          return ps && prodSoft && (ps.includes(prodSoft) || prodSoft.includes(ps));
        });
        if (found) a = found;
      }

      if (!a && n8) {
        const cands = atribuicoes.filter((x) => only8(x.ncm) === n8);
        const found = cands.find((x) => {
          const pls = softKey(x.pleiteante || "");
          return pls && pleitSoft && (pls.includes(pleitSoft) || pleitSoft.includes(pls));
        });
        if (found) a = found;
      }

      if (!a) {
        let best: { a: Atribuicao; score: number } | null = null;
        for (const x of atribuicoes) {
          let s = 0;
          if (only8(x.ncm) === n8 && n8) s += 2;
          const xp = softKey(x.produto);
          const xl = softKey(x.pleiteante || "");
          if (xp && prodSoft) s += xp === prodSoft ? 2 : (xp.includes(prodSoft) || prodSoft.includes(xp) ? 1 : 0);
          if (xl && pleitSoft) s += xl === pleitSoft ? 2 : (xl.includes(pleitSoft) || pleitSoft.includes(xl) ? 1 : 0);
          if (s > 2 && (!best || s > best.score)) best = { a: x, score: s };
        }
        if (best) a = best.a;
      }

      if (!isOk(a)) continue;

      const info: Record<string, string> = {};
      Object.entries(row || {}).forEach(([k, v]) => {
        const nk = normKey(k);
        if (
          [
            "ncm","código ncm","codigo ncm","código","codigo","ncm 8",
            "produto","descrição","descricao",
            "pleiteante","requerente","solicitante","empresa",
            "tipo de pleito","tipo do pleito","tipo","pleito","pedido",
          ].includes(nk)
        ) return;
        if (["id","key","pleitokey"].includes(nk)) return;
        if (isColArtefact(k)) return;
        if (v == null) return;
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          info[k] = String(v);
        }
      });

      const analise = unificarAnalise(a!);

      out.push({
        indice: i++,
        secaoTitulo: normalizarSecao(String(a?.tituloSecao || secao || "")),
        tipoPleito: String(a?.tipoPleito || tipoPleito || ""),
        ncm: fmtNcm(a?.ncm || ncm || ""),
        produto: String(a?.produto || produto || ""),
        pleiteante: String(a?.pleiteante || pleiteante || ""),
        infoDaPauta: info,
        analise: {
          resumo: cleanRichText(analise.resumo),
          comercio: cleanRichText(analise.comercio),
          tecnica: cleanRichText(analise.tecnica),
          sugestao: cleanRichText(analise.sugestao),
        },
        atribId: a?.id,
      });
    }

    return out;
  }, [pautaDoc, atribuicoes]);

  /** Versão padrão (somente Técnica + Sugestão) para visualização/impresso padrão/DOCX */
  const itensTS: ItemRelatorio[] = useMemo(() => {
    return itensBase.map((it) => ({
      ...it,
      analise: { ...it.analise, resumo: "", comercio: "" },
    }));
  }, [itensBase]);

  const cabecalho: CabecalhoRelatorio = useMemo(() => {
    const sel = pautas.find((p) => p.id === pautaSel);
    const meetingRaw = String(sel?.meeting || pautaDoc?.meeting || "");
    const fileTitle = String((pautaDoc as any)?.tituloArquivo || "");
    const isRet =
      !!((pautaDoc as any)?.diffResumo?.baseId || (pautaDoc as any)?.isRetificadora) ||
      /retificad/i.test(meetingRaw) || /retificad/i.test(fileTitle);
    const meetingLabel = `${meetingRaw}${isRet && !/\(RETIFICADA/.test(meetingRaw) ? " (RETIFICADA)" : ""}`;
    const linhaTopo = "Ministério do Desenvolvimento, Indústria, Comércio e Serviços";
    const blocoCompleto = `Relatório de Análises – CGIM – Pauta ${meetingLabel}`;
    const notas = 'Seções: "Análise Técnica" e "Sugestão CGIM"';
    return { linhaTopo, blocoCompleto, apenasCgim: notas };
  }, [pautaSel, pautas, pautaDoc]);

  const baixarDocx = async () => {
    await exportRelatorioDocx({
      cabecalho,
      itens: itensTS,
      nomeArquivo: (() => {
        const sel = pautas.find((p) => p.id === pautaSel);
        return (
          `Relatorio_CGIM_${String(sel?.meeting || pautaDoc?.meeting || pautaSel)}`
            .replace(/[^\w\s().-]+/g, "_") + ".docx"
        );
      })(),
    });
  };

  const imprimirPadrao = () => window.print();

  /** Imprimir COMPLETO */
  const imprimirCompleto = () => {
    if (!itensBase.length) return;

    const sel = pautas.find((p) => p.id === pautaSel);
    const title = `Relatório Completo – ${String(sel?.meeting || pautaDoc?.meeting || pautaSel)}`;
    const css = `
      * { box-sizing: border-box; }
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial, "Apple Color Emoji", "Segoe UI Emoji"; margin: 24px; color: #0f172a; }
      h1 { font-size: 20px; margin: 0 0 8px; }
      .sub { color: #475569; margin-bottom: 16px; }
      .card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 12px; background: #fff; }
      .head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
      .title { font-weight: 600; }
      .meta { color: #64748b; font-size: 12px; }
      .grid { display: grid; grid-template-columns: 1fr 2fr; gap: 8px 16px; font-size: 14px; margin-top: 8px; }
      .sec { border-radius: 8px; padding: 10px; margin-top: 10px; font-size: 14px; line-height: 1.45; }
      .resumo { background: #f8fafc; border: 1px solid #e2e8f0; }
      .comercio { background: #eff6ff; border: 1px solid #bfdbfe; }
      .tecnica { background: #fff7ed; border: 1px solid #fed7aa; }
      .sugestao { background: #ecfdf5; border: 1px solid #a7f3d0; }
      @media print { body { margin: 0; } .page-break { page-break-after: always; } }
    `;
    const header = `
      <h1>${escapeHtml(title)}</h1>
      <div class="sub">${escapeHtml(cabecalho.linhaTopo)} — ${escapeHtml(cabecalho.blocoCompleto)}</div>
    `;

    const bodyCards = itensBase.map((it) => {
      const info = Object.entries(it.infoDaPauta)
        .map(([k, v]) => `<div><b>${escapeHtml(k)}:</b></div><div>${renderWithBreaks(String(v))}</div>`)
        .join("");
      const infoGrid = info ? `<div class="grid">${info}</div>` : "";

      return `
        <div class="card">
          <div class="head">
            <div class="title">${it.indice}. NCM ${escapeHtml(it.ncm)}</div>
            <div class="meta">${escapeHtml(it.secaoTitulo)}${it.tipoPleito ? " • " + escapeHtml(it.tipoPleito) : ""}</div>
          </div>
          <div class="grid">
            <div><b>Pleiteante:</b></div><div>${escapeHtml(it.pleiteante || "—")}</div>
            <div><b>Produto:</b></div><div>${escapeHtml(it.produto || "—")}</div>
          </div>
          ${infoGrid}
          ${it.analise.resumo   ? `<div class="sec resumo"><b>Resumo:</b> ${renderWithBreaks(it.analise.resumo)}</div>`   : ""}
          ${it.analise.comercio ? `<div class="sec comercio"><b>Comércio:</b> ${renderWithBreaks(it.analise.comercio)}</div>` : ""}
          ${it.analise.tecnica  ? `<div class="sec tecnica"><b>Análise Técnica:</b> ${renderWithBreaks(it.analise.tecnica)}</div>` : ""}
          ${it.analise.sugestao ? `<div class="sec sugestao"><b>Sugestão CGIM:</b> ${renderWithBreaks(it.analise.sugestao)}</div>` : ""}
        </div>
      `;
    }).join("\n");

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(title)}</title>
          <style>${css}</style>
        </head>
        <body>
          ${header}
          ${bodyCards || "<div>Nenhum item para imprimir.</div>"}
          <script>
            window.addEventListener('load', function(){
              setTimeout(function(){ window.print(); }, 200);
            });
          </script>
        </body>
      </html>
    `;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const w = window.open(url, "_blank", "noopener,noreferrer,width=1024,height=800");
    if (w && !w.closed) {
      const revoke = () => URL.revokeObjectURL(url);
      const timer = setTimeout(revoke, 60_000);
      w.addEventListener?.("load", () => {
        clearTimeout(timer);
        setTimeout(revoke, 10_000);
      });
      return;
    }

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "1px";
    iframe.style.height = "1px";
    iframe.style.border = "0";
    iframe.src = url;
    iframe.onload = () => {
      try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); }
      finally {
        setTimeout(() => { URL.revokeObjectURL(url); iframe.remove(); }, 5000);
      }
    };
    document.body.appendChild(iframe);
  };

  return (
    <div className="p-4 md:p-8 w-full">
      <div className="mb-4">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Relatório Consolidado</h1>
        <p className="text-sm text-slate-600 mt-1">
          Visualização padrão com <b>Análise Técnica</b> e <b>Sugestão CGIM</b> dos pleitos <b>concluídos</b> da pauta selecionada.
        </p>
      </div>

      <div className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-700">Pauta:</label>
            <select
              className="border rounded-lg px-3 py-2 bg-white"
              value={pautaSel}
              onChange={(e) => setPautaSel(e.target.value)}
            >
              {pautas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.meeting || p.titulo || p.id}
                </option>
              ))}
            </select>
          </div>

          <div className="grow" />

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
              onClick={baixarDocx}
              disabled={!itensTS.length}
              title={!itensTS.length ? "Nenhum item para exportar" : "Exportar DOCX (Técnica + Sugestão)"}
            >
              <Download className="h-4 w-4 inline-block mr-2" />
              Exportar DOCX
            </button>

            <button
              className="px-4 py-2 rounded-xl bg-slate-200 text-slate-800 hover:bg-slate-300 disabled:opacity-60"
              onClick={imprimirPadrao}
              disabled={!itensTS.length}
              title={!itensTS.length ? "Nenhum item para imprimir" : "Imprimir (Técnica + Sugestão)"}
            >
              <Printer className="h-4 w-4 inline-block mr-2" />
              Imprimir
            </button>

            <button
              className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700 underline decoration-dotted disabled:opacity-60"
              onClick={imprimirCompleto}
              disabled={!itensBase.length}
              title="Imprimir relatório completo (Resumo + Comércio + Técnica + Sugestão)"
            >
              Imprimir completo
            </button>
          </div>
        </div>
      </div>

      {loading && <div className="p-4 border rounded-xl bg-white/70">Carregando…</div>}

      {!loading && (
        <div className="space-y-4">
          {itensTS.map((it) => (
            <div key={it.atribId || it.indice} className="rounded-xl border bg-white p-4">
              <div className="flex items-center justify-between">
                <div className="text-lg font-semibold">
                  {it.indice}. NCM {it.ncm}
                </div>
                <div className="text-sm text-slate-500">
                  {it.secaoTitulo} {it.tipoPleito ? `• ${it.tipoPleito}` : ""}
                </div>
              </div>

              <div className="mt-2 grid md:grid-cols-3 gap-3 text-sm">
                <div><b>Pleiteante:</b> {it.pleiteante || "—"}</div>
                <div className="md:col-span-2"><b>Produto:</b> {it.produto || "—"}</div>
              </div>

              <div className="mt-4 space-y-3">
                {it.analise.tecnica && (
                  <div className="border rounded-lg p-3 bg-amber-50 border-amber-200">
                    <b className="text-amber-800">Análise Técnica:</b>{" "}
                    <span className="text-amber-900">{it.analise.tecnica}</span>
                  </div>
                )}
                {it.analise.sugestao && (
                  <div className="border rounded-lg p-3 bg-emerald-50 border-emerald-200">
                    <b className="text-emerald-800">Sugestão CGIM:</b>{" "}
                    <span className="text-emerald-900">{it.analise.sugestao}</span>
                  </div>
                )}
              </div>
            </div>
          ))}

          {!itensTS.length && (
            <div className="p-4 border rounded-xl bg-white/70 text-slate-600">
              Nenhum pleito concluído com Análise Técnica ou Sugestão CGIM para esta pauta.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RelatorioConsolidadoPage;
