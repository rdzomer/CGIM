// src/pages/PautaCatPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  salvarPautaNoFirestoreAuto,
  hashDoArquivo,
  listarPautas,
  carregarPautaCompleta,
} from "../services/pautaService";

import { getNcmSetCgim } from "../services/ncmsService";
import {
  carregarAtribuicoesPorChaves,
  salvarAtribuicaoPleito,
} from "../services/atribuicoesService";
import { ANALISTAS } from "../services/analistas";
import { parsePautaHtml, decodeHtmlBest } from "../services/pautaParser";
import { norm, normKey, projectLinha, pleitoKeyFromRow } from "../services/pleitoFields";

// Firestore (para atualizar metadados e, se preciso, localizar pauta pelo hash)
import {
  getFirestore,
  doc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";

// >>> serviço de versionamento/diff entre pautas
import { diffPautas } from "../services/pautaVersioningCompat";

// ===== extrairMeeting (captura a frase completa) =====
function extrairMeeting(html: string): string | null {
  try {
    const dom = new DOMParser().parseFromString(html, "text/html");
    const pick = (texts: string[]) => {
      for (const t of texts) {
        const s = (t || "").replace(/\s+/g, " ").trim();
        if (!s) continue;
        if (/reuni[ãa]o/i.test(s) && /(CAT|Comit[êe])/i.test(s)) return s;
      }
      for (const t of texts) {
        const s = (t || "").replace(/\s+/g, " ").trim();
        if (/reuni[ãa]o/i.test(s)) return s;
      }
      return null;
    };
    const strongs = Array.from(dom.querySelectorAll("strong,b")).map((el) => el.textContent || "");
    let found = pick(strongs);
    if (found) return found;
    const headers = Array.from(dom.querySelectorAll("h1,h2,h3,h4")).map((el) => el.textContent || "");
    found = pick(headers);
    if (found) return found;
    const bodyLines = (dom.body?.innerText || dom.body?.textContent || "").split(/\n+/).slice(0, 60);
    found = pick(bodyLines);
    if (found) return found;
  } catch {}
  const m1 = html.match(/\b\d{1,3}ª\s*Reuni[aã]o[^\n<]*/i);
  if (m1) return m1[0].replace(/\s+/g, " ").trim();
  const m2 = html.match(/(Reuni[aã]o[^\n<]{0,120}(CAT|Comit[êe][^\n<]*))/i);
  if (m2) return m2[1].replace(/\s+/g, " ").trim();
  const m3 = html.match(/\b(\d{1,3})ª\b/);
  return m3 ? `${m3[1]}ª` : null;
}

// ====== Parse data (pt-BR) a partir do texto da reunião ======
function parseMeetingDatePtBR(s?: string): Date | null {
  if (!s) return null;
  // dd/mm/aaaa ou dd-mm-aaaa
  const m = s.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const y = parseInt(m[3].length === 2 ? `20${m[3]}` : m[3], 10);
    const dt = new Date(y, mo, d);
    if (!isNaN(dt.getTime())) return dt;
  }
  // “22 de setembro de 2025”
  const meses = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  const re = new RegExp(`(\\d{1,2})\\s+de\\s+(${meses.join("|")})\\s+de\\s+(\\d{4})`, "i");
  const m2 = s.match(re);
  if (m2) {
    const d = parseInt(m2[1], 10);
    const mo = meses.findIndex(mz => mz.toLowerCase() === m2[2].toLowerCase());
    const y = parseInt(m2[3], 10);
    const dt = new Date(y, mo < 0 ? 0 : mo, d);
    if (!isNaN(dt.getTime())) return dt;
  }
  return null;
}

function makeSlugFromTitle(title?: string, dt?: Date | null): string {
  if (title) {
    return norm(title)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }
  if (dt) {
    const mm = (dt.getMonth() + 1).toString().padStart(2, "0");
    return `pauta-cat-${dt.getFullYear()}-${mm}`;
  }
  return "";
}

// ---------------- tipos locais p/ render ----------------
type Secao = { titulo: string; headers: string[]; rows: Record<string, string>[]; qtd: number; };
type Stats = { secoes: number; tabelas: number; itens: number };

type HistoricoItem = {
  id: string;
  tituloArquivo: string;
  hash: string;
  createdAt?: any;
  itens?: number;
  tabelas?: number;
  secoes?: number | Secao[];
  meeting?: string | null;
};

