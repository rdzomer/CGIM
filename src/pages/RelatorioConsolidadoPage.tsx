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
import { Download, Filter, Printer } from "lucide-react";
import { exportRelatorioDocx, CabecalhoRelatorio } from "../services/relatorioExport";

/** ===================== Utils (normalização) ===================== */
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

const hasAnyText = (a?: AnaliseBloco | null) =>
  !!a &&
  [a.resumo, a.comercio, a.tecnica, a.sugestao]
    .map((v) => norm(v))
    .some((v) => v.length > 0);

/** ===================== Tipos ===================== */
type PautaDoc = {
  id: string;
  meeting?: string;
  titulo?: string;
  createdAt?: any;
  sections?: any[];
  secoes?: any[]; // legado
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

type PautaOption = { id: string; meeting: string; titulo: string };

/** ===================== Helpers de pauta ===================== */
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
    // compat com estruturas alternativas
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
  const pleiteante = by(["Pleiteante", "Requerente", "Solicitante"]);
  const tipoPleito = by(["Tipo de Pleito", "Tipo do Pleito", "Tipo", "tipo"]);

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
  if (/^col[\s._-]*\d+$/.test(k)) return true; // col_1, col 2, col-3
  if (/^col[\s._-]*\d+\s*\(.+\)$/.test(k)) return true; // col_1 (…)
  if (/^col\.\s*\d+$/.test(k)) return true; // col. 1
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
  const [apenasComTexto, setApenasComTexto] = useState(true);

  // Carrega opções de pautas (para dropdown)
  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, "pautas"));
      const opts: PautaOption[] = [];
      snap.forEach((d) => {
        const v = d.data() as any;
        const meeting = String(v?.meeting || v?.titulo || d.id || "");
        opts.push({
          id: d.id,
          meeting,
          titulo: String(v?.titulo || v?.meeting || ""),
        });
      });
      // ordena por meeting/título desc para trazer as mais recentes primeiro
      opts.sort((a, b) => b.meeting.localeCompare(a.meeting));
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

  // Carrega atribuições da pauta, com FALLOVER inteligente
  useEffect(() => {
    if (!pautaSel) return;
    (async () => {
      setLoading(true);
      try {
        const col = collection(db, "atribuicoes");
        const arr: Atribuicao[] = [];

        // 1) Tentativa principal: por pautaId
        const snap1 = await getDocs(query(col, where("pautaId", "==", pautaSel)));
        snap1.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));

        // 2) Se não achou nada, fallback por pleitoKey (docs legados sem pautaId)
        if (arr.length === 0 && pautaDoc) {
          const keysSet = new Set<string>();
          for (const { row } of flattenPauta(pautaDoc)) {
            const k = gerarPleitoKeyFromRow(row);
            if (k) keysSet.add(k);
          }
          const keys = Array.from(keysSet);
          // Firestore "in" aceita no máx. 10 por consulta
          for (let i = 0; i < keys.length; i += 10) {
            const chunk = keys.slice(i, i + 10);
            const snap2 = await getDocs(query(col, where("pleitoKey", "in", chunk)));
            snap2.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
          }
        }

        // Ajusta análises (fallback legado) e normaliza status
        const ajustados = arr.map((a) => {
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

  // Monta itens finais na ORDEM da pauta
  const itens: ItemRelatorio[] = useMemo(() => {
    if (!pautaDoc) return [];

    const rows = flattenPauta(pautaDoc);
    const out: ItemRelatorio[] = [];
    let i = 1;

    // indexa atribuições por chave e por NCM+Produto
    const byKey = new Map<string, Atribuicao>();
    const byPair = new Map<string, Atribuicao>(); // ncm|produto
    for (const a of atribuicoes) {
      const ncm8 = only8(a.ncm);
      const prod = normKey(a.produto);
      const pair = `${ncm8}|${prod}`;
      if (a.pleitoKey) byKey.set(norm(a.pleitoKey), a);
      if (ncm8 && prod) byPair.set(pair, a);
    }

    const isOk = (a: Atribuicao | undefined) =>
      !!a && normalizeStatus(a.status) === "concluido" && (!apenasComTexto || hasAnyText(a.analise));

    for (const { secao, row } of rows) {
      const { ncm, produto, pleiteante, tipoPleito } = projectLinha(row);
      const key = gerarPleitoKeyFromRow(row);
      let a: Atribuicao | undefined = undefined;

      // 1) match por pleitoKey
      a = byKey.get(norm(key));
      // 2) fallback por NCM + Produto (ignora pleiteante se vazio na pauta)
      if (!a) {
        const pair = `${only8(ncm)}|${normKey(produto)}`;
        a = byPair.get(pair);
      }
      if (!isOk(a)) continue;

      // monta info residual da linha (tudo que não é estrutural)
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
            "tipo de pleito",
            "tipo do pleito",
            "tipo",
          ].includes(nk)
        )
          return;
        if (["id", "key", "pleitokey"].includes(nk)) return;
        if (isColArtefact(k)) return;               // <<<<< remove Col_1 / Col. 1
        if (v == null) return;
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          info[k] = String(v);
        }
      });

      // analise já ajustada no carregamento
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
  }, [pautaDoc, atribuicoes, apenasComTexto]);

  const cabecalho: CabecalhoRelatorio = useMemo(() => {
    const sel = pautas.find((p) => p.id === pautaSel);
    const linhaTopo = "Ministério do Desenvolvimento, Indústria, Comércio e Serviços";
    const blocoCompleto =
      `Relatório de Análises – CGIM – Pauta ${sel?.meeting || pautaDoc?.meeting || ""}`;
    const apenas = apenasComTexto ? "Somente pleitos com análise preenchida" : "";
    return { linhaTopo, blocoCompleto, apenasCgim: apenas };
  }, [pautaSel, pautas, pautaDoc, apenasComTexto]);

  const baixarDocx = async () => {
    await exportRelatorioDocx({
      cabecalho,
      itens,
      nomeArquivo: `Relatorio_CGIM_${pautaDoc?.meeting || pautaSel}.docx`,
    });
  };

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-end gap-4 md:gap-6 mb-6">
        <div className="flex-1">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Relatório Consolidado</h1>
          <p className="text-sm text-slate-600">
            Gerar relatório apenas dos pleitos <b>com análise concluída</b> na pauta selecionada. Utilize o filtro
            para incluir ou excluir itens sem texto preenchido.
          </p>
        </div>

        <div className="flex items-center gap-3">
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
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={apenasComTexto}
              onChange={(e) => setApenasComTexto(e.target.checked)}
            />
            <Filter className="h-4 w-4" />
            <span>Incluir apenas quem tem texto (resumo/comércio/técnica/sugestão)</span>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
            onClick={baixarDocx}
            disabled={!itens.length}
            title={!itens.length ? "Nenhum item para exportar" : "Exportar DOCX"}
          >
            <Download className="h-4 w-4 inline-block mr-2" />
            Exportar DOCX
          </button>
          <button
            className="px-4 py-2 rounded-xl bg-slate-200 text-slate-800 hover:bg-slate-300 disabled:opacity-60"
            onClick={() => window.print()}
            disabled={!itens.length}
          >
            <Printer className="h-4 w-4 inline-block mr-2" />
            Imprimir
          </button>
        </div>
      </div>

      {loading && <div className="p-4 border rounded-xl bg-white/70">Carregando…</div>}

      {!loading && (
        <div className="space-y-4">
          {itens.map((it) => (
            <div key={it.atribId || it.indice} className="rounded-xl border bg-white p-4">
              {/* Cabeçalho do card: sem título duplicado, apenas NCM e seção/tipo */}
              <div className="flex items-center justify-between">
                <div className="text-lg font-semibold">
                  {it.indice}. NCM {it.ncm}
                </div>
                <div className="text-sm text-slate-500">
                  {it.secaoTitulo} {it.tipoPleito ? `• ${it.tipoPleito}` : ""}
                </div>
              </div>

              {/* Metadados principais */}
              <div className="mt-2 grid md:grid-cols-3 gap-3 text-sm">
                <div><b>Pleiteante:</b> {it.pleiteante || "—"}</div>
                <div className="md:col-span-2"><b>Produto:</b> {it.produto || "—"}</div>
              </div>

              {/* Infos adicionais vindas da pauta */}
              {Object.keys(it.infoDaPauta).length > 0 && (
                <div className="mt-3 text-sm">
                  <div className="font-medium text-slate-700 mb-1">Informações da Pauta</div>
                  <div className="grid md:grid-cols-2 gap-2">
                    {Object.entries(it.infoDaPauta).map(([k, v]) => (
                      <div key={k}>
                        <b>{k}:</b> <span className="text-slate-700">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Blocos de análise */}
              <div className="mt-4 space-y-3">
                {it.analise.resumo && (
                  <div className="border rounded-lg p-3 bg-slate-50 border-slate-200">
                    <b className="text-slate-700">Resumo:</b>{" "}
                    <span className="text-slate-900">{it.analise.resumo}</span>
                  </div>
                )}
                {it.analise.comercio && (
                  <div className="border rounded-lg p-3 bg-blue-50 border-blue-200">
                    <b className="text-blue-800">Comércio:</b>{" "}
                    <span className="text-blue-900">{it.analise.comercio}</span>
                  </div>
                )}
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

          {!itens.length && (
            <div className="p-4 border rounded-xl bg-white/70 text-slate-600">
              Nenhum item encontrado nesta pauta. Verifique se:
              <ul className="list-disc pl-6 mt-2 space-y-1">
                <li>Existem atribuições com <b>status Concluído</b> para esta pauta;</li>
                <li>Os textos de análise foram preenchidos (ou desmarque o filtro “apenas quem tem texto”);</li>
                <li>As atribuições mais antigas podem não ter <code>pautaId</code>; o relatório tenta buscá-las por <i>pleitoKey</i>.</li>
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RelatorioConsolidadoPage;
