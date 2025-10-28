// src/pages/AnalisePleitoPage.tsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import {
  doc,
  getDoc,
  getFirestore,
  updateDoc,
  serverTimestamp,
  setDoc,
  deleteDoc,
} from "firebase/firestore";
import { getAuth, onAuthStateChanged, User } from "firebase/auth";
import toast from "react-hot-toast";
import { FileText } from "lucide-react";
import {
  getHistoricoByPleitoKey,
  upsertHistoricoFromAtribuicao,
} from "../services/historicoAnalisesService";
import { makeAtribuicaoId } from "../services/atribuicoesService";

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
  statusCode?: "em_analise" | "concluido" | "nao_iniciado";
  analise?: Analise | null;
  linhaPauta?: any;
  posDeliberacao?: PosDeliberacao | null;

  // metadados do analista
  analistaUid?: string;
  analistaEmail?: string;
  analistaNome?: string;

  // aliases compatíveis com MinhasTarefas (algumas versões usam "responsavel*")
  responsavelUid?: string | null;
  responsavelEmail?: string | null;
  responsavelNome?: string | null;

  // timestamps
  updatedAt?: any;
  createdAt?: any;
  concludedAt?: any;
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
  !!(
    a &&
    (norm(a.resumo).length > 0 ||
      norm(a.comercio).length > 0 ||
      norm(a.tecnica).length > 0 ||
      norm(a.sugestao).length > 0)
  );

/** Extrai todos os números SEI de uma string/array. */
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

/* ---------------------- Normalização de status ---------------------- */
function canonicalPair(input?: string | null): { status?: "Em análise" | "Concluído"; code?: "em_analise" | "concluido" } {
  const s = (input || "").toString().trim().toLowerCase();
  if (!s) return {};
  if (/conclu[ií]d/.test(s)) return { status: "Concluído", code: "concluido" };
  if (/em[\s_]?an[aá]lis/.test(s)) return { status: "Em análise", code: "em_analise" };
  return {};
}

/* ------------------------ Auth mini hook ------------------------ */
function useCurrentUser() {
  const [state, setState] = useState<{ loading: boolean; user: User | null }>({ loading: true, user: null });
  useEffect(() => {
    const unsub = onAuthStateChanged(getAuth(), (u) => setState({ loading: false, user: u }));
    return () => unsub();
  }, []);
  return state;
}

/* ========================================================================== */

