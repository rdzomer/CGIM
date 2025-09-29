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
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normKey = (s?: any) =>
  norm(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

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

const hasTecnicaOuSugestao = (a?: AnaliseBloco | null) => {
  if (!a) return false;
  return norm(a.tecnica).length > 0 || norm(a.sugestao).length > 0;
};

const escapeHtml = (t: string) =>
  t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

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
  analise?: AnaliseBloco;
  updatedAt?: any;
  // campos legados (fallback)
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

/** Gera a mesma chave usada nas atribuições */
function gerarPleitoKeyFromRow(row: any) {
  const { ncm, produto, pleiteante } = projectLinha(row);
  const key = [only8(ncm), norm(produto), norm(pleiteante)].filter(Boolean).join("|");
  return key;
}

/** Fallback para análises no formato legado (campos soltos) */
function analiseFromLegacy(a: Atribuicao): AnaliseBloco {
  const resumo = a.resumo ?? "";
  const comercio = a.dadosComercio ?? "";
  const tecnica = a.analiseTecnica ?? "";
  const sugestao = a.sugestaoCgim ?? "";
  if ([resumo, comercio, tecnica, sugestao].some((v) => norm(v).length > 0)) {
    return { resumo, comercio, tecnica, sugestao };
  }
  return null;
}

/** Heurística: remover artefatos de OCR/planilha como "Col_1", "Col. 1", "col-1" */
function isColArtefact(key: string) {
  const k = normKey(key);
  if (/^col[\s._-]*\d+$/.test(k)) return true;
  if (/^col[\s._-]*\d+\s*\(.+\)$/.test(k)) return true;
  if (/^col\.\s*\d+$/.test(k)) return true;
  return false;
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

  // Carrega opções de pautas (dropdown) — com numeração de retificações
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

      // label final com vN
      const opts = out
        .map((o) => {
          const hasV = o.isRet && o.versaoRet && o.versaoRet > 0;
          const meetingLabel = hasV
            ? String(o.meeting || "").replace(
                /\(RETIFICADA\)/i,
                `(RETIFICADA v${o.versaoRet})`
              )
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

  // Carrega atribuições da pauta e complementa por pleitoKey (sempre)
  useEffect(() => {
    if (!pautaSel) return;
    (async () => {
      setLoading(true);
      try {
        const col = collection(db, "atribuicoes");
        const arr: Atribuicao[] = [];

        // 1) atribuições desta pauta
        const snap1 = await getDocs(query(col, where("pautaId", "==", pautaSel)));
        snap1.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));

        // 2) SEMPRE completar por pleitoKey das linhas da pauta
        if (pautaDoc) {
          const rows = flattenPauta(pautaDoc);
          const keysSet = new Set<string>();
          for (const { row } of rows) {
            const k = gerarPleitoKeyFromRow(row);
            if (k) keysSet.add(norm(k));
          }

          const jaTem = new Set<string>(
            arr.map((a) => norm(String(a.pleitoKey || ""))).filter(Boolean)
          );

          const missing = Array.from(keysSet).filter((k) => k && !jaTem.has(k));

          // Firestore IN aceita até 10
          for (let i = 0; i < missing.length; i += 10) {
            const chunk = missing.slice(i, i + 10);
            const snap2 = await getDocs(query(col, where("pleitoKey", "in", chunk)));
            snap2.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
          }
        }

        // dedupe por id
        const dedupMap = new Map<string, Atribuicao>();
        for (const a of arr) dedupMap.set(a.id, a);
        const dedup = Array.from(dedupMap.values());

        const ajustados = dedup.map((a) => {
          const analise = a.analise ?? analiseFromLegacy(a);
          const status = normalizeStatus(a.status);
          return { ...a, analise, status };
        });

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
    const byPair = new Map<string, Atribuicao>();   // ncm|produto
    const byPair2 = new Map<string, Atribuicao>();  // ncm|pleiteante

    for (const a of atribuicoes) {
      const ncm8 = only8(a.ncm);
      const prod = normKey(a.produto);
      const pl = normKey(a.pleiteante || "");
      const pair = `${ncm8}|${prod}`;
      const pair2 = `${ncm8}|${pl}`;
      if (a.pleitoKey) byKey.set(norm(a.pleitoKey), a);
      if (ncm8 && prod) byPair.set(pair, a);
      if (ncm8 && pl) byPair2.set(pair2, a);
    }

    const isOk = (a: Atribuicao | undefined) =>
      !!a && normalizeStatus(a.status) === "concluido" && hasTecnicaOuSugestao(a.analise);

    for (const { secao, row } of rows) {
      const { ncm, produto, pleiteante, tipoPleito } = projectLinha(row);
      const key = gerarPleitoKeyFromRow(row);
      let a: Atribuicao | undefined = undefined;

      a =
        byKey.get(norm(key)) ||
        byPair.get(`${only8(ncm)}|${normKey(produto)}`) ||
        byPair2.get(`${only8(ncm)}|${normKey(pleiteante)}`);

      if (!isOk(a)) continue;

      const info: Record<string, string> = {};
      Object.entries(row || {}).forEach(([k, v]) => {
        const nk = normKey(k);
        if (
          [
            "ncm",
            "código ncm",
            "codigo ncm",
            "código",
            "codigo",
            "ncm 8",
            "produto",
            "descrição",
            "descricao",
            "pleiteante",
            "requerente",
            "solicitante",
            "empresa",
            "tipo de pleito",
            "tipo do pleito",
            "tipo",
            "pleito",
            "pedido",
          ].includes(nk)
        )
          return;
        if (["id", "key", "pleitokey"].includes(nk)) return;
        if (isColArtefact(k)) return;
        if (v == null) return;
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          info[k] = String(v);
        }
      });

      const analise = a!.analise!;
      out.push({
        indice: i++,
        secaoTitulo: String(a?.tituloSecao || secao || ""),
        tipoPleito: String(a?.tipoPleito || tipoPleito || ""),
        ncm: fmtNcm(a?.ncm || ncm || ""),
        produto: String(a?.produto || produto || ""),
        pleiteante: String(a?.pleiteante || pleiteante || ""),
        infoDaPauta: info,
        analise: {
          resumo: norm(analise.resumo),
          comercio: norm(analise.comercio),
          tecnica: norm(analise.tecnica),
          sugestao: norm(analise.sugestao),
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
      analise: {
        ...it.analise,
        resumo: "",
        comercio: "",
      },
    }));
  }, [itensBase]);

  const cabecalho: CabecalhoRelatorio = useMemo(() => {
    const sel = pautas.find((p) => p.id === pautaSel);
    const meetingRaw = String(sel?.meeting || pautaDoc?.meeting || "");
    const fileTitle = String((pautaDoc as any)?.tituloArquivo || "");
    const isRet =
      !!((pautaDoc as any)?.diffResumo?.baseId || (pautaDoc as any)?.isRetificadora) ||
      /retificad/i.test(meetingRaw) ||
      /retificad/i.test(fileTitle);
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
          `Relatorio_CGIM_${String(sel?.meeting || pautaDoc?.meeting || pautaSel)}`.replace(
            /[^\w\s().-]+/g,
            "_"
          ) + ".docx"
        );
      })(),
    });
  };

  /** Imprime o padrão (Técnica + Sugestão) usando o DOM atual */
  const imprimirPadrao = () => window.print();

  /** Imprimir COMPLETO – versão robusta (Blob URL + onload, sem document.write) */
  const imprimirCompleto = () => {
    if (!itensBase.length) return;

    const title = (() => {
      const sel = pautas.find((p) => p.id === pautaSel);
      return `Relatório Completo – ${String(sel?.meeting || pautaDoc?.meeting || pautaSel)}`;
    })();
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

    const bodyCards = itensBase
      .map((it) => {
        const info = Object.entries(it.infoDaPauta)
          .map(
            ([k, v]) =>
              `<div><b>${escapeHtml(k)}:</b></div><div>${escapeHtml(String(v))}</div>`
          )
          .join("");
        const infoGrid = info ? `<div class="grid">${info}</div>` : "";

        return `
          <div class="card">
            <div class="head">
              <div class="title">${it.indice}. NCM ${escapeHtml(it.ncm)}</div>
              <div class="meta">${escapeHtml(it.secaoTitulo)}${
          it.tipoPleito ? " • " + escapeHtml(it.tipoPleito) : ""
        }</div>
            </div>
            <div class="grid">
              <div><b>Pleiteante:</b></div><div>${escapeHtml(it.pleiteante || "—")}</div>
              <div><b>Produto:</b></div><div>${escapeHtml(it.produto || "—")}</div>
            </div>
            ${infoGrid}
            ${
              it.analise.resumo
                ? `<div class="sec resumo"><b>Resumo:</b> ${escapeHtml(
                    it.analise.resumo
                  )}</div>`
                : ""
            }
            ${
              it.analise.comercio
                ? `<div class="sec comercio"><b>Comércio:</b> ${escapeHtml(
                    it.analise.comercio
                  )}</div>`
                : ""
            }
            ${
              it.analise.tecnica
                ? `<div class="sec tecnica"><b>Análise Técnica:</b> ${escapeHtml(
                    it.analise.tecnica
                  )}</div>`
                : ""
            }
            ${
              it.analise.sugestao
                ? `<div class="sec sugestao"><b>Sugestão CGIM:</b> ${escapeHtml(
                    it.analise.sugestao
                  )}</div>`
                : ""
            }
          </div>
        `;
      })
      .join("\n");

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
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        setTimeout(() => {
          URL.revokeObjectURL(url);
          iframe.remove();
        }, 5000);
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
