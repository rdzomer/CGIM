// src/pages/AnalisePleitoPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { doc, getDoc, getFirestore, updateDoc, serverTimestamp } from "firebase/firestore";
import toast from "react-hot-toast";
import { FileText } from "lucide-react";

/* ----------------------------- Tipos ----------------------------- */
type Analise = {
  resumo?: string;
  comercio?: string;
  tecnica?: string;
  sugestao?: string;
};

type Atrib = {
  id: string;
  ncm?: string;
  produto?: string;
  pleiteante?: string;
  tituloSecao?: string;
  pautaId?: string;
  status?: string;
  analise?: Analise | null;
  pleitoKey?: string;
};

/* ---------------------------- Helpers ---------------------------- */
function fmtNcm(n?: string) {
  const d = (n || "").replace(/\D+/g, "");
  if (d.length !== 8) return n || "";
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`;
}
const HIDDEN_KEYS = /^col_\d+$/i;
const SHORT_LIMIT = 170;
const shorten = (s?: string, n = SHORT_LIMIT) => {
  const t = (s || "").trim();
  if (!t) return "—";
  return t.length > n ? t.slice(0, n).trimEnd() + "…" : t;
};
function onlyDigits(s?: string) {
  return (s || "").replace(/\D+/g, "");
}
function friendlyLabel(k: string) {
  const map: Record<string, string> = {
    ncm: "NCM",
    produto: "Produto",
    pleiteante: "Pleiteante",
    aliqPretendida: "Alíquota Pretendida",
    aliqAplicada: "Alíquota Aplicada",
    processoSei: "Processo SEI",
    tipoPleito: "Tipo de Pleito",
    notasTecnicas: "Notas Técnicas",
  };
  return map[k] || k;
}
function findKey(base: Record<string, any>, aliases: string[]): string | undefined {
  const entries = Object.keys(base || {});
  for (const k of entries) {
    const kk = k.toLowerCase();
    for (const a of aliases) if (kk.includes(a.toLowerCase())) return k;
  }
  return undefined;
}
function pickRowVal(row: Record<string, any>, aliases: string[]) {
  const k = findKey(row, aliases);
  return k ? String(row[k] ?? "") : "";
}
function fmtAliq(v?: string) {
  if (!v) return "";
  const t = v.trim();
  if (/%/.test(t) || /ad ?valorem|espec/i.test(t)) return t;
  const m = t.match(/-?\d+(?:[.,]\d+)?/);
  if (m) return `${parseFloat(m[0].replace(",", "."))}%`;
  return t;
}

/* -------------------- Extração normalizada do pedido -------------------- */
type PedidoInfo = {
  tipo?: string;
  processoSei?: string;
  pais?: string;
  paisPendente?: string;
  prazoResposta?: string;
  aliqAtual?: string;
  aliqPretendida?: string;
  aliqSolicitada?: string;
  aliqZero?: string;
  reducaoII?: string;
  quota?: string;
  unidadeQuota?: string;
  prazo?: string;
  vigenciaFim?: string;
  ex?: string;
  exTarifario?: string;
  notasTecnicas?: string;
  posicaoCat?: string;
  situacao?: string;
  _matchedKeys: string[];
};

function extractPedido(base: Record<string, any>): PedidoInfo {
  const used: string[] = [];
  const pick = (aliases: string[], fmt?: (v: string) => string) => {
    const key = findKey(base, aliases);
    if (!key) return undefined;
    const raw = String(base[key] ?? "").trim();
    if (!raw) return undefined;
    used.push(key);
    return fmt ? fmt(raw) : raw;
  };

  return {
    tipo: pick(["tipo de pleito", "tipo do pleito", "tipo do pedido"]),
    processoSei: pick(["processo sei (público", "processo sei (publico", "processo sei", "processo"]),
    pais: pick(["país", "pais "]),
    paisPendente: pick(["país pendente", "pais pendente"]),
    prazoResposta: pick(["prazo para resposta", "prazo p/ resposta", "prazo p resposta"]),

    aliqAtual: pick(["alíquota aplicada", "aliquota aplicada", "alíquota atual", "aliquota atual", "aliq aplicada", "aliq atual"], fmtAliq),
    aliqPretendida: pick(["alíquota pretendida", "aliquota pretendida", "alíquota pleiteada", "aliquota pleiteada", "pretendida", "pleiteada"], fmtAliq),
    aliqSolicitada: pick(["alíquota solicitada", "aliquota solicitada"], fmtAliq),
    aliqZero: pick(["alíquota (pleito a 0%)", "aliquota (pleito a 0)", "pleito a 0"], fmtAliq),
    reducaoII: pick(["redução do ii", "redução do ii (%)", "reducao do ii", "reducao do ii (%)"]),

    quota: pick(["quota", "cota"]),
    unidadeQuota: pick(["unidade quota", "unidade cota"]),
    prazo: pick(["prazo "]),
    vigenciaFim: pick(["término vigência da medida em vigor", "termino vigencia da medida em vigor", "prazo da medida vigente", "vigência", "vigencia"]),

    ex: pick(["ex "]),
    exTarifario: pick(["ex-tarifário", "ex tarifario", "extarifario"]),

    notasTecnicas: pick(["notas técnicas", "notas tecnicas"]),
    posicaoCat: pick(["posição cat", "posicao cat"]),
    situacao: pick(["situação", "situacao"]),

    _matchedKeys: used,
  };
}

/* --------------------- Matching de linha na pauta --------------------- */
type Best = { score: number; row: any | null };
function scoreRow(
  row: any,
  pleitoKey: string,
  ncmAlvo: string,
  produtoAlvo: string,
  pleiteanteAlvo: string
): number {
  let score = 0;

  const keyRow = (row?.pleitoKey || row?.key || "").trim();
  if (keyRow && pleitoKey && keyRow === pleitoKey) score += 100;

  const rn = onlyDigits(pickRowVal(row, ["ncm"]));
  if (rn && ncmAlvo && rn === ncmAlvo) score += 10;

  const rp = pickRowVal(row, ["produto"]).trim().toLowerCase();
  if (rp && produtoAlvo) {
    if (rp === produtoAlvo) score += 4;
    else if (rp.includes(produtoAlvo) || produtoAlvo.includes(rp)) score += 2;
  }

  const rpl = pickRowVal(row, ["pleiteante"]).trim().toLowerCase();
  if (rpl && pleiteanteAlvo) {
    if (rpl === pleiteanteAlvo) score += 3;
    else if (rpl.includes(pleiteanteAlvo) || pleiteanteAlvo.includes(rpl)) score += 1;
  }

  return score;
}

/* ------------------------------- Página ------------------------------- */
const AnalisePleitoPage: React.FC = () => {
  const { atrId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const copyFrom = params.get("copyFrom") || "";

  const [atr, setAtr] = useState<Atrib | null>(null);
  const [ficha, setFicha] = useState<Record<string, string>>({});
  const [pedido, setPedido] = useState<PedidoInfo>({ _matchedKeys: [] });
  const [form, setForm] = useState<Analise>({});
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(true);

  // rascunho importável
  const [draft, setDraft] = useState<Analise | null>(null);
  const [draftLoadedFrom, setDraftLoadedFrom] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!atrId) return;
      setCarregando(true);
      try {
        const db = getFirestore();
        const snap = await getDoc(doc(db, "atribuicoes", atrId));
        if (!snap.exists()) {
          toast.error("Atribuição não encontrada.");
          navigate("/minhas-tarefas");
          return;
        }
        const v = snap.data() as any;
        const atrib: Atrib = {
          id: snap.id,
          ncm: v?.ncm || "",
          produto: v?.produto || "",
          pleiteante: v?.pleiteante || "",
          tituloSecao: v?.tituloSecao || "",
          pautaId: v?.pautaId || "",
          status: v?.status || "novo",
          analise: v?.analise || null,
          pleitoKey: v?.pleitoKey || "",
        };
        setAtr(atrib);
        setForm(atrib.analise || {});

        // carrega rascunho se copyFrom veio
        if (copyFrom) {
          try {
            const fromSnap = await getDoc(doc(db, "atribuicoes", copyFrom));
            if (fromSnap.exists()) {
              const fromData = fromSnap.data() as any;
              const ana: Analise | null = fromData?.analise || null;
              if (ana && (ana.resumo || ana.comercio || ana.tecnica || ana.sugestao)) {
                setDraft(ana);
                setDraftLoadedFrom(fromSnap.id);
              }
            }
          } catch {
            /* silencioso */
          }
        }

        // Matching de linha da pauta
        let line: any = v?.linhaPauta || null;
        if (!line && atrib.pautaId) {
          const pautaSnap = await getDoc(doc(db, "pautas", atrib.pautaId));
          const pauta = pautaSnap.data() as any;
          const sections: any[] = Array.isArray(pauta?.sections)
            ? pauta.sections
            : Array.isArray(pauta?.secoes)
            ? pauta.secoes
            : [];

          const alvoKey = (atrib.pleitoKey || `${atrib.ncm}|${atrib.produto}|${atrib.pleiteante}`).trim();
          const ncmAlvo = onlyDigits(atrib.ncm || "");
          const produtoAlvo = (atrib.produto || "").trim().toLowerCase();
          const pleiteanteAlvo = (atrib.pleiteante || "").trim().toLowerCase();

          const best: Best = { score: -1, row: null };
          for (const s of sections) {
            const rows: any[] = Array.isArray(s?.rows) ? s.rows : [];
            for (const r of rows) {
              const sc = scoreRow(r, alvoKey, ncmAlvo, produtoAlvo, pleiteanteAlvo);
              if (sc > best.score) {
                best.score = sc;
                best.row = r;
              }
              if (best.score >= 100) break;
            }
            if (best.score >= 100) break;
          }
          line = best.row;
        }

        // Ficha amigável e extração do pedido
        const fichaLocal: Record<string, string> = {};
        const base = line || {};
        for (const [k, val] of Object.entries(base)) {
          const keyLower = k.toLowerCase();
          if (HIDDEN_KEYS.test(keyLower)) continue;
          if (["key", "pleitoKey"].includes(keyLower)) continue;
          let display = String(val ?? "").trim();
          if (!display) continue;
          if (keyLower === "ncm") display = fmtNcm(display);
          fichaLocal[friendlyLabel(k)] = display;
        }
        if (!fichaLocal["NCM"] && atrib.ncm) fichaLocal["NCM"] = fmtNcm(atrib.ncm);
        if (!fichaLocal["Produto"] && atrib.produto) fichaLocal["Produto"] = atrib.produto;
        if (!fichaLocal["Pleiteante"] && atrib.pleiteante) fichaLocal["Pleiteante"] = atrib.pleiteante;

        setFicha(fichaLocal);
        setPedido(extractPedido(base));
      } finally {
        setCarregando(false);
      }
    })();
  }, [atrId, navigate, copyFrom]);

  const fichaPairsFull = useMemo(() => Object.entries(ficha), [ficha]);

  // oculta da grade os campos já exibidos no topo/resumo
  const fichaPairs = useMemo(() => {
    const omit = new Set((pedido._matchedKeys || []).map((k) => friendlyLabel(k)));
    omit.add("Produto");
    omit.add("Pleiteante");
    omit.add("NCM");
    return fichaPairsFull.filter(([k]) => !omit.has(k));
  }, [fichaPairsFull, pedido._matchedKeys]);

  async function salvar(statusForcado?: "em_andamento" | "concluido") {
    if (!atr) return;
    setSalvando(true);
    try {
      const db = getFirestore();
      const payload: any = {
        analise: {
          resumo: form.resumo || "",
          comercio: form.comercio || "",
          tecnica: form.tecnica || "",
          sugestao: form.sugestao || "",
        },
        updatedAt: serverTimestamp(),
      };
      if (statusForcado) payload.status = statusForcado;
      else if (!atr.status || atr.status === "novo") payload.status = "em_andamento";

      await updateDoc(doc(db, "atribuicoes", atr.id), payload);
      toast.success(statusForcado === "concluido" ? "Análise concluída." : "Análise salva.");
      if (statusForcado === "concluido") navigate("/");
    } catch (e) {
      console.error(e);
      toast.error("Falha ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  function applyDraftIntoForm() {
    if (!draft) return;
    setForm((f) => ({
      resumo: f.resumo || draft.resumo || "",
      comercio: f.comercio || draft.comercio || "",
      tecnica: f.tecnica || draft.tecnica || "",
      sugestao: f.sugestao || draft.sugestao || "",
    }));
    toast.success("Rascunho aplicado aos campos vazios.");
    setDraft(null);
  }

  if (carregando) return <div className="p-6 text-slate-500">Carregando…</div>;
  if (!atr) return <div className="p-6 text-slate-500">Atribuição não encontrada.</div>;

  const produtoCurto = shorten(atr.produto);
  const hasLongProduto = (atr.produto || "").trim().length > SHORT_LIMIT;

  // valores para o topo da ficha
  const topoProduto = ficha["Produto"] || atr.produto || "—";
  const topoPleiteante = ficha["Pleiteante"] || atr.pleiteante || "—";
  const topoNcm = ficha["NCM"] || fmtNcm(atr.ncm) || "—";

  return (
    <div className="p-2 md:p-4 lg:p-6 space-y-6">
      {/* Banner de rascunho disponível */}
      {draft && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 p-4 flex items-center justify-between gap-3">
          <div className="text-sm">
            <b>Rascunho encontrado</b>
            {draftLoadedFrom ? ` (origem: ${draftLoadedFrom})` : ""}. Você pode
            aplicar os textos anteriores aos <u>campos vazios</u> desta análise.
          </div>
          <div className="flex gap-2">
            <button
              className="px-3 py-1.5 rounded-lg border border-amber-300 hover:bg-amber-100"
              onClick={() => setDraft(null)}
            >
              Descartar
            </button>
            <button
              className="px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600"
              onClick={applyDraftIntoForm}
            >
              Aplicar rascunho
            </button>
          </div>
        </div>
      )}

      {/* Cabeçalho enxuto */}
      <div className="rounded-2xl border bg-white p-4 sm:p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1 min-w-0">
            <div className="text-xs text-slate-500 uppercase tracking-wide">NCM</div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-xl md:text-2xl font-semibold tracking-tight">{fmtNcm(atr.ncm)}</span>
              <span className="text-base md:text-lg text-slate-800 truncate">
                — {produtoCurto}
                {hasLongProduto && (
                  <>
                    {" "}
                    <a href="#ficha-pleito" className="text-blue-600 hover:underline" title="Ver descrição completa na ficha">
                      ver descrição completa
                    </a>
                  </>
                )}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-3 py-1 text-xs">
                <b className="mr-1">Seção:</b> {atr.tituloSecao || "—"}
              </span>
              <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-3 py-1 text-xs">
                <b className="mr-1">Pleiteante:</b> {atr.pleiteante || "—"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              className="px-4 py-2.5 rounded-xl border hover:bg-gray-50"
              onClick={() =>
                atr.pautaId
                  ? window.open(
                      `/pauta/${encodeURIComponent(atr.pautaId)}?secao=${encodeURIComponent(atr.tituloSecao || "")}`,
                      "_blank"
                    )
                  : toast.error("Pauta sem ID.")
              }
            >
              Abrir pauta
            </button>
            <button
              className="px-4 py-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700"
              disabled={salvando}
              onClick={() => salvar("em_andamento")}
            >
              Salvar análise
            </button>
            <button
              className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={salvando}
              onClick={() => salvar("concluido")}
            >
              Concluir análise
            </button>
          </div>
        </div>
      </div>

      {/* Ficha do Pleito */}
      <section id="ficha-pleito" className="rounded-2xl border bg-white shadow-sm">
        <header className="p-4 sm:p-5 border-b flex items-center gap-2">
          <FileText className="w-4 h-4 text-slate-600" />
          <h2 className="text-base sm:text-lg font-semibold">
            Ficha do Pleito <span className="text-slate-500 font-normal">(dados da pauta)</span>
          </h2>
        </header>

        <div className="p-5 pt-4">
          {/* TOPO: Produto / Pleiteante (+ NCM) */}
          <div className="rounded-xl bg-slate-50 border p-4 mb-5">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="inline-flex items-center rounded-full bg-white border px-2.5 py-0.5 text-xs text-slate-700">
                NCM: <b className="ml-1 text-slate-900">{topoNcm}</b>
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-slate-500 mb-1">Produto (pleito)</div>
                <div className="text-slate-900 font-medium leading-relaxed whitespace-pre-wrap">
                  {topoProduto}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Pleiteante</div>
                <div className="text-slate-900 font-medium">{topoPleiteante}</div>
              </div>
            </div>
          </div>

          {/* RESUMO DO PEDIDO (dinâmico) */}
          {(pedido.tipo ||
            pedido.processoSei ||
            pedido.pais ||
            pedido.paisPendente ||
            pedido.prazoResposta ||
            pedido.aliqAtual ||
            pedido.aliqPretendida ||
            pedido.aliqSolicitada ||
            pedido.aliqZero ||
            pedido.reducaoII ||
            pedido.quota ||
            pedido.unidadeQuota ||
            pedido.prazo ||
            pedido.vigenciaFim ||
            pedido.ex ||
            pedido.exTarifario ||
            pedido.situacao ||
            pedido.notasTecnicas ||
            pedido.posicaoCat) && (
            <div className="rounded-xl border bg-slate-50 p-4 mb-5">
              <div className="text-slate-700 font-medium mb-2">Resumo do Pedido</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                {pedido.tipo && <div><b>Tipo:</b> {pedido.tipo}</div>}
                {pedido.processoSei && <div><b>Proc. SEI:</b> {pedido.processoSei}</div>}
                {pedido.pais && <div><b>País:</b> {pedido.pais}</div>}
                {pedido.paisPendente && <div><b>País pendente:</b> {pedido.paisPendente}</div>}
                {pedido.prazoResposta && <div><b>Prazo p/ resposta:</b> {pedido.prazoResposta}</div>}
                {pedido.aliqAtual && <div><b>Alíquota aplicada:</b> {pedido.aliqAtual}</div>}
                {pedido.aliqPretendida && <div><b>Alíquota pretendida:</b> {pedido.aliqPretendida}</div>}
                {pedido.aliqSolicitada && <div><b>Alíquota solicitada:</b> {pedido.aliqSolicitada}</div>}
                {pedido.aliqZero && <div><b>Pleito a 0%:</b> {pedido.aliqZero}</div>}
                {pedido.reducaoII && <div><b>Redução do II:</b> {pedido.reducaoII}</div>}
                {pedido.quota && <div><b>Quota:</b> {pedido.quota}</div>}
                {pedido.unidadeQuota && <div><b>Unidade quota:</b> {pedido.unidadeQuota}</div>}
                {pedido.prazo && <div><b>Prazo:</b> {pedido.prazo}</div>}
                {pedido.vigenciaFim && <div><b>Término vigência:</b> {pedido.vigenciaFim}</div>}
                {pedido.ex && <div><b>EX:</b> {pedido.ex}</div>}
                {pedido.exTarifario && <div><b>Ex-tarifário:</b> {pedido.exTarifario}</div>}
                {pedido.situacao && <div><b>Situação:</b> {pedido.situacao}</div>}
                {pedido.posicaoCat && <div><b>Posição CAT:</b> {pedido.posicaoCat}</div>}
              </div>
              {pedido.notasTecnicas && (
                <div className="mt-3 text-sm">
                  <b>Notas Técnicas:</b>
                  <div className="whitespace-pre-wrap">{pedido.notasTecnicas}</div>
                </div>
              )}
            </div>
          )}

          {/* DEMAIS CAMPOS DA FICHA (não repetidos) */}
          {fichaPairs.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {fichaPairs.map(([k, v]) => (
                <div key={k} className="rounded-lg bg-white border p-3">
                  <div className="text-xs text-slate-500 mb-1">{k}</div>
                  <div className="text-slate-900 whitespace-pre-wrap">{v || "—"}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Formulário da análise */}
      <section className="rounded-2xl border bg-white shadow-sm">
        <header className="p-4 sm:p-5 border-b">
          <h2 className="text-base sm:text-lg font-semibold">Análise técnica</h2>
        </header>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm text-slate-600 mb-1">Resumo</label>
            <textarea
              className="w-full border rounded-lg p-2 min-h-[100px]"
              value={form.resumo || ""}
              onChange={(e) => setForm((f) => ({ ...f, resumo: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1">Aspectos de Comércio Exterior</label>
            <textarea
              className="w-full border rounded-lg p-2 min-h-[100px]"
              value={form.comercio || ""}
              onChange={(e) => setForm((f) => ({ ...f, comercio: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1">Análise Técnica</label>
            <textarea
              className="w-full border rounded-lg p-2 min-h-[100px]"
              value={form.tecnica || ""}
              onChange={(e) => setForm((f) => ({ ...f, tecnica: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1">Sugestão</label>
            <textarea
              className="w-full border rounded-lg p-2 min-h-[100px]"
              value={form.sugestao || ""}
              onChange={(e) => setForm((f) => ({ ...f, sugestao: e.target.value }))}
            />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              className="px-4 py-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
              disabled={salvando}
              onClick={() => salvar("em_andamento")}
            >
              Salvar análise
            </button>
            <button
              className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
              disabled={salvando}
              onClick={() => salvar("concluido")}
            >
              Concluir análise
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AnalisePleitoPage;
