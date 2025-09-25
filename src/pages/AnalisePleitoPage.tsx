// src/pages/AnalisePleitoPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { doc, getDoc, getFirestore, updateDoc, serverTimestamp, setDoc } from "firebase/firestore";
import toast from "react-hot-toast";
import { FileText } from "lucide-react";
import { getHistoricoByPleitoKey, upsertHistoricoFromAtribuicao } from "../services/historicoAnalisesService";

/* ----------------------------- Tipos ----------------------------- */
type Analise = { resumo?: string; comercio?: string; tecnica?: string; sugestao?: string };
type PosDeliberacao = {
  data?: string;
  resultado?: "aprovado" | "aprovado_com_ajustes" | "indeferido" | "retirado" | "outro";
  encaminhamento?: string;
  numeroAta?: string;
};
type Atrib = {
  id: string;
  ncm?: string;
  produto?: string;
  pleiteante?: string;
  tipoPleito?: string;
  tituloSecao?: string;
  pautaId?: string;
  pleitoKey?: string;
  status?: string;
  analise?: Analise | null;
  linhaPauta?: any;
  posDeliberacao?: PosDeliberacao | null;
};

type PedidoExtraido = {
  tipo?: string;
  processoSei?: string | string[];
  processoSeiLinks?: string[];
  pais?: string;
  paisPendente?: string;
  prazoResposta?: string;
  fundamentacaoTecnica?: string;
  justificativaEconomica?: string;
  situacao?: string;
  notasTecnicas?: string;
};

