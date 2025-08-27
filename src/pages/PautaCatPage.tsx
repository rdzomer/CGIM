// src/pages/PautaCatPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import {
  salvarPautaNoFirestoreAuto,
  regravarPautaPorHash,
  hashDoArquivo,
  listarPautas,
  carregarPautaCompleta,
} from "../services/pautaService";

import { getNcmSetCgim } from "../services/ncmsService";

import {
  carregarAtribuicoesPorChaves,
  gerarPleitoKey,
  salvarAtribuicaoPleito,
} from "../services/atribuicoesService";

import { useNavigate } from "react-router-dom";

// >>> NOVO: serviço de versionamento/diff entre pautas
import { diffPautas } from "../services/pautaVersioningCompat";

// ---------------- ANALISTAS PADRÃO ----------------
const ANALISTAS = [
  "Ricardo Zomer",
  "Pedro Reckziegel",
  "Antônio Azambuja",
  "Tólio Ribeiro",
] as const;

// ---------------- helpers ----------------
const norm = (s: string) =>
  (s || "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();

const normKey = (s: string) =>
  norm(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function onlyDigits(s: string | undefined | null): string {
  if (!s) return "";
  return String(s).replace(/\D+/g, "");
}

function isHeaderLikely(h: string) {
  const k = normKey(h);
  return (
    k.includes("ncm") ||
    k.includes("produto") ||
    k.includes("pleiteante") ||
    k.includes("quota") ||
    k.includes("redu") || // redução
    k === "ex" ||
    k.includes("pais") ||
    k.includes("situa") ||
    k.includes("tipo de pleito") ||
    k.includes("aliquota") ||
    k.includes("processo") ||
    k.includes("prazo")
  );
}

function dedupeHeaders(headers: string[]) {
  const seen = new Map<string, number>();
  return headers.map((h) => {
    const base = norm(h);
    const k = normKey(base);
    const count = (seen.get(k) || 0) + 1;
    seen.set(k, count);
    return count === 1 ? base : `${base} ${count}`;
  });
}

function decodeHtmlBest(buf: ArrayBuffer): string {
  const utf = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  const iso = new TextDecoder("iso-8859-1").decode(buf);

  const score = (s: string) => {
    const bad = (s.match(/Ã.|Â.|�/g) || []).length;
    const good = (s.match(/[áéíóúãõâêôçÁÉÍÓÚÃÕÂÊÔÇ]/g) || []).length;
    return bad * 10 - good;
  };

  const sUtf = score(utf);
  const sIso = score(iso);
  if (sUtf === sIso) {
    const gUtf = (utf.match(/[áéíóúãõâêôçÁÉÍÓÚÃÕÂÊÔÇ]/g) || []).length;
    const gIso = (iso.match(/[áéíóúãõâêôçÁÉÍÓÚÃÕÂÊÔÇ]/g) || []).length;
    return gUtf >= gIso ? utf : iso;
  }
  return sUtf < sIso ? utf : iso;
}

// ===== extrairMeeting ATUALIZADA (captura a frase completa) =====
function extrairMeeting(html: string): string | null {
  try {
    const dom = new DOMParser().parseFromString(html, "text/html");

    const pick = (texts: string[]) => {
      // prioriza trechos com "Reunião" + (CAT ou Comitê)
      for (const t of texts) {
        const s = (t || "").replace(/\s+/g, " ").trim();
        if (!s) continue;
        if (/reuni[ãa]o/i.test(s) && /(CAT|Comit[êe])/i.test(s)) return s;
      }
      // depois, qualquer linha com "Reunião"
      for (const t of texts) {
        const s = (t || "").replace(/\s+/g, " ").trim();
        if (/reuni[ãa]o/i.test(s)) return s;
      }
      return null;
    };

    // 1) elementos em negrito (strong/b)
    const strongs = Array.from(dom.querySelectorAll("strong,b")).map(
      (el) => el.textContent || ""
    );
    let found = pick(strongs);
    if (found) return found;

    // 2) cabeçalhos
    const headers = Array.from(
      dom.querySelectorAll("h1,h2,h3,h4")
    ).map((el) => el.textContent || "");
    found = pick(headers);
    if (found) return found;

    // 3) primeiras linhas do corpo
    const bodyLines = (dom.body?.innerText || dom.body?.textContent || "")
      .split(/\n+/)
      .slice(0, 60);
    found = pick(bodyLines);
    if (found) return found;
  } catch {
    // continua para fallback por regex
  }

  // Fallbacks por regex (último recurso)
  const m1 = html.match(/\b\d{1,3}ª\s*Reuni[aã]o[^\n<]*/i);
  if (m1) return m1[0].replace(/\s+/g, " ").trim();

  const m2 = html.match(/(Reuni[aã]o[^\n<]{0,120}(CAT|Comit[êe][^\n<]*))/i);
  if (m2) return m2[1].replace(/\s+/g, " ").trim();

  const m3 = html.match(/\b(\d{1,3})ª\b/);
  return m3 ? `${m3[1]}ª` : null;
}

function findSectionTitle(fromEl: Element): string | null {
  let el: Element | null = fromEl.previousElementSibling;
  const candidates: string[] = [];
  for (let i = 0; i < 50 && el; i++, el = el.previousElementSibling) {
    const tag = el.tagName;
    const txtEl = (/(H1|H2|H3|H4)/.test(tag)
      ? el
      : el.querySelector("b, strong")) as Element | null;
    const txt = (txtEl && (txtEl.textContent || "").trim()) || "";
    if (txt) candidates.push(txt.replace(/\s+/g, " ").trim());
  }
  if (candidates.length === 0) return null;

  const numbered = candidates.find((t) => /^\d+(?:\.\d+){0,3}\s+/.test(t));
  if (numbered) return numbered;

  const kw = candidates.find((t) => /(Pleitos|CCM|CAT|LETEC|Mercosul)/i.test(t));
  if (kw) return kw;

  return candidates[0];
}

function parsePautaHtml(html: string) {
  const dom = new DOMParser().parseFromString(html, "text/html");
  const allTables = Array.from(dom.querySelectorAll("table"));

  const secoesBrutas: {
    titulo: string;
    headers: string[];
    rows: Record<string, string>[];
  }[] = [];
  let totalItens = 0;

  for (const tb of allTables) {
    const firstRow = tb.querySelector("tr");
    if (!firstRow) continue;

    let rawHeaders = Array.from(firstRow.querySelectorAll("th")).map((th) =>
      norm(th.textContent || "")
    );
    if (rawHeaders.length === 0) {
      rawHeaders = Array.from(firstRow.querySelectorAll("td")).map((td) =>
        norm(td.textContent || "")
      );
    }
    if (rawHeaders.length === 0) continue;

    const hits = rawHeaders.filter(isHeaderLikely).length;
    if (hits < 2) continue;

    const headers = dedupeHeaders(rawHeaders);
    const rows: Record<string, string>[] = [];

    const dataRows = Array.from(tb.querySelectorAll("tr")).slice(1);
    for (const tr of dataRows) {
      const tds = Array.from(tr.querySelectorAll("td"));
      if (tds.length === 0) continue;

      const rec: Record<string, string> = {};
      tds.forEach((td, i) => {
        const key = headers[i] || `Col_${i + 1}`;
        rec[key] = norm(td.textContent || "");
      });

      if (Object.values(rec).some((v) => v.length > 0)) rows.push(rec);
    }

    if (rows.length === 0) continue;

    const titulo = findSectionTitle(tb) || "Seção";
    secoesBrutas.push({ titulo, headers, rows });
    totalItens += rows.length;
  }

  const byTitle = new Map<
    string,
    { headers: string[]; rows: Record<string, string>[] }
  >();
  for (const s of secoesBrutas) {
    if (!byTitle.has(s.titulo))
      byTitle.set(s.titulo, { headers: s.headers, rows: [] });
    byTitle.get(s.titulo)!.rows.push(...s.rows);
  }

  const numKey = (t: string) => t.match(/^(\d+(?:\.\d+){0,3})/)?.[1] ?? "";
  const secoes = Array.from(byTitle.entries())
    .map(([titulo, v]) => ({
      titulo,
      headers: v.headers,
      rows: v.rows,
      qtd: v.rows.length,
    }))
    .sort((a, b) => (numKey(a.titulo) > numKey(b.titulo) ? 1 : -1));

  return {
    secoes,
    stats: { secoes: secoes.length, tabelas: secoesBrutas.length, itens: totalItens },
  };
}

// ---------------- tipos locais p/ render ----------------
type Secao = {
  titulo: string;
  headers: string[];
  rows: Record<string, string>[];
  qtd: number;
};
type Stats = { secoes: number; tabelas: number; itens: number };

type HistoricoItem = {
  id: string;
  tituloArquivo: string;
  hash: string;
  createdAt?: any;
  itens?: number;
  tabelas?: number;
  // Em alguns registros antigos pode vir "secoes" como número OU como array de seções.
  secoes?: number | Secao[];
  meeting?: string | null;
};

// ---------------- componente ----------------
const PautaCatPage: React.FC = () => {
  const navigate = useNavigate();
  const [secoes, setSecoes] = useState<Secao[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [dupInfo, setDupInfo] = useState<null | { fileName: string; buf: ArrayBuffer }>(null);
  const [firestoreBadge, setFirestoreBadge] = useState<"novo" | "dup" | null>(null);
  const [historico, setHistorico] = useState<HistoricoItem[]>([]);
  const [currentPautaId, setCurrentPautaId] = useState<string | null>(null);

  // >>> NOVO: DIF entre pautas
  const [pautaBaseId, setPautaBaseId] = useState<string>("");
  const [diffResumo, setDiffResumo] = useState<null | {
    removidos: number;
    alterados: number;
    mantidos: number;
    novos: number;
  }>(null);

  // --- CGIM filter ---
  const [somenteCgim, setSomenteCgim] = useState<boolean>(true); // <- ATIVO POR PADRÃO
  const [ncmSet, setNcmSet] = useState<Set<string>>(new Set());

  // --- ATRIBUIÇÕES ---
  const [atribs, setAtribs] = useState<Record<string, string>>({}); // pleitoKey -> responsavelNome

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    getNcmSetCgim()
      .then(setNcmSet)
      .catch(() => setNcmSet(new Set()));
  }, []);

  useEffect(() => {
    listarPautas(5)
      .then((arr: any[]) => setHistorico(arr as HistoricoItem[]))
      .catch(() => {});
  }, []);

  // reabrir última pauta ao voltar
  useEffect(() => {
    const s = sessionStorage.getItem("pauta.lastOpen");
    if (s) {
      try {
        const data = JSON.parse(s);
        sessionStorage.removeItem("pauta.lastOpen");
        if (data?.id) {
          carregarPautaCompleta(data.id).then((res) => {
            setSecoes((res.secoes || []) as Secao[]);
            setStats(res.stats || null);
            setCurrentPautaId(data.id);
            setFirestoreBadge(null);
          });
        }
      } catch {}
    }
  }, []);

  // abrir automaticamente a pauta mais recente ao entrar na página
  useEffect(() => {
    if (currentPautaId) return; // já existe aberta
    if (!historico.length) return; // histórico ainda não carregado
    (async () => {
      try {
        const latest = historico[0];
        const full = await carregarPautaCompleta(latest.id);
        setSecoes((full.secoes || (full.sections as any) || []) as Secao[]);
        setStats(full.stats || null);
        setCurrentPautaId(latest.id);
        setFirestoreBadge(null);
        setSomenteCgim(true); // garante filtro ativo
      } catch {
        // silencioso
      }
    })();
  }, [historico, currentPautaId]);

  function abrirFileDialog() {
    inputRef.current?.click();
  }

  const processarHTML = async (file: File, buf: ArrayBuffer) => {
    const html = decodeHtmlBest(buf);
    const meeting = extrairMeeting(html);
    const { secoes, stats } = parsePautaHtml(html);
    setSecoes(secoes);
    setStats(stats);

    const fileHash = await hashDoArquivo(buf);
    const pautaId = await (salvarPautaNoFirestoreAuto as any)(
      file.name,
      fileHash,
      secoes,
      stats,
      meeting
    );

    if (pautaId) {
      setCurrentPautaId(pautaId);
      setFirestoreBadge("novo");
      setDupInfo(null);
      setHistorico((h) =>
        [
          {
            id: pautaId,
            tituloArquivo: file.name,
            hash: fileHash,
            itens: stats.itens,
            tabelas: stats.tabelas,
            secoes: stats.secoes,
            meeting,
          },
          ...h,
        ].slice(0, 5)
      );

      // >>> NOVO: aplica diff se houve pauta base informada
      try {
        if (pautaBaseId && pautaBaseId !== pautaId) {
          const resumo = await diffPautas(pautaBaseId, pautaId, { aplicarMarcacoes: true });
          if (resumo?.contagens) {
            setDiffResumo(resumo.contagens);
            toast.success(
              `Diferenças aplicadas: ${resumo.contagens.removidos} removidos, ${resumo.contagens.alterados} alterados, ${resumo.contagens.novos} novos.`
            );
          }
        } else {
          setDiffResumo(null);
        }
      } catch (e) {
        console.error(e);
        toast.error("Falha ao comparar pautas (diff).");
      }
    } else {
      setFirestoreBadge("dup");
      setDupInfo({ fileName: file.name, buf });
    }

    toast.success(`Pauta (HTML) processada: ${stats.itens} itens em ${stats.secoes} seções`);
  };

  const onFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const name = (file.name || "").toLowerCase();
      // Nesta página, só processamos HTML da pauta
      if (name.endsWith(".html") || name.endsWith(".htm")) {
        await processarHTML(file, buf);
      } else {
        // fallback simples: tratar como HTML
        await processarHTML(file, buf);
      }
    } catch (err: any) {
      console.error(err);
      toast.error("Falha ao processar o arquivo HTML");
    }
  };

  const reprocessarESobrescrever = async () => {
    if (!dupInfo) return;
    try {
      const buf = dupInfo.buf;

      let meeting: string | null = null;
      let novo: { secoes: Secao[]; stats: Stats };

      // Reprocessa sempre como HTML nesta página
      const html = decodeHtmlBest(buf);
      meeting = extrairMeeting(html);
      novo = parsePautaHtml(html) as any;

      const fileHash = await hashDoArquivo(buf);
      const id = await (regravarPautaPorHash as any)(fileHash, {
        secoes: novo.secoes,
        stats: novo.stats,
        tituloArquivo: dupInfo.fileName,
        meeting,
      });
      if (id) {
        setCurrentPautaId(id);
        setSecoes(novo.secoes);
        setStats(novo.stats);
        toast.success("Arquivo regravado com sucesso.");
        setFirestoreBadge("novo");
        setDupInfo(null);
        setHistorico((h) =>
          h.map((p) =>
            p.hash === fileHash
              ? {
                  ...p,
                  meeting,
                  itens: novo.stats.itens,
                  tabelas: novo.stats.tabelas,
                  secoes: novo.stats.secoes,
                }
              : p
          )
        );

        // >>> NOVO: aplica diff após regravar, se houver pauta base
        try {
          if (pautaBaseId && pautaBaseId !== id) {
            const resumo = await diffPautas(pautaBaseId, id, { aplicarMarcacoes: true });
            if (resumo?.contagens) {
              setDiffResumo(resumo.contagens);
              toast.success(
                `Diferenças aplicadas: ${resumo.contagens.removidos} removidos, ${resumo.contagens.alterados} alterados, ${resumo.contagens.novos} novos.`
              );
            }
          } else {
            setDiffResumo(null);
          }
        } catch (e) {
          console.error(e);
          toast.error("Falha ao comparar pautas (diff).");
        }
      } else {
        toast.error("Hash não encontrado para sobrescrever.");
      }
    } catch (e) {
      console.error(e);
      toast.error("Falha ao regravar.");
    }
  };

  // headers util
  const allHeaders = useMemo(() => {
    const set = new Set<string>();
    secoes.forEach((s) => s.headers.forEach((h) => set.add(h)));
    return Array.from(set);
  }, [secoes]);

  const ncmHeaderName = useMemo(() => {
    const match = allHeaders.find((h) => normKey(h).startsWith("ncm"));
    return match || "NCM";
  }, [allHeaders]);

  const produtoHeaderName = useMemo(() => {
    const match = allHeaders.find((h) => normKey(h).startsWith("produto"));
    return match || "Produto";
  }, [allHeaders]);

  const pleiteanteHeaderName = useMemo(() => {
    const match = allHeaders.find((h) => normKey(h).includes("pleiteante"));
    return match || "Pleiteante";
  }, [allHeaders]);

  // Filtradas por CGIM
  const secoesFiltradas = useMemo(() => {
    if (!somenteCgim || ncmSet.size === 0) return secoes;

    const fil = secoes.map((sec) => {
      const rows = sec.rows.filter((r) => {
        const ncm = String(r[ncmHeaderName] || "").replace(/\D/g, "");
        return ncm && ncmSet.has(ncm);
      });
      return { ...sec, rows, qtd: rows.length };
    });
    return fil.filter((s) => s.qtd > 0);
  }, [secoes, somenteCgim, ncmSet, ncmHeaderName]);

  // Carregar atribuições sempre que as seções mudarem
  useEffect(() => {
    (async () => {
      const keys: string[] = [];
      for (const s of secoes) {
        for (const r of s.rows) {
          // montamos um objeto normalizado com as chaves esperadas pelo service
          const rowForKey = {
            NCM: onlyDigits(String(r[ncmHeaderName] || "")),
            Produto: String(r[produtoHeaderName] || ""),
            Pleiteante: String(r[pleiteanteHeaderName] || ""),
          } as Record<string, string>;
          keys.push(gerarPleitoKey(rowForKey));
        }
      }
      if (!keys.length) {
        setAtribs({});
        return;
      }
      try {
        const map = await carregarAtribuicoesPorChaves(keys);
        setAtribs(map);
      } catch {
        setAtribs({});
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secoes, ncmHeaderName, produtoHeaderName, pleiteanteHeaderName]);

  // Handler de atribuição
  const onAtribuir = async (
    row: Record<string, string>,
    tituloSecao: string,
    novoResp: string
  ) => {
    // mesma normalização usada acima
    const rowForKey = {
      NCM: onlyDigits(String(row[ncmHeaderName] || "")),
      Produto: String(row[produtoHeaderName] || ""),
      Pleiteante: String(row[pleiteanteHeaderName] || ""),
    } as Record<string, string>;

    const key = gerarPleitoKey(rowForKey);

    try {
      await salvarAtribuicaoPleito({
        pleitoKey: key,
        responsavelNome: novoResp || "—", // "—" apaga
        ncm: rowForKey.NCM,
        produto: rowForKey.Produto,
        pleiteante: rowForKey.Pleiteante,
        pautaId: currentPautaId || undefined,
        tituloSecao,
      });

      setAtribs((m) => ({ ...m, [key]: novoResp === "—" ? "" : novoResp }));
      toast.success(novoResp && novoResp !== "—" ? `Atribuído a ${novoResp}` : "Atribuição removida.");
    } catch (e) {
      console.error(e);
      toast.error("Falha ao salvar atribuição.");
    }
  };

  // ---- helpers p/ Histórico: normalizar contadores vindos como número ou array ----
  const histResumo = (() => {
    const h0 = historico[0];
    if (!h0) return null;
    const asNum = (v: any, fallback = 0) => {
      if (Array.isArray(v)) return v.length;
      if (typeof v === "number" && Number.isFinite(v)) return v;
      return fallback;
    };
    return {
      secoes: asNum(h0.secoes),
      tabelas: asNum(h0.tabelas),
      itens: asNum(h0.itens),
    };
  })();

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">Pauta CAT</h1>

      {/* Upload */}
      <div className="mb-4 p-4 bg-white rounded border">
        <p className="mb-2">
          Importe o arquivo da pauta em <b>.html</b> (exportado do SEI).
        </p>

        {/* >>> NOVO: campo para informar a pauta base (ID) e mostrar o resumo do diff */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <label className="text-sm text-slate-700">Pauta base (ID):</label>
          <input
            className="border rounded px-2 py-1"
            placeholder="ID da pauta original (ex.: abc123)"
            value={pautaBaseId}
            onChange={(e) => setPautaBaseId(e.target.value)}
            style={{ minWidth: 260 }}
          />
          {diffResumo && (
            <span className="px-2 py-1 text-xs rounded bg-blue-50 text-blue-800 border border-blue-200">
              Δ {diffResumo.novos} novos · {diffResumo.alterados} alterados · {diffResumo.removidos} removidos · {diffResumo.mantidos} mantidos
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".html,.htm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.currentTarget.value = "";
            }}
          />
          <button
            onClick={abrirFileDialog}
            className="inline-flex items-center px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded"
          >
            Escolher Arquivo
          </button>

          {dupInfo && (
            <button
              onClick={reprocessarESobrescrever}
              className="px-3 py-2 rounded bg-violet-600 text-white hover:bg-violet-700"
            >
              Reprocessar e sobrescrever
            </button>
          )}

          {firestoreBadge === "novo" && (
            <span className="px-2 py-1 text-sm rounded bg-green-100 text-green-800">
              salvo no Firestore
            </span>
          )}
          {firestoreBadge === "dup" && (
            <span className="px-2 py-1 text-sm rounded bg-yellow-100 text-yellow-800">
              já existia (hash)
            </span>
          )}

          {/* Toggle CGIM */}
          <label className="ml-auto inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={somenteCgim}
              onChange={(e) => setSomenteCgim(e.target.checked)}
            />
            Apenas NCMs da CGIM
          </label>
        </div>

        {stats && (
          <div className="text-sm mt-2 text-gray-600">
            Seções detectadas: <b>{stats.secoes}</b>{" "}
            &nbsp;&nbsp; Tabelas consideradas: <b>{stats.tabelas}</b>{" "}
            &nbsp;&nbsp; Pleitos extraídos: <b>{stats.itens}</b>
            {somenteCgim ? (
              <>
                &nbsp;&nbsp;|&nbsp;&nbsp; <b>Filtro CGIM</b> ativo
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* Histórico */}
      <div className="mb-6 p-4 bg-white rounded border">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Histórico (últimas 5 pautas)</h2>
          <button
            type="button"
            onClick={() => navigate("/historico")}
            className="text-sm text-blue-600 hover:underline"
          >
            ver tudo
          </button>
        </div>

        {historico.length === 0 ? (
          <div className="text-sm text-gray-500">Sem pautas recentes.</div>
        ) : (
          <div className="text-sm text-gray-700">
            <div className="mb-2 text-gray-600">
              {histResumo ? (
                <span>
                  {histResumo.secoes} seções · {histResumo.tabelas} tabelas · {histResumo.itens} pleitos
                </span>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {historico.slice(0, 5).map((p) => (
                <div key={p.id} className="border rounded px-3 py-2 bg-gray-50 min-w-[260px]">
                  <div className="font-medium">{p.tituloArquivo}</div>
                  <div className="text-xs text-gray-600 mt-1">
                    Reunião: <b>{p.meeting ?? "—"}</b>
                  </div>

                  <div className="mt-2 flex gap-2">
                    <button
                      className="px-2 py-1 text-xs rounded bg-gray-200 hover:bg-gray-300"
                      onClick={async () => {
                        try {
                          const full = await carregarPautaCompleta(p.id);
                          setSecoes((full.secoes || []) as Secao[]);
                          setStats(full.stats || null);
                          setCurrentPautaId(p.id);
                          setFirestoreBadge(null);
                          toast.success("Pauta carregada do histórico.");
                        } catch {
                          toast.error("Falha ao abrir pauta do histórico.");
                        }
                      }}
                    >
                      abrir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Render das seções (com filtro CGIM aplicado) */}
      {secoesFiltradas.map((sec, idxSec) => {
        const headers = [...sec.headers, "Responsável"];
        return (
          <div key={`${sec.titulo}-${idxSec}`} className="mb-8 bg-white border rounded">
            <div className="px-4 py-3 border-b font-semibold flex items-center justify-between">
              <span>{String(sec.titulo)}</span>
              <span className="text-sm text-gray-500">{Number(sec.qtd) || 0} pleitos</span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full table-fixed">
                <thead>
                  <tr className="bg-gray-100">
                    {headers.map((h) => (
                      <th
                        key={h}
                        className="px-4 py-2 text-left align-top text-sm md:text-base break-words"
                      >
                        {String(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sec.rows.map((row, rIdx) => {
                    // valor atual
                    const rowForKey = {
                      NCM: onlyDigits(String(row[ncmHeaderName] || "")),
                      Produto: String(row[produtoHeaderName] || ""),
                      Pleiteante: String(row[pleiteanteHeaderName] || ""),
                    } as Record<string, string>;
                    const key = gerarPleitoKey(rowForKey);
                    const atual = atribs[key] || "";

                    return (
                      <tr key={`${sec.titulo}-${rIdx}`} className="border-t">
                        {sec.headers.map((h) => {
                          const cell = String(row[h] ?? "");
                          const isNcm = normKey(h).startsWith("ncm");
                          return (
                            <td
                              key={`${h}-${rIdx}`}
                              className="px-4 py-3 align-top whitespace-pre-wrap break-words text-sm md:text-base"
                            >
                              {isNcm ? <b>{cell}</b> : cell}
                            </td>
                          );
                        })}

                        <td className="px-4 py-3 align-top">
                          <div className="flex items-center gap-2">
                            <select
                              className="border rounded px-2 py-1 text-sm"
                              value={atual || "—"}
                              onChange={(e) => onAtribuir(row, sec.titulo, e.target.value)}
                            >
                              <option value="—">—</option>
                              {ANALISTAS.map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                            {atual ? (
                              <span className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700">
                                {atual}
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {sec.rows.length === 0 && (
                    <tr>
                      <td colSpan={headers.length} className="px-4 py-6 text-gray-500">
                        Sem pleitos nesta seção após os filtros.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PautaCatPage;