const db = getFirestore();

// ==== helpers de metadado legível ====
function friendlyTitle(meeting?: string | null, dt?: Date | null) {
  if (meeting && norm(meeting)) return norm(meeting);
  if (dt) {
    const s = dt.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    return `Reunião CAT — ${s[0].toUpperCase()}${s.slice(1)}`;
  }
  return "Reunião CAT";
}

async function upsertPautaMetadata(pautaId: string, fileName: string, meeting: string | null) {
  const dt = parseMeetingDatePtBR(meeting || "");
  const title = friendlyTitle(meeting, dt);
  const slug = makeSlugFromTitle(title, dt);
  const data: any = {
    title,
    slug,
    meeting: meeting || null,
    tituloArquivo: fileName || null,
    updatedAt: serverTimestamp(),
  };
  if (dt) data.meetingDate = Timestamp.fromDate(dt);
  await updateDoc(doc(db, "pautas", pautaId), data);
}

// ---------------- componente ----------------
type DupInfo = { fileName: string; buf: ArrayBuffer; fileHash?: string; existingId: string };

/** Pauta salva -> seções para exibição (aceita formatos antigos). */
function secoesDaPautaSalva(full: any): Secao[] {
  const arr: any[] = Array.isArray(full?.secoes) ? full.secoes : Array.isArray(full?.sections) ? full.sections : [];
  return arr.map((s: any) => {
    const rows = Array.isArray(s?.rows) ? s.rows : [];
    return {
      titulo: String(s?.titulo ?? s?.title ?? ""),
      headers: Array.isArray(s?.headers) ? s.headers : [],
      rows,
      qtd: rows.length,
    } as Secao;
  });
}

const PautaCatPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const idDaUrl = searchParams.get("id") || "";
  const secaoDaUrl = searchParams.get("secao") || "";

  const [secoes, setSecoes] = useState<Secao[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [dupInfo, setDupInfo] = useState<null | DupInfo>(null);
  const [firestoreBadge, setFirestoreBadge] = useState<"novo" | "dup" | null>(null);
  const [historico, setHistorico] = useState<HistoricoItem[]>([]);
  const [currentPautaId, setCurrentPautaId] = useState<string | null>(null);
  const [currentMeeting, setCurrentMeeting] = useState<string | null>(null);

  // >>> DIF entre pautas
  const [pautaBaseId, setPautaBaseId] = useState<string>("");
  const [diffResumo, setDiffResumo] = useState<null | { removidos: number; alterados: number; mantidos: number; novos: number }>(null);

  // --- CGIM filter ---
  const [somenteCgim, setSomenteCgim] = useState<boolean>(true);
  const [ncmSet, setNcmSet] = useState<Set<string>>(new Set());

  // --- ATRIBUIÇÕES ---
  const [atribs, setAtribs] = useState<Record<string, string>>({}); // pleitoKey -> responsavelNome

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    getNcmSetCgim().then(setNcmSet).catch(() => setNcmSet(new Set()));
  }, []);

  useEffect(() => {
    listarPautas(5).then((arr: any[]) => setHistorico(arr as HistoricoItem[])).catch(() => {});
  }, []);

  const abrirPautaSalva = async (id: string, aviso?: string) => {
    try {
      const full = await carregarPautaCompleta(id);
      setSecoes(secoesDaPautaSalva(full));
      setStats(full.stats || null);
      setCurrentPautaId(id);
      setCurrentMeeting(full.meeting || full.title || null);
      setFirestoreBadge(null);
      setDupInfo(null);
      if (aviso) toast.success(aviso);
    } catch {
      toast.error("Falha ao abrir a pauta.");
    }
  };

  // Abre a pauta indicada na URL (?id=...) ou, sem ela, a mais recente
  useEffect(() => {
    if (idDaUrl) {
      if (idDaUrl !== currentPautaId) abrirPautaSalva(idDaUrl);
      return;
    }
    if (currentPautaId || !historico.length) return;
    abrirPautaSalva(historico[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idDaUrl, historico]);

  // Rola até a seção indicada na URL (?secao=...)
  useEffect(() => {
    if (!secaoDaUrl || !secoes.length) return;
    const idx = secoes.findIndex((s) => normKey(s.titulo) === normKey(secaoDaUrl));
    if (idx < 0) return;
    setTimeout(() => document.getElementById(`secao-${idx}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
  }, [secaoDaUrl, secoes]);

  function abrirFileDialog() { inputRef.current?.click(); }

  const aplicarDiffSeHouver = async (pautaId: string) => {
    try {
      if (pautaBaseId && pautaBaseId !== pautaId) {
        const resumo = await diffPautas(pautaBaseId, pautaId, { aplicarMarcacoes: true });
        if (resumo?.contagens) {
          setDiffResumo(resumo.contagens);
          toast.success(`Diferenças: ${resumo.contagens.removidos} removidos · ${resumo.contagens.alterados} alterados · ${resumo.contagens.novos} novos.`);
        }
      } else setDiffResumo(null);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao comparar pautas (diff).");
    }
  };

  const processarHTML = async (file: File, buf: ArrayBuffer) => {
    const html = decodeHtmlBest(buf);
    const meeting = extrairMeeting(html);
    const { secoes, stats } = parsePautaHtml(html);
    setSecoes(secoes);
    setStats(stats);
    setCurrentMeeting(meeting);

    const fileHash = await hashDoArquivo(buf);
    const res = await salvarPautaNoFirestoreAuto(file.name, fileHash, secoes, stats, meeting);
    if (!res) {
      toast.error("Falha ao salvar a pauta.");
      return;
    }

    setCurrentPautaId(res.id);

    if (res.existed) {
      // Mesmo arquivo já importado antes: exibimos a nova extração, mas só gravamos
      // por cima se o usuário pedir (botão "Reprocessar e sobrescrever").
      setFirestoreBadge("dup");
      setDupInfo({ fileName: file.name, buf, fileHash, existingId: res.id });
      toast("Esta pauta já havia sido importada. Use “Reprocessar e sobrescrever” para gravar esta nova extração.", { icon: "ℹ️", duration: 7000 });
      return;
    }

    try { await upsertPautaMetadata(res.id, file.name, meeting || null); } catch {}
    setFirestoreBadge("novo");
    setDupInfo(null);
    setHistorico((h) =>
      [
        { id: res.id, tituloArquivo: file.name, hash: fileHash, itens: stats.itens, tabelas: stats.tabelas, secoes: stats.secoes, meeting },
        ...h.filter((x) => x.id !== res.id),
      ].slice(0, 5)
    );
    await aplicarDiffSeHouver(res.id);
    toast.success(`Pauta (HTML) processada: ${stats.itens} itens em ${stats.secoes} seções`);
  };

  const onFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      await processarHTML(file, buf);
    } catch (err: any) {
      console.error(err);
      toast.error("Falha ao processar o arquivo HTML");
    }
  };

  // Sobrescreve a pauta que já existia com o mesmo arquivo (identificada pelo hash)
  const reprocessarESobrescrever = async () => {
    if (!dupInfo) return;
    try {
      const html = decodeHtmlBest(dupInfo.buf);
      const meeting = extrairMeeting(html);
      const novo = parsePautaHtml(html);
      const alvo = dupInfo.existingId;

      await updateDoc(doc(db, "pautas", alvo), {
        secoes: novo.secoes,
        stats: novo.stats,
        meeting: meeting || null,
        tituloArquivo: dupInfo.fileName,
        updatedAt: serverTimestamp(),
      });
      await upsertPautaMetadata(alvo, dupInfo.fileName, meeting || null);
      setCurrentPautaId(alvo);
      setSecoes(novo.secoes);
      setStats(novo.stats);
      setFirestoreBadge("novo");
      setDupInfo(null);
      toast.success(`Pauta regravada: ${novo.stats.itens} itens em ${novo.stats.secoes} seções.`);
      await aplicarDiffSeHouver(alvo);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao regravar.");
    }
  };

  // Filtradas por CGIM
  const secoesFiltradas = useMemo(() => {
    if (!somenteCgim || ncmSet.size === 0) return secoes;
    const fil = secoes.map((sec) => {
      const rows = sec.rows.filter((r) => {
        const ncm = projectLinha(r).ncm.replace(/\D/g, "").slice(0, 8);
        return ncm && ncmSet.has(ncm);
      });
      return { ...sec, rows, qtd: rows.length };
    });
    return fil.filter((s) => s.qtd > 0);
  }, [secoes, somenteCgim, ncmSet]);

  // Carregar atribuições sempre que as seções mudarem
  useEffect(() => {
    (async () => {
      const keys: string[] = [];
      for (const s of secoes) for (const r of s.rows) keys.push(pleitoKeyFromRow(r));
      if (!keys.length) { setAtribs({}); return; }
      try { const map = await carregarAtribuicoesPorChaves(keys); setAtribs(map); }
      catch { setAtribs({}); }
    })();
  }, [secoes]);

  // Handler de atribuição
  const onAtribuir = async (row: Record<string, string>, tituloSecao: string, novoResp: string) => {
    const p = projectLinha(row);
    const key = pleitoKeyFromRow(row);
    const remover = !novoResp || novoResp === "—";
    try {
      await salvarAtribuicaoPleito({
        pleitoKey: key,
        responsavelNome: remover ? null : novoResp,
        ncm: p.ncm.replace(/\D+/g, ""),
        produto: p.produto,
        pleiteante: p.pleiteante,
        tipoPleito: p.tipoPleito || undefined,
        notaTecnica: p.notaTecnica || undefined,
        pautaId: currentPautaId || undefined,
        tituloSecao,
      });
      setAtribs((m) => ({ ...m, [key]: remover ? "" : novoResp }));
      toast.success(remover ? "Atribuição removida." : `Atribuído a ${novoResp}`);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao salvar atribuição.");
    }
  };

  // ---- helpers p/ Histórico resumido ----
  const histResumo = (() => {
    const h0 = historico[0];
    if (!h0) return null;
    const asNum = (v: any, fallback = 0) => {
      if (Array.isArray(v)) return v.length;
      if (typeof v === "number" && Number.isFinite(v)) return v;
      return fallback;
    };
    return { secoes: asNum(h0.secoes), tabelas: asNum(h0.tabelas), itens: asNum(h0.itens) };
  })();

  return (
    <div className="p-6 overflow-x-hidden">
      <h1 className="text-xl font-bold mb-4">Pauta CAT</h1>

      {/* Upload */}
      <div className="mb-4 p-4 bg-white rounded border">
        <p className="mb-2">Importe o arquivo da pauta em <b>.html</b> (exportado do SEI).</p>

        {/* Campo para informar a pauta base (ID) e mostrar o resumo do diff */}
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
          <button onClick={abrirFileDialog} className="inline-flex items-center px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded">
            Escolher Arquivo
          </button>

          {dupInfo && (
            <>
              <button
                onClick={reprocessarESobrescrever}
                className="px-3 py-2 rounded bg-violet-600 text-white hover:bg-violet-700"
                title="Grava esta nova extração por cima da pauta importada anteriormente com o mesmo arquivo"
              >
                Reprocessar e sobrescrever
              </button>
              <span className="text-xs text-slate-600">
                Este arquivo já havia sido importado. Clique para gravar a nova extração (as atribuições e análises são mantidas).
              </span>
            </>
          )}

          {firestoreBadge === "novo" && (
            <span className="px-2 py-1 text-sm rounded bg-green-100 text-green-800">salvo no Firestore</span>
          )}
          {firestoreBadge === "dup" && (
            <span className="px-2 py-1 text-sm rounded bg-yellow-100 text-yellow-800">já importada antes</span>
          )}

          {/* Toggle CGIM */}
          <label className="ml-auto inline-flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={somenteCgim} onChange={(e) => setSomenteCgim(e.target.checked)} />
            Apenas NCMs da CGIM
          </label>
        </div>

        {currentPautaId && (
          <div className="text-sm mt-3 text-slate-700">
            Pauta aberta: <b>{currentMeeting || "—"}</b> <span className="text-xs text-slate-500">(ID {currentPautaId})</span>
          </div>
        )}
        {stats && (
          <div className="text-sm mt-2 text-gray-600">
            Seções detectadas: <b>{stats.secoes}</b> &nbsp;&nbsp; Tabelas consideradas: <b>{stats.tabelas}</b> &nbsp;&nbsp; Pleitos extraídos: <b>{stats.itens}</b>
            {somenteCgim ? <>&nbsp;&nbsp;|&nbsp;&nbsp; <b>Filtro CGIM</b> ativo</> : null}
          </div>
        )}
      </div>

      {/* Histórico */}
      <div className="mb-6 p-4 bg-white rounded border">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Histórico (últimas 5 pautas)</h2>
          <button type="button" onClick={() => navigate("/historico")} className="text-sm text-blue-600 hover:underline">ver tudo</button>
        </div>

        {historico.length === 0 ? (
          <div className="text-sm text-gray-500">Sem pautas recentes.</div>
        ) : (
          <div className="text-sm text-gray-700">
            <div className="mb-2 text-gray-600">
              {histResumo ? <span>{histResumo.secoes} seções · {histResumo.tabelas} tabelas · {histResumo.itens} pleitos</span> : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {historico.slice(0, 5).map((p) => (
                <div key={p.id} className="border rounded px-3 py-2 bg-gray-50 min-w-[260px]">
                  <div className="font-medium break-words">{p.tituloArquivo}</div>
                  <div className="text-xs text-gray-600 mt-1 break-words">Reunião: <b>{p.meeting ?? "—"}</b></div>

                  <div className="mt-2 flex gap-2">
                    <button
                      className="px-2 py-1 text-xs rounded bg-gray-200 hover:bg-gray-300"
                      onClick={() => abrirPautaSalva(p.id, "Pauta carregada do histórico.")}
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

      {/* Render das seções */}
      {secoesFiltradas.map((sec, idxSec) => {
        // união dos cabeçalhos da seção com as chaves das linhas: pautas gravadas
        // antes da correção do parser podem ter linhas com colunas diferentes
        const headerSet: string[] = [...sec.headers];
        for (const r of sec.rows) for (const k of Object.keys(r)) if (!headerSet.includes(k) && !k.startsWith("__") && k !== "statusVigencia") headerSet.push(k);
        // "Col_N" = coluna sem título no SEI (numeração do item); não é informação do pleito
        const baseHeaders = headerSet.filter((h) => !!norm(h) && norm(h) !== "—" && !/^Col_\d+$/.test(h));
        const sanitizedHeaders = Array.from(new Set(baseHeaders));
        const headers = [...sanitizedHeaders, "Responsável"];

        return (
          <div key={`${sec.titulo}-${idxSec}`} id={`secao-${secoes.findIndex((x) => x.titulo === sec.titulo)}`} className="mb-8 bg-white border rounded scroll-mt-4">
            <div className="px-4 py-3 border-b font-semibold flex items-center justify-between">
              <span className="break-words">{String(sec.titulo)}</span>
              <span className="text-sm text-gray-500">{Number(sec.qtd) || 0} pleitos</span>
            </div>

            <div>
              <table className="w-full">
                <colgroup>
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "28%" }} />
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "20%" }} />
                  <col />
                </colgroup>

                <thead>
                  <tr className="bg-gray-100">
                    {headers.map((h) => (
                      <th key={h} className="px-4 py-2 text-left align-top text-sm md:text-base whitespace-pre-wrap break-words">{String(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sec.rows.map((row, rIdx) => {
const key = pleitoKeyFromRow(row);
                    const atual = atribs[key] || "";

                    return (
                      <tr key={`${sec.titulo}-${rIdx}`} className="border-t">
                        {sanitizedHeaders.map((h) => {
                          const cell = String(row[h] ?? "");
                          const isNcm = normKey(h).startsWith("ncm");
                          const isProd = normKey(h).includes("produto");
                          const isPlei = normKey(h).includes("pleiteante");
                          return (
                            <td
                              key={`${h}-${rIdx}`}
                              className={`px-4 py-3 align-top text-sm md:text-base whitespace-pre-wrap ${isNcm ? "break-all" : "break-words"} ${isProd || isPlei ? "whitespace-pre-wrap" : ""}`}
                            >
                              {isNcm ? <b>{cell}</b> : cell}
                            </td>
                          );
                        })}

                        <td className="px-4 py-3 align-top">
                          <div className="flex items-center gap-2">
                            <select
                              className="border rounded px-2 py-1 text-sm max-w-[220px]"
                              value={atual || "—"}
                              onChange={(e) => onAtribuir(row, sec.titulo, e.target.value)}
                            >
                              <option value="—">—</option>
                              {ANALISTAS.map((n) => (
                                <option key={n} value={n}>{n}</option>
                              ))}
                              {atual && !(ANALISTAS as readonly string[]).includes(atual) ? (
                                <option value={atual}>{atual}</option>
                              ) : null}
                            </select>
                            {atual ? <span className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700">{atual}</span> : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {sec.rows.length === 0 && (
                    <tr>
                      <td colSpan={headers.length} className="px-4 py-6 text-gray-500">Sem pleitos nesta seção após os filtros.</td>
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
