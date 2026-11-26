// src/services/pleitoFields.ts
// Funções compartilhadas para ler os campos de uma linha da pauta,
// independentemente do nome exato da coluna em cada tabela do SEI
// (ex.: "Produto" x "Descrição produto", "Notas Técnicas" x "Nota técnica").

import { gerarPleitoKey } from "./atribuicoesService";

export type PautaRow = Record<string, any>;

export const norm = (s?: any) =>
  String(s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

export const normKey = (s?: any) =>
  norm(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export const onlyDigits = (s?: any) => String(s ?? "").replace(/\D+/g, "");

const LABELS = {
  ncm: ["NCM", "Código NCM", "Codigo NCM", "NCM 8"],
  produto: [
    "Produto",
    "Descrição produto",
    "Descrição do produto",
    "Produto/Descrição",
    "Descrição",
  ],
  pleiteante: ["Pleiteante", "Requerente", "Solicitante", "Empresa"],
  tipoPleito: ["Tipo de Pleito", "Tipo do Pleito", "Tipo do Pedido"],
};

/** Acha a coluna da linha: primeiro por igualdade, depois por "contém". */
export function pickKey(row: PautaRow, labels: string[]): string | undefined {
  const keys = Object.keys(row || {}).filter((k) => !k.startsWith("__"));
  for (const l of labels) {
    const hit = keys.find((k) => normKey(k) === normKey(l));
    if (hit) return hit;
  }
  for (const l of labels) {
    const hit = keys.find((k) => normKey(k).includes(normKey(l)));
    if (hit) return hit;
  }
  return undefined;
}

/** Coluna de Nota(s) Técnica(s), se a tabela tiver. */
export function notaTecnicaKey(row: PautaRow): string | undefined {
  return Object.keys(row || {}).find((k) => {
    const nk = normKey(k);
    return nk.includes("nota") && nk.includes("tecnic");
  });
}

/** Separa várias notas técnicas que vêm grudadas na mesma célula. */
export function splitNotasTecnicas(text?: string | null): string[] {
  const t = norm(text);
  if (!t || t === "-" || t === "—") return [];
  const parts = t
    .split(/(?=Nota\s+T[ée]cnica)/i)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts : [t];
}

export function projectLinha(row: PautaRow) {
  const get = (labels: string[]) => {
    const k = pickKey(row, labels);
    return k ? norm(row[k]) : "";
  };
  const kNota = notaTecnicaKey(row);
  return {
    ncm: get(LABELS.ncm),
    produto: get(LABELS.produto),
    pleiteante: get(LABELS.pleiteante),
    tipoPleito: get(LABELS.tipoPleito),
    notaTecnica: kNota ? norm(row[kNota]) : "",
  };
}

/** pleitoKey de uma linha da pauta — mesma regra usada desde sempre na Pauta CAT. */
export function pleitoKeyFromRow(row: PautaRow): string {
  const { ncm, produto, pleiteante } = projectLinha(row);
  return gerarPleitoKey({ NCM: onlyDigits(ncm), Produto: produto, Pleiteante: pleiteante });
}

/** Lista todas as linhas de uma pauta salva (cobre os formatos antigos). */
export function flattenPautaRows(pauta: any): Array<{ secao: string; row: PautaRow }> {
  const out: Array<{ secao: string; row: PautaRow }> = [];
  const secs = Array.isArray(pauta?.secoes)
    ? pauta.secoes
    : Array.isArray(pauta?.sections)
    ? pauta.sections
    : [];
  const push = (secao: string, rows?: any[]) => {
    if (Array.isArray(rows)) rows.forEach((r) => out.push({ secao, row: r }));
  };
  for (const s of secs) {
    const titulo = norm(s?.titulo ?? s?.title ?? "");
    push(titulo, s?.rows);
    if (Array.isArray(s?.tabelas)) s.tabelas.forEach((t: any) => push(titulo, t?.rows));
    if (Array.isArray(s?.tables)) s.tables.forEach((t: any) => push(titulo, t?.rows));
    push(titulo, s?.pleitos);
  }
  return out;
}

/**
 * Localiza a linha da pauta correspondente a um pleito.
 * 1º pela pleitoKey; 2º por NCM + produto idênticos (normalizados).
 * Nunca casa apenas por NCM + pleiteante, para não confundir dois pleitos
 * da mesma empresa na mesma NCM (ex.: os dois cabos da MEX 6 na 79ª reunião).
 */
export function findRowForPleito(
  rows: Array<{ secao: string; row: PautaRow }>,
  p: { pleitoKey?: string | null; ncm?: string | null; produto?: string | null }
): { secao: string; row: PautaRow } | undefined {
  const key = norm(p.pleitoKey);
  if (key) {
    const hit = rows.find(({ row }) => normKey(pleitoKeyFromRow(row)) === normKey(key));
    if (hit) return hit;
  }
  const n8 = onlyDigits(p.ncm).slice(0, 8);
  const prod = normKey(p.produto);
  if (n8 && prod) {
    return rows.find(({ row }) => {
      const pr = projectLinha(row);
      return onlyDigits(pr.ncm).slice(0, 8) === n8 && normKey(pr.produto) === prod;
    });
  }
  return undefined;
}