/* ----------------------------- Helpers ----------------------------- */
const onlyDigits = (s?: string) => (s ?? "").replace(/\D+/g, "");
const norm = (s?: any) => String(s ?? "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
const normKey = (s?: any) =>
  norm(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const fmtNCM = (s?: string) => {
  const n8 = onlyDigits(s).slice(0, 8);
  return n8.length === 8 ? `${n8.slice(0, 4)}.${n8.slice(4, 6)}.${n8.slice(6, 8)}` : (s || "—");
};

const HIDDEN_KEYS = /(key|pleitokey|__sec|_id|id|timestamp|created|updated|hash|vers[aã]o|revindex)/i;

const hasContent = (a?: Analise | null) =>
  !!(a && ((norm(a.resumo).length > 0) || (norm(a.comercio).length > 0) || (norm(a.tecnica).length > 0) || (norm(a.sugestao).length > 0)));

/** Extrai todos os números SEI de uma string/array.
 *  Aceita entradas como "19971.000181/2025-81 19971.000182/2025-26"
 *  e retorna ["19971.000181/2025-81","19971.000182/2025-26"].
 */
function normalizeSeiList(value?: string | string[]): string[] {
  if (!value) return [];
  const inputs = Array.isArray(value) ? value : [value];

  const seen = new Set<string>();
  const out: string[] = [];
  const rx = /\b\d{5}\.\d{6}\/\d{4}-\d{2}\b/g; // padrão SEI

  for (const raw of inputs) {
    const s = String(raw ?? "");
    const matches = [...s.matchAll(rx)].map((m) => m[0]);
    if (matches.length) {
      for (const m of matches) if (!seen.has(m)) { seen.add(m); out.push(m); }
    } else {
      // fallback: quebra por espaços / vírgulas / ponto e vírgula / barras verticais
      const parts = s.split(/[\s,;|]+/g).map((t) => t.trim()).filter(Boolean);
      for (const p of parts) if (!seen.has(p)) { seen.add(p); out.push(p); }
    }
  }
  return out;
}

// ===== helpers para varrer a Pauta (fallback de SEI) =====
function flattenPauta(p: any): Array<{ secao: string; row: any }> {
  const out: Array<{ secao: string; row: any }> = [];
  const list =
    (Array.isArray(p?.sections) ? p.sections : undefined) ??
    (Array.isArray(p?.secoes) ? p.secoes : undefined) ??
    [];

  const pushRows = (secTitle: string, rows?: any[]) => {
    if (!Array.isArray(rows)) return;
    rows.forEach((r) => out.push({ secao: secTitle, row: r }));
  };

  for (const sec of list as any[]) {
    const secTitle = String(sec?.title ?? sec?.titulo ?? "") || "";
    pushRows(secTitle, sec?.rows);
    if (Array.isArray(sec?.tabelas)) for (const t of sec.tabelas) pushRows(secTitle, t?.rows);
    if (Array.isArray(sec?.tables))  for (const t of sec.tables)  pushRows(secTitle, t?.rows);
  }
  return out;
}
function projectLinha(row: Record<string, any>) {
  const keys = Object.keys(row || {});
  const by = (labels: string[]) => {
    const hit =
      keys.find((k) => labels.some((l) => normKey(k) === normKey(l))) ??
      keys.find((k) => labels.some((l) => normKey(k).includes(normKey(l))));
    return hit ? String(row[hit] ?? "") : "";
  };
  const ncm = by(["NCM", "Código NCM", "Codigo NCM", "Código", "Codigo", "NCM 8"]);
  const produto = by(["Produto","Descrição do Produto","Descricao do Produto","Produto/Descrição","Produto/Descricao","Descrição","Descricao"]);
  const pleiteante = by(["Pleiteante","Requerente","Solicitante","Empresa"]);
  return { ncm, produto, pleiteante };
}
const only8 = (s?: any) => norm(s).replace(/\D+/g, "").slice(0, 8);
function gerarPleitoKeyFromRow(row: any) {
  const { ncm, produto, pleiteante } = projectLinha(row);
  const key = [only8(ncm), norm(produto), norm(pleiteante)].filter(Boolean).join("|");
  return key;
}

// ===== util p/ caçar valores por alias em “fontes” variadas =====
function pickFromSources(sources: any[], aliases: string[], { raw = false }: { raw?: boolean } = {}) {
  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    for (const k of Object.keys(src)) {
      const kk = k.toLowerCase();
      if (aliases.some((a) => kk.includes(a.toLowerCase()))) {
        const v = (src as any)[k];
        if (raw) return v;
        const s = Array.isArray(v) ? v : String(v ?? "").trim();
        if ((Array.isArray(s) && s.length) || (typeof s === "string" && s)) return v;
      }
    }
  }
  return undefined;
}

/* ========================================================================== */

const AnalisePleitoPage: React.FC = () => {
  const { atrId } = useParams<{ atrId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);

  const copyFrom = params.get("copyFrom") || "";
  const isBlank = ["1", "true", "yes", "on"].includes((params.get("blank") || "").toLowerCase());

  const [atr, setAtr] = useState<Atrib | null>(null);
  const [ficha, setFicha] = useState<Record<string, string>>({});
  const [pedido, setPedido] = useState<PedidoExtraido>({});
  const [carregando, setCarregando] = useState<boolean>(true);
  const [salvando, setSalvando] = useState<boolean>(false);

  const [form, setForm] = useState<Analise>({ resumo: "", comercio: "", tecnica: "", sugestao: "" });
  const [pos, setPos] = useState<PosDeliberacao>({});

  const [draft, setDraft] = useState<Analise | null>(null);
  const [draftLoadedFrom, setDraftLoadedFrom] = useState<"histórico" | null>(null);

  const [copiedSei, setCopiedSei] = useState<string | null>(null);

  /* --------------------------- Carregar atribuição --------------------------- */
  useEffect(() => {
    (async () => {
      if (!atrId) return;
      setCarregando(true);
      try {
        const db = getFirestore();
        const ref = doc(db, "atribuicoes", atrId);
        const snap = await getDoc(ref);
        let v: any = null;

        if (!snap.exists()) {
          const seed = {
            pautaId: params.get("pautaId") || "",
            pleitoKey: params.get("pleitoKey") || "",
            ncm: params.get("ncm") || "",
            produto: params.get("produto") || "",
            pleiteante: params.get("pleiteante") || "",
            tituloSecao: params.get("tituloSecao") || "",
            tipoPleito: params.get("tipoPleito") || "",
          };
          const hasSeed = Object.values(seed).some(Boolean);
          if (isBlank || hasSeed) {
            await setDoc(
              ref,
              { ...seed, status: "Não iniciado", analise: null, updatedAt: serverTimestamp() },
              { merge: true }
            );
            v = seed;
          } else {
            toast.error("Atribuição não encontrada.");
            navigate("/minhas-tarefas");
            return;
          }
        } else {
          v = snap.data() as any;
        }

        const atrib: Atrib = {
          id: atrId,
          ncm: v?.ncm || "",
          produto: v?.produto || "",
          pleiteante: v?.pleiteante || "",
          tipoPleito: v?.tipoPleito || "",
          tituloSecao: v?.tituloSecao || "",
          pautaId: v?.pautaId || "",
          pleitoKey: v?.pleitoKey || "",
          status: v?.status || "Não iniciado",
          linhaPauta: v?.linhaPauta || null,
          analise: v?.analise || null,
          posDeliberacao: v?.posDeliberacao || null,
        };
        setAtr(atrib);
        setPos(atrib.posDeliberacao || {});

        // ===== init form =====
        if (copyFrom) {
          try {
            const src = await getDoc(doc(db, "atribuicoes", copyFrom));
            if (src.exists()) {
              const sd: any = src.data();
              const copied: Analise = {
                resumo: sd?.analise?.resumo || "",
                comercio: sd?.analise?.comercio || "",
                tecnica: sd?.analise?.tecnica || "",
                sugestao: sd?.analise?.sugestao || "",
              };
              setForm(copied);
              if (!hasContent(atrib.analise)) {
                try {
                  await updateDoc(ref, { analise: copied, updatedAt: serverTimestamp() });
                } catch {}
              }
            }
          } catch {}
        } else if (isBlank) {
          setForm({ resumo: "", comercio: "", tecnica: "", sugestao: "" });
          setDraft(null);
          setDraftLoadedFrom(null);
        } else {
          setForm(atrib.analise || {});
          try {
            if (!hasContent(atrib.analise) && (atrib?.pleitoKey || v?.pleitoKey)) {
              const hist = await getHistoricoByPleitoKey(db, (atrib?.pleitoKey || v?.pleitoKey)!);
              if (hist && (hist.ultimoResumo || hist.ultimoComercio || hist.ultimaTecnica || hist.ultimaSugestao)) {
                setDraft({
                  resumo: hist.ultimoResumo || "",
                  comercio: hist.ultimoComercio || "",
                  tecnica: hist.ultimaTecnica || "",
                  sugestao: hist.ultimaSugestao || "",
                });
                setDraftLoadedFrom("histórico");
              }
            }
          } catch {}
        }

        // ===== ficha/pedido a partir da linha =====
        const base: any = v?.linhaPauta || {};
        const fichaLocal: Record<string, string> = {};
        Object.entries(base).forEach(([k, val]) => {
          const keyLower = k.toLowerCase();
          if (HIDDEN_KEYS.test(keyLower)) return;
          const str = String(val ?? "").trim();
          if (!str) return;
          fichaLocal[mapHeader(k)] = str;
        });
        setFicha(fichaLocal);

        // tenta doc do pleito (pode conter dadosResumidos)
        let pleitoDocData: any = null;
        try {
          const pk = atrib.pleitoKey || v?.pleitoKey;
          if (pk) {
            const ps = await getDoc(doc(db, "pleitos", pk));
            if (ps.exists()) pleitoDocData = ps.data();
          }
        } catch {}

        // pedido primário (linha + doc pleito)
        let pedidoLocal = extrairPedidoAmplo(base, pleitoDocData);
        setPedido(pedidoLocal);

        // ======= FALLBACK FINAL: buscar na pauta (pautaId) =======
        if ((!pedidoLocal?.processoSei || (Array.isArray(pedidoLocal.processoSei) && pedidoLocal.processoSei.length === 0)) && atrib.pautaId) {
          try {
            const pautaSnap = await getDoc(doc(db, "pautas", atrib.pautaId));
            if (pautaSnap.exists()) {
              const pauta = pautaSnap.data();
              const rows = flattenPauta(pauta);
              // localizar a linha correspondente
              const alvo = rows.find(({ row }) => {
                const keyRow = gerarPleitoKeyFromRow(row);
                const byKey = atrib.pleitoKey && norm(keyRow) === norm(atrib.pleitoKey);
                const { ncm, produto } = projectLinha(row);
                const byPair =
                  only8(ncm) === only8(atrib.ncm) &&
                  normKey(produto) === normKey(atrib.produto);
                return byKey || byPair;
              })?.row;

              if (alvo) {
                const pedidoDoAlvo = extrairPedidoAmplo(alvo, undefined);
                // preenche apenas faltantes
                pedidoLocal = {
                  ...pedidoLocal,
                  processoSei: normalizeSeiList(pedidoLocal.processoSei as any).length
                    ? pedidoLocal.processoSei
                    : pedidoDoAlvo.processoSei,
                  processoSeiLinks: (pedidoLocal.processoSeiLinks?.length ? pedidoLocal.processoSeiLinks : pedidoDoAlvo.processoSeiLinks) as any,
                };
                setPedido(pedidoLocal);
              }
            }
          } catch {}
        }
      } finally {
        setCarregando(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atrId, copyFrom, isBlank]);

  /* ------------------------------ salvar análise ------------------------------ */
  async function salvar(status?: "em_analise" | "concluido") {
    if (!atrId) return;
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
      if (status) payload.status = status;
      await updateDoc(doc(db, "atribuicoes", atrId), payload);
      toast.success("Análise salva.");
      try { await upsertHistoricoFromAtribuicao(db, atrId); } catch {}
    } finally {
      setSalvando(false);
    }
  }

  /* --------------------------- salvar pós-deliberação -------------------------- */
  async function salvarPosDeliberacao() {
    if (!atrId) return;
    setSalvando(true);
    try {
      const db = getFirestore();
      await updateDoc(doc(db, "atribuicoes", atrId), {
        posDeliberacao: {
          data: pos.data || "",
          resultado: pos.resultado || "",
          encaminhamento: pos.encaminhamento || "",
          numeroAta: pos.numeroAta || "",
        },
        updatedAt: serverTimestamp(),
      });
      toast.success("Encaminhamento pós-deliberação salvo.");
    } finally { setSalvando(false); }
  }

  /* ----------------------------- rótulos amigáveis ---------------------------- */
  function mapHeader(k: string) {
    const map: Record<string, string> = {
      ncm: "NCM",
      produto: "Produto",
      pleiteante: "Pleiteante",
      "tipo de pleito": "Tipo de Pleito",
      "tipo do pleito": "Tipo de Pleito",
      "tipo do pedido": "Tipo de Pleito",
      processo: "Processo",
      "processo sei": "Processo SEI",
      país: "País",
      pais: "País",
      "país pendente": "País (pendente)",
      "pais pendente": "País (pendente)",
      "prazo de resposta": "Prazo de Resposta",
      "prazo resposta": "Prazo de Resposta",
      "fundamentação técnica": "Fundamentação Técnica",
      "fundamentacao tecnica": "Fundamentação Técnica",
      "justificativa econômica": "Justificativa Econômica",
      "justificativa economica": "Justificativa Econômica",
      situação: "Situação",
      situacao: "Situação",
      "notas técnicas": "Notas Técnicas",
      "notas tecnicas": "Notas Técnicas",
      "nota técnica": "Notas Técnicas",
      "nota tecnica": "Notas Técnicas",
    };
    return map[k] || k;
  }

  function extrairPedidoAmplo(base: Record<string, any>, pleitoDoc?: Record<string, any>): PedidoExtraido {
    const fontes: any[] = [
      base,
      base?.dadosResumidos,
      base?.resumo?.dadosResumidos,
      base?.diffResumo?.dadosResumidos,
      pleitoDoc,
      pleitoDoc?.dadosResumidos,
      pleitoDoc?.resumo?.dadosResumidos,
      pleitoDoc?.diffResumo?.dadosResumidos,
    ].filter(Boolean);

    const getRaw = (aliases: string[]) => pickFromSources(fontes, aliases, { raw: true });

    const processoSeiRaw =
      getRaw(["processo sei (público", "processo sei (publico", "processo sei", "processo/sei", "nº sei", "numero sei", "número sei", "sei", "processo"]);

    const processoSeiLinksRaw = getRaw(["link sei", "links sei", "sei link", "sei links"]);
    const toLinksArr = (v: any): string[] | undefined => {
      if (!v) return undefined;
      if (Array.isArray(v)) return v.map(String).filter(Boolean);
      const s = String(v || "").trim();
      return s ? normalizeSeiList(s) : undefined;
    };

    const pick = (aliases: string[]) => {
      const v = getRaw(aliases);
      if (Array.isArray(v)) return v.join(", ");
      return String(v ?? "").trim();
    };

    return {
      tipo: pick(["tipo de pleito", "tipo do pleito", "tipo do pedido"]),
      processoSei: Array.isArray(processoSeiRaw) ? processoSeiRaw : String(processoSeiRaw || ""),
      processoSeiLinks: toLinksArr(processoSeiLinksRaw),
      pais: pick(["país", "pais "]),
      paisPendente: pick(["país pendente", "pais pendente"]),
      prazoResposta: pick(["prazo de resposta", "prazo resposta", "prazo"]),
      fundamentacaoTecnica: pick(["fundamentação técnica", "fundamentacao tecnica"]),
      justificativaEconomica: pick(["justificativa econômica", "justificativa economica"]),
      situacao: pick(["situação", "situacao"]),
      notasTecnicas: pick(["notas técnicas", "notas tecnicas", "nota técnica", "nota tecnica"]),
    };
  }

  /* --------------------------------- hooks derivados --------------------------------- */
  const temAnaliseAtual = useMemo(() => hasContent(form), [form]);
  const showDraftBanner = !!draft && !temAnaliseAtual && draftLoadedFrom === "histórico";
  const seiList = useMemo(() => normalizeSeiList(pedido?.processoSei as any), [pedido?.processoSei]);
  const seiLinks = Array.isArray(pedido?.processoSeiLinks) ? pedido?.processoSeiLinks : [];

  async function handleCopySei(n: string) {
    try {
      await navigator.clipboard.writeText(n);
      setCopiedSei(n);
      setTimeout(() => setCopiedSei(null), 1200);
    } catch {}
  }

  /* --------------------------------- UI --------------------------------- */
  if (carregando || !atr) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-6 w-64 bg-gray-200 rounded" />
          <div className="h-4 w-96 bg-gray-200 rounded" />
          <div className="h-4 w-80 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full p-6 space-y-6">
      {showDraftBanner && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <div className="font-medium">
            Rascunho encontrado (origem: <strong>{draftLoadedFrom}</strong>)
          </div>
          <div className="text-sm mt-1">
            Você pode aplicar os textos anteriores aos <em>campos vazios</em> desta análise.
          </div>
          <div className="mt-3 flex gap-2">
            <button
              className="px-3 py-1.5 rounded border text-sm hover:bg-white"
              onClick={() => {
                setForm((f) => ({
                  resumo: f.resumo || (draft?.resumo || ""),
                  comercio: f.comercio || (draft?.comercio || ""),
                  tecnica: f.tecnica || (draft?.tecnica || ""),
                  sugestao: f.sugestao || (draft?.sugestao || ""),
                }));
                setDraft(null);
              }}
            >
              Aplicar aos campos vazios
            </button>
            <button className="px-3 py-1.5 rounded border text-sm hover:bg-white" onClick={() => setDraft(null)}>
              Dispensar rascunho
            </button>
          </div>
        </div>
      )}

      {/* Cabeçalho */}
      <section className="rounded-xl border bg-white/70 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm text-gray-500">Seção: <span className="font-medium">{atr.tituloSecao || "—"}</span></div>
            <h1 className="mt-1 text-xl font-semibold">{fmtNCM(atr.ncm)} — {atr.produto || "Produto não identificado"}</h1>
            <div className="text-sm text-gray-600 mt-1"><span className="font-medium">Pleiteante:</span> {atr.pleiteante || "—"}</div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="px-4 py-2.5 rounded-xl border hover:bg-gray-50"
              onClick={() =>
                atr.pautaId
                  ? window.open(`/pauta/${encodeURIComponent(atr.pautaId)}?secao=${encodeURIComponent(atr.tituloSecao || "")}`, "_blank")
                  : toast.error("Pauta sem ID.")
              }
            >
              Abrir pauta
            </button>
            <button className="px-4 py-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700" disabled={salvando} onClick={() => salvar("em_analise")}>
              Salvar análise
            </button>
            <button className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700" disabled={salvando} onClick={() => salvar("concluido")}>
              Concluir
            </button>
          </div>
        </div>
      </section>

      {/* Ficha do Pleito */}
      <section className="rounded-xl border bg-white/70 p-4">
        <div className="flex items-center gap-2 text-gray-700">
          <FileText className="w-4 h-4" />
          <h2 className="font-semibold">Ficha do Pleito (dados da pauta)</h2>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Info label="NCM" value={fmtNCM(atr.ncm)} />
          <Info label="Tipo de Pleito" value={atr.tipoPleito || "—"} />
          <Info label="Produto (pleito)" value={atr.produto || "—"} className="md:col-span-2" />
          <Info label="Pleiteante" value={atr.pleiteante || "—"} className="md:col-span-2" />
        </div>

        {/* ===== Dados resumidos (com Processo SEI em destaque) ===== */}
        {(Object.keys(pedido || {}).length > 0) && (
          <>
            <div className="mt-5 text-sm text-gray-500">Dados resumidos</div>

            {/* Processo SEI (chips com copiar/abrir) */}
            <div className="mt-2">
              <div className="text-xs text-gray-500 mb-1">Processo SEI</div>
              {seiList.length === 0 ? (
                <div className="text-sm text-gray-600">—</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {seiList.map((n, idx) => (
                    <span key={`${n}-${idx}`} className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-sm bg-gray-50">
                      <span className="font-mono">{n}</span>
                      <button
                        className="rounded-md border px-1 text-xs hover:bg-white"
                        onClick={() => handleCopySei(n)}
                        title="Copiar número"
                      >
                        Copiar
                      </button>
                      {seiLinks[idx] ? (
                        <a
                          className="rounded-md border px-1 text-xs hover:bg-white"
                          href={seiLinks[idx]}
                          target="_blank"
                          rel="noreferrer"
                          title="Abrir no SEI"
                        >
                          Abrir
                        </a>
                      ) : null}
                    </span>
                  ))}
                </div>
              )}
              {copiedSei && <div className="mt-1 text-xs text-green-600">Copiado: {copiedSei}</div>}
            </div>

            {/* Demais campos (exceto Processo SEI) */}
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(pedido).map(([k, v]) => {
                if (!v) return null;
                if (k === "processoSei" || k === "processoSeiLinks") return null;
                return <Info key={k} label={mapHeader(k)} value={String(v)} />;
              })}
            </div>
          </>
        )}

        {Object.keys(ficha || {}).length > 0 && (
          <>
            <div className="mt-5 text-sm text-gray-500">Outros campos</div>
            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(ficha).map(([k, v]) => (v ? <Info key={k} label={k} value={String(v)} /> : null))}
            </div>
          </>
        )}
      </section>

      {/* Formulário de análise */}
      <section className="rounded-xl border bg-white/70 p-4">
        <h2 className="font-semibold text-gray-700">Análise técnica</h2>

        <div className="mt-3 grid grid-cols-1 gap-4">
          <Field label="Resumo" placeholder="Escreva um resumo objetivo do pedido e do contexto..." value={form.resumo || ""} onChange={(v) => setForm((f) => ({ ...f, resumo: v }))} />
          <Field label="Análise de comércio" placeholder="Aspectos de comércio exterior, impactos, etc..." value={form.comercio || ""} onChange={(v) => setForm((f) => ({ ...f, comercio: v }))} />
          <Field label="Análise técnica" placeholder="Exame técnico do produto, norma, classificação etc..." value={form.tecnica || ""} onChange={(v) => setForm((f) => ({ ...f, tecnica: v }))} />
          <Field label="Sugestão" placeholder="Encaminhamento sugerido..." value={form.sugestao || ""} onChange={(v) => setForm((f) => ({ ...f, sugestao: v }))} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button className="px-4 py-2.5 rounded-xl border hover:bg-gray-50" disabled={salvando} onClick={() => salvar()}>
            Salvar rascunho
          </button>
          <button className="px-4 py-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60" disabled={salvando} onClick={() => salvar("em_analise")}>
            Salvar e continuar
          </button>
          <button className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60" disabled={salvando} onClick={() => salvar("concluido")}>
            Concluir
          </button>
        </div>
      </section>

      {/* Pós-deliberação */}
      <section className="rounded-xl border bg-white/70 p-4">
        <h2 className="font-semibold text-gray-700">Encaminhamento pós-deliberação</h2>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-gray-600">Data</label>
            <input type="date" className="mt-1 w-full rounded border px-3 py-2" value={pos.data || ""} onChange={(e) => setPos((p) => ({ ...p, data: e.target.value }))} />
          </div>
          <div>
            <label className="text-sm text-gray-600">Resultado</label>
            <select className="mt-1 w-full rounded border px-3 py-2" value={pos.resultado || ""} onChange={(e) => setPos((p) => ({ ...p, resultado: (e.target.value || "") as PosDeliberacao["resultado"] }))}>
              <option value="">—</option>
              <option value="aprovado">Aprovado</option>
              <option value="aprovado_com_ajustes">Aprovado com ajustes</option>
              <option value="indeferido">Indeferido</option>
              <option value="retirado">Retirado</option>
              <option value="outro">Outro</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="text-sm text-gray-600">Encaminhamento / Observações</label>
            <textarea className="mt-1 w-full rounded border px-3 py-2" rows={4} value={pos.encaminhamento || ""} onChange={(e) => setPos((p) => ({ ...p, encaminhamento: e.target.value }))} placeholder="Descreva detalhes do encaminhamento, observações, etc." />
          </div>

          <div className="md:col-span-2">
            <label className="text-sm text-gray-600">Nº de ATA/SEI (opcional)</label>
            <input className="mt-1 w-full rounded border px-3 py-2" value={pos.numeroAta || ""} onChange={(e) => setPos((p) => ({ ...p, numeroAta: e.target.value }))} placeholder="Ex.: ATA 123/2025 ou SEI 00000.000000/2025-11" />
          </div>

          <div className="md:col-span-2">
            <button className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60" disabled={salvando} onClick={() => salvarPosDeliberacao()}>
              Salvar encaminhamento
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AnalisePleitoPage;

/* ------------------------------- Sub-componentes ------------------------------ */
function Info(props: { label: string; value: string; className?: string }) {
  return (
    <div className={props.className}>
      <div className="text-xs text-gray-500">{props.label}</div>
      <div className="font-medium">{props.value || "—"}</div>
    </div>
  );
}

function Field(props: { label: string; placeholder?: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-sm text-gray-600">{props.label}</label>
      <textarea
        className="mt-1 w-full rounded border px-3 py-2"
        rows={props.label.toLowerCase().includes("resumo") ? 4 : 6}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}