const AnalisePleitoPage: React.FC = () => {
  const { atrId } = useParams<{ atrId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const db = getFirestore();

  const { loading: authLoading, user } = useCurrentUser();

  const copyFrom = params.get("copyFrom") || "";
  const isBlank = ["1", "true", "yes", "on"].includes((params.get("blank") || "").toLowerCase());

  // Metadados vindos por querystring (quando abre pela Minhas Tarefas)
  const pautaIdQS = params.get("pautaId") || "";
  const pleitoKeyQS = params.get("pleitoKey") || "";
  const ncmQS = params.get("ncm") || "";
  const produtoQS = params.get("produto") || "";
  const pleiteanteQS = params.get("pleiteante") || "";
  const tipoPleitoQS = params.get("tipoPleito") || "";
  const tituloSecaoQS = params.get("tituloSecao") || "";

  // **ID CORRETO**: único por pleitoKey (independe de pauta/retificadora)
  const targetDocId = useMemo(
    () => (pleitoKeyQS ? makeAtribuicaoId(`${pleitoKeyQS}`) : (atrId ? atrId : "")),
    [pleitoKeyQS, atrId]
  );

  // estados
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

  const [prevIdMigrated, setPrevIdMigrated] = useState<string | null>(null);
  const [isRetificadora, setIsRetificadora] = useState<boolean>(false);

  /* --------------------------- Carregar atribuição --------------------------- */
  const hydrate = useCallback(async () => {
    if (authLoading) return;
    setCarregando(true);
    try {
      // Detecta retificadora (se pauta disponível)
      if (pautaIdQS) {
        try {
          const pautaDoc = await getDoc(doc(db, "pautas", pautaIdQS));
          const pdata: any = pautaDoc.exists() ? pautaDoc.data() : null;
          const retFlag = !!(pdata?.diffResumo?.baseId || pdata?.isRetificadora);
          setIsRetificadora(retFlag);
        } catch { setIsRetificadora(false); }
      }

      let loaded: Atrib | null = null;

      // 1) Se temos targetDocId, tenta carregar por ele (modelo novo)
      if (targetDocId) {
        const snapNew = await getDoc(doc(db, "atribuicoes", targetDocId));
        if (snapNew.exists()) {
          const v = snapNew.data() as any;
          loaded = {
            id: targetDocId,
            ncm: v?.ncm || ncmQS || "",
            produto: v?.produto || produtoQS || "",
            pleiteante: v?.pleiteante || pleiteanteQS || "",
            tipoPleito: v?.tipoPleito || tipoPleitoQS || "",
            tituloSecao: v?.tituloSecao || tituloSecaoQS || "",
            pautaId: v?.pautaId || pautaIdQS || "",
            pleitoKey: v?.pleitoKey || pleitoKeyQS || "",
            status: v?.status || "Não iniciado",
            statusCode: v?.statusCode || "nao_iniciado",
            linhaPauta: v?.linhaPauta || null,
            analise: v?.analise || null,
            posDeliberacao: v?.posDeliberacao || null,
            analistaUid: v?.analistaUid,
            analistaEmail: v?.analistaEmail,
            analistaNome: v?.analistaNome,
            responsavelUid: v?.responsavelUid ?? v?.analistaUid ?? null,
            responsavelEmail: v?.responsavelEmail ?? v?.analistaEmail ?? null,
            responsavelNome: v?.responsavelNome ?? v?.analistaNome ?? null,
            updatedAt: v?.updatedAt,
            createdAt: v?.createdAt,
            concludedAt: v?.concludedAt,
          };
        }
      }

      // 2) Se veio com atrId antigo E (ainda) não temos o doc novo, carrega o antigo
      if (!loaded && atrId && atrId !== targetDocId) {
        const legacySnap = await getDoc(doc(db, "atribuicoes", atrId));
        if (legacySnap.exists()) {
          const v = legacySnap.data() as any;
          loaded = {
            id: atrId,
            ncm: v?.ncm || ncmQS || "",
            produto: v?.produto || produtoQS || "",
            pleiteante: v?.pleiteante || pleiteanteQS || "",
            tipoPleito: v?.tipoPleito || tipoPleitoQS || "",
            tituloSecao: v?.tituloSecao || tituloSecaoQS || "",
            pautaId: v?.pautaId || pautaIdQS || "",
            pleitoKey: v?.pleitoKey || pleitoKeyQS || "",
            status: v?.status || "Não iniciado",
            statusCode: v?.statusCode || "nao_iniciado",
            linhaPauta: v?.linhaPauta || null,
            analise: v?.analise || null,
            posDeliberacao: v?.posDeliberacao || null,
            analistaUid: v?.analistaUid,
            analistaEmail: v?.analistaEmail,
            analistaNome: v?.analistaNome,
            responsavelUid: v?.responsavelUid ?? v?.analistaUid ?? null,
            responsavelEmail: v?.responsavelEmail ?? v?.analistaEmail ?? null,
            responsavelNome: v?.responsavelNome ?? v?.analistaNome ?? null,
            updatedAt: v?.updatedAt,
            createdAt: v?.createdAt,
            concludedAt: v?.concludedAt,
          };
        }
      }

      // 3) Reaproveitamento de análise (copyFrom) — se requisitado
      if ((!loaded || isBlank) && copyFrom) {
        try {
          const s = await getDoc(doc(db, "atribuicoes", copyFrom));
          if (s.exists()) {
            const sd: any = s.data();
            const copied: Analise = {
              resumo: sd?.analise?.resumo || "",
              comercio: sd?.analise?.comercio || "",
              tecnica: sd?.analise?.tecnica || "",
              sugestao: sd?.analise?.sugestao || "",
            };
            setForm(copied);
          }
        } catch {}
      } else if (loaded?.analise) {
        setForm({
          resumo: loaded.analise?.resumo || "",
          comercio: loaded.analise?.comercio || "",
          tecnica: loaded.analise?.tecnica || "",
          sugestao: loaded.analise?.sugestao || "",
        });
      }

      // 4) Se ainda não carregou nada, cria um objeto base (sem gravar) para UI
      if (!loaded) {
        loaded = {
          id: targetDocId || (atrId || "novo"),
          ncm: ncmQS || "",
          produto: produtoQS || "",
          pleiteante: pleiteanteQS || "",
          tipoPleito: tipoPleitoQS || "",
          tituloSecao: tituloSecaoQS || "",
          pautaId: pautaIdQS || "",
          pleitoKey: pleitoKeyQS || "",
          status: "Não iniciado",
          statusCode: "nao_iniciado",
          analise: null,
          posDeliberacao: null,
        };
      }
      setAtr(loaded);

      // 5) Rascunho via histórico (se não há análise carregada)
      try {
        if (!hasContent(loaded.analise) && (loaded?.pleitoKey || pleitoKeyQS)) {
          const hist = await getHistoricoByPleitoKey(db, (loaded?.pleitoKey || pleitoKeyQS)!);
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

      // 6) Monta ficha a partir da linha da pauta
      const base: any = (loaded as any)?.linhaPauta || {};
      const fichaLocal: Record<string, string> = {};
      Object.entries(base).forEach(([k, val]) => {
        const keyLower = k.toLowerCase();
        if (HIDDEN_KEYS.test(keyLower)) return;
        const str = String(val ?? "").trim();
        if (!str) return;
        fichaLocal[mapHeader(k)] = str;
      });
      setFicha(fichaLocal);

      // 7) tenta doc do pleito
      let pleitoDocData: any = null;
      try {
        const pk = loaded.pleitoKey || pleitoKeyQS;
        if (pk) {
          const ps = await getDoc(doc(db, "pleitos", pk));
          if (ps.exists()) pleitoDocData = ps.data();
        }
      } catch {}

      // 8) pedido primário (linha + doc pleito)
      let pedidoLocal = extrairPedidoAmplo(base, pleitoDocData);
      setPedido(pedidoLocal);

      // 9) fallback por pauta para processo SEI
      if ((!pedidoLocal?.processoSei || (Array.isArray(pedidoLocal.processoSei) && pedidoLocal.processoSei.length === 0)) && loaded.pautaId) {
        try {
          const pautaSnap = await getDoc(doc(db, "pautas", loaded.pautaId));
          if (pautaSnap.exists()) {
            const pauta = pautaSnap.data();
            const rows = flattenPauta(pauta);
            const alvo = rows.find(({ row }) => {
              const keyRow = gerarPleitoKeyFromRow(row);
              const byKey = loaded.pleitoKey && norm(keyRow) === norm(loaded.pleitoKey);
              const { ncm, produto } = projectLinha(row);
              const byPair =
                only8(ncm) === only8(loaded.ncm) &&
                normKey(produto) === normKey(loaded.produto);
              return byKey || byPair;
            })?.row;

            if (alvo) {
              const pedidoDoAlvo = extrairPedidoAmplo(alvo, undefined);
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

      // 10) Se abrimos com atrId legado e não existia targetDocId, migra para o novo
      if (atrId && targetDocId && atrId !== targetDocId) {
        const legacySnap = await getDoc(doc(db, "atribuicoes", atrId));
        const targetSnap = await getDoc(doc(db, "atribuicoes", targetDocId));
        if (legacySnap.exists() && !targetSnap.exists()) {
          const legacy = legacySnap.data();
          await setDoc(
            doc(db, "atribuicoes", targetDocId),
            {
              ...legacy,
              id: targetDocId,
              pautaId: loaded.pautaId || pautaIdQS,
              pleitoKey: loaded.pleitoKey || pleitoKeyQS,
              ncm: loaded.ncm || ncmQS,
              produto: loaded.produto || produtoQS,
              pleiteante: loaded.pleiteante || pleiteanteQS,
              tipoPleito: loaded.tipoPleito || tipoPleitoQS,
              tituloSecao: loaded.tituloSecao || tituloSecaoQS,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
          setPrevIdMigrated(atrId);
        }
      }
    } finally {
      setCarregando(false);
    }
  }, [authLoading, db, atrId, targetDocId, pautaIdQS, pleitoKeyQS, ncmQS, produtoQS, tipoPleitoQS, pleiteanteQS, tituloSecaoQS, copyFrom, isBlank]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  /* ------------------------------ salvar análise ------------------------------ */
  async function salvar(statusWish?: string) {
    if (!targetDocId || !pleitoKeyQS) {
      toast.error("pleitoKey ausente. Volte para Minhas Tarefas e reabra o item.");
      return;
    }
    setSalvando(true);
    try {
      const { status, code } = canonicalPair(statusWish);

      const payload: any = {
        analise: {
          resumo: form.resumo || "",
          comercio: form.comercio || "",
          tecnica: form.tecnica || "",
          sugestao: form.sugestao || "",
        },
        // metadados da URL (sempre atualizados; **preferir a pauta da QS**)
        pautaId: pautaIdQS || atr?.pautaId || "",
        pleitoKey: atr?.pleitoKey || pleitoKeyQS || "",
        ncm: atr?.ncm || ncmQS || "",
        produto: atr?.produto || produtoQS || "",
        pleiteante: atr?.pleiteante || pleiteanteQS || "",
        tipoPleito: atr?.tipoPleito || tipoPleitoQS || "",
        tituloSecao: atr?.tituloSecao || tituloSecaoQS || "",
        updatedAt: serverTimestamp(),
      };

      if (user) {
        payload.analistaUid = user.uid;
        payload.analistaEmail = user.email?.toLowerCase();
        payload.analistaNome = user.displayName || "";

        // **Aliases compatíveis com páginas antigas**
        payload.responsavelUid = user.uid;
        payload.responsavelEmail = (user.email || "").toLowerCase();
        payload.responsavelNome = user.displayName || "";
      }

      if (status && code) {
        payload.status = status;
        payload.statusCode = code;
        if (code === "concluido") payload.concludedAt = serverTimestamp();
      }

      // **1) SALVAR NO DOC-ID ÚNICO (pleitoKey)**
      await setDoc(doc(db, "atribuicoes", targetDocId), payload, { merge: true });

      // **2) ESPELHAR NO DOC LEGADO (atrId), SE EXISTIR E FOR DIFERENTE**
      if (atrId && atrId !== targetDocId) {
        const mirror: any = {
          analise: payload.analise,
          status: payload.status,
          statusCode: payload.statusCode,
          updatedAt: serverTimestamp(),
          concludedAt: payload.concludedAt ?? null,
          redirectTo: targetDocId,
          pautaId: payload.pautaId,
          pleitoKey: payload.pleitoKey,
          ncm: payload.ncm,
          produto: payload.produto,
          pleiteante: payload.pleiteante,
          tipoPleito: payload.tipoPleito,
          tituloSecao: payload.tituloSecao,
          analistaUid: payload.analistaUid,
          analistaEmail: payload.analistaEmail,
          analistaNome: payload.analistaNome,
          responsavelUid: payload.responsavelUid,
          responsavelEmail: payload.responsavelEmail,
          responsavelNome: payload.responsavelNome,
        };
        try {
          await setDoc(doc(db, "atribuicoes", atrId), mirror, { merge: true });
        } catch (e) {
          // não impedir a conclusão se der erro no espelho
          console.warn("Falha ao espelhar no doc legado:", e);
        }
      }

      // Se migramos anteriormente, opcionalmente remover o legado:
      if (prevIdMigrated && prevIdMigrated !== targetDocId) {
        try { await deleteDoc(doc(db, "atribuicoes", prevIdMigrated)); } catch {}
      }

      // Estado local
      setAtr((prev) =>
        prev
          ? {
              ...prev,
              ...payload,
            }
          : ({ id: targetDocId, ...payload } as Atrib)
      );

      // Histórico
      try { await upsertHistoricoFromAtribuicao(db, targetDocId); } catch {}

      toast.success(status === "Concluído" ? "Análise concluída." : "Análise salva.");

      // UX: ao concluir, voltar para minhas tarefas
      if (status === "Concluído") navigate("/minhas-tarefas");
    } catch (err: any) {
      console.error(err);
      const msg = (err && (err.message || err.code)) ? String(err.message || err.code) : "Falha ao salvar.";
      toast.error(msg);
    } finally {
      setSalvando(false);
    }
  }

  /* --------------------------- salvar pós-deliberação -------------------------- */
  async function salvarPosDeliberacao() {
    if (!targetDocId) return;
    setSalvando(true);
    try {
      await setDoc(
        doc(db, "atribuicoes", targetDocId),
        {
          posDeliberacao: {
            data: pos.data || "",
            resultado: pos.resultado || "",
            encaminhamento: pos.encaminhamento || "",
            numeroAta: pos.numeroAta || "",
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // Espelhar no legado também
      if (atrId && atrId !== targetDocId) {
        await setDoc(
          doc(db, "atribuicoes", atrId),
          {
            posDeliberacao: {
              data: pos.data || "",
              resultado: pos.resultado || "",
              encaminhamento: pos.encaminhamento || "",
              numeroAta: pos.numeroAta || "",
            },
            updatedAt: serverTimestamp(),
            redirectTo: targetDocId,
          },
          { merge: true }
        );
      }

      toast.success("Encaminhamento pós-deliberação salvo.");
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Falha ao salvar encaminhamento.");
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
      return s ? [s] : undefined;
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
      {/* Aviso de retificadora */}
      {isRetificadora && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <div className="font-medium">Retificação detectada</div>
          <div className="text-sm mt-1">
            Esta análise será salva no <strong>mesmo registro do pleito (ID único por pleitoKey)</strong>, garantindo reaproveitamento automático entre versões da pauta.
          </div>
        </div>
      )}

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
            <div className="text-sm text-gray-500">
              Seção: <span className="font-medium">{atr.tituloSecao || tituloSecaoQS || "—"}</span>
            </div>
            <h1 className="mt-1 text-xl font-semibold">
              {fmtNCM(atr.ncm || ncmQS)} — {atr.produto || produtoQS || "Produto não identificado"}
            </h1>
            <div className="text-sm text-gray-600 mt-1">
              <span className="font-medium">Pleiteante:</span> {atr.pleiteante || pleiteanteQS || "—"}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="px-4 py-2.5 rounded-xl border hover:bg-gray-50"
              onClick={() =>
                (atr.pautaId || pautaIdQS)
                  ? window.open(`/pauta/${encodeURIComponent(atr.pautaId || pautaIdQS)}?secao=${encodeURIComponent(atr.tituloSecao || tituloSecaoQS || "")}`, "_blank")
                  : toast.error("Pauta sem ID.")
              }
            >
              Abrir pauta
            </button>
            <button
              className="px-4 py-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700"
              disabled={salvando}
              onClick={() => salvar("Em análise")}
            >
              Salvar análise
            </button>
            <button
              className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={salvando}
              onClick={() => salvar("Concluído")}
            >
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
          <Info label="NCM" value={fmtNCM(atr.ncm || ncmQS)} />
          <Info label="Tipo de Pleito" value={atr.tipoPleito || tipoPleitoQS || "—"} />
          <Info label="Produto (pleito)" value={atr.produto || produtoQS || "—"} className="md:col-span-2" />
          <Info label="Pleiteante" value={atr.pleiteante || pleiteanteQS || "—"} className="md:col-span-2" />
        </div>

        {/* ===== Dados resumidos (com Processo SEI em destaque) ===== */}
        {Object.keys(pedido || {}).length > 0 && (
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
          <button className="px-4 py-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60" disabled={salvando} onClick={() => salvar("Em análise")}>
            Salvar e continuar
          </button>
          <button className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60" disabled={salvando} onClick={() => salvar("Concluído")}>
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
