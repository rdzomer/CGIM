// src/services/pautaParser.ts
// Extração das tabelas de pleitos do HTML da pauta exportada do SEI.

import { norm, normKey } from "./pleitoFields";

export type SecaoPauta = {
  titulo: string;
  headers: string[];
  rows: Record<string, string>[];
  qtd: number;
};
export type StatsPauta = { secoes: number; tabelas: number; itens: number };

function isHeaderLikely(h: string) {
  const k = normKey(h);
  return (
    k.includes("ncm") ||
    k.includes("produto") ||
    k.includes("pleiteante") ||
    k.includes("quota") ||
    k.includes("redu") ||
    k === "ex" ||
    k.includes("pais") ||
    k.includes("situa") ||
    k.includes("tipo de pleito") ||
    k.includes("aliquota") ||
    k.includes("processo") ||
    k.includes("prazo")
  );
}

export function dedupeHeaders(headers: string[]) {
  const seen = new Map<string, number>();
  return headers.map((h) => {
    const base = norm(h);
    const k = normKey(base);
    const count = (seen.get(k) || 0) + 1;
    seen.set(k, count);
    return count === 1 ? base : `${base} ${count}`;
  });
}

/** Aceita "3.1 Pleitos", "3.2. Pleitos Novos", "2.1.2.1 Pleitos do Brasil". */
const NUMBERED_TITLE = /^\d+(?:\.\d+){0,4}\.?\s+\S/;

function textOf(el: Element) {
  return norm(el.textContent || "");
}

/**
 * Título da seção de uma tabela: o parágrafo numerado mais próximo acima dela.
 * Usa o texto completo do parágrafo (ex.: "7.3 Pleito Restituído do Gecex ao CAT",
 * que vem em dois <strong> separados).
 */
export function findSectionTitle(table: Element): string | null {
  const fallback: string[] = [];
  let cursor: Element | null = table;
  let steps = 0;
  while (cursor && steps < 200) {
    let el: Element | null = cursor.previousElementSibling;
    while (el && steps < 200) {
      steps++;
      if (el.tagName !== "TABLE") {
        const isHeading = /^H[1-6]$/.test(el.tagName);
        const hasBold = !!el.querySelector("b, strong");
        if (isHeading || hasBold) {
          const t = textOf(el);
          if (t && t.length <= 200) {
            // número sem ponto (ex.: "3 Pleitos") só vale para textos curtos de título
            if (NUMBERED_TITLE.test(t) && (/^\d+\./.test(t) || t.length <= 80)) return t;
            fallback.push(t);
          }
        }
      }
      el = el.previousElementSibling;
    }
    // sobe um nível (tabela dentro de <div>) e continua a busca
    cursor = cursor.parentElement;
    if (cursor && cursor.tagName === "BODY") break;
  }
  const kw = fallback.find((t) => /(Pleitos|CCM|CAT|LETEC|Mercosul)/i.test(t));
  return kw || fallback[0] || null;
}

/** Parse da pauta: uma seção por título, na ordem em que aparecem no documento. */
export function parsePautaHtml(html: string): { secoes: SecaoPauta[]; stats: StatsPauta } {
  const dom = new DOMParser().parseFromString(html, "text/html");
  const allTables = Array.from(dom.querySelectorAll("table"));

  const ordem: string[] = [];
  const porTitulo = new Map<string, { headers: string[]; rows: Record<string, string>[] }>();
  let tabelas = 0;
  let itens = 0;

  for (const tb of allTables) {
    const trs = Array.from(tb.querySelectorAll("tr")).filter((tr) => tr.closest("table") === tb);
    const firstRow = trs[0];
    if (!firstRow) continue;

    let rawHeaders = Array.from(firstRow.querySelectorAll("th")).map((th) => norm(th.textContent || ""));
    if (rawHeaders.length === 0)
      rawHeaders = Array.from(firstRow.querySelectorAll("td")).map((td) => norm(td.textContent || ""));
    if (rawHeaders.length === 0) continue;
    if (rawHeaders.filter(isHeaderLikely).length < 2) continue;

    const headers = dedupeHeaders(rawHeaders);
    const rows: Record<string, string>[] = [];
    for (const tr of trs.slice(1)) {
      const tds = Array.from(tr.querySelectorAll("td"));
      if (tds.length === 0) continue;
      const rec: Record<string, string> = {};
      tds.forEach((td, i) => {
        rec[headers[i] || `Col_${i + 1}`] = norm(td.textContent || "");
      });
      if (Object.values(rec).some((v) => v.length > 0)) rows.push(rec);
    }
    if (rows.length === 0) continue;

    tabelas++;
    itens += rows.length;
    const titulo = findSectionTitle(tb) || "Seção";
    if (!porTitulo.has(titulo)) {
      porTitulo.set(titulo, { headers: [], rows: [] });
      ordem.push(titulo);
    }
    const sec = porTitulo.get(titulo)!;
    // união dos cabeçalhos — se a seção tiver duas tabelas com colunas
    // diferentes, nenhuma coluna da segunda tabela é perdida na exibição
    for (const h of headers) if (!sec.headers.includes(h)) sec.headers.push(h);
    for (const r of rows) for (const k of Object.keys(r)) if (!sec.headers.includes(k)) sec.headers.push(k);
    sec.rows.push(...rows);
  }

  const secoes = ordem.map((titulo) => {
    const v = porTitulo.get(titulo)!;
    return { titulo, headers: v.headers, rows: v.rows, qtd: v.rows.length };
  });

  return { secoes, stats: { secoes: secoes.length, tabelas, itens } };
}

/** Decodifica o HTML escolhendo entre UTF-8 e ISO-8859-1 (SEI costuma usar o segundo). */
export function decodeHtmlBest(buf: ArrayBuffer): string {
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
