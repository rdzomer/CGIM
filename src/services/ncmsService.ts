// src/services/ncmsService.ts
// Serviço de NCMs pertencentes ao escopo da CGIM.
// Coleção no Firestore: "ncmsCGIM"
// Campos usuais por documento: { ncm: string, setor?: string, produto?: string, fonte?: string, ... }

import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  orderBy,
  where,
  limit as qLimit,
  startAfter,
  writeBatch,
  QueryConstraint,
} from "firebase/firestore";
import { getCountFromServer } from "firebase/firestore";
import * as XLSX from "xlsx";

// =========================
// Helpers
// =========================
const COLLECTION = "ncmsCGIM";

const onlyDigits = (s?: string) => (s ?? "").toString().replace(/\D+/g, "");
const norm8 = (s?: string) => {
  const d = onlyDigits(s).slice(0, 8);
  return d.length === 8 ? d : "";
};

export type NcmDoc = {
  ncm: string;
  setor?: string;
  produto?: string;
  fonte?: string;
  [k: string]: any;
};

export type Page<T> = {
  items: T[];
  nextCursor?: string; // último ncm da página (string)
};

// =========================
// Listagens (one-shot, sem listeners)
// =========================

/**
 * Lista NCMs da coleção "ncmsCGIM" paginados, ordenados por "ncm".
 * @param pageSize Tamanho da página (default 500)
 * @param cursor   Último NCM da página anterior (use o valor retornado em nextCursor)
 */
export async function listarNcmsPaginado(
  pageSize = 500,
  cursor?: string
): Promise<Page<NcmDoc>> {
  return listarNcmsPorPrefixoPaginado("", pageSize, cursor);
}

/**
 * Lista NCMs por prefixo (ex.: "2501" → tudo que começa com 2501), paginado.
 * Usa apenas consultas one-shot (getDocs).
 */
export async function listarNcmsPorPrefixoPaginado(
  prefix: string = "",
  pageSize: number = 500,
  cursor?: string
): Promise<Page<NcmDoc>> {
  const db = getFirestore();
  const col = collection(db, COLLECTION);

  const constraints: QueryConstraint[] = [orderBy("ncm", "asc")];

  const p = onlyDigits(prefix);
  if (p) {
    // range por prefixo + orderBy("ncm")
    constraints.push(where("ncm", ">=", p));
    constraints.push(where("ncm", "<=", p + "\uf8ff"));
  }

  if (cursor) {
    // como a ordenação é por "ncm", podemos avançar pelo valor do campo
    constraints.push(startAfter(cursor));
  }

  constraints.push(qLimit(Math.max(1, pageSize)));

  const q = query(col, ...constraints);
  const snap = await getDocs(q);

  const items: NcmDoc[] = [];
  let last: string | undefined;

  snap.forEach((d) => {
    const v = d.data() as any;
    const n8 = norm8(v?.ncm ?? d.id);
    if (!n8) return;
    items.push({
      ncm: n8,
      setor: v?.setor,
      produto: v?.produto,
      fonte: v?.fonte,
      ...v,
    });
    last = n8;
  });

  return { items, nextCursor: last };
}

// =========================
// Conjuntos e contagem
// =========================

/**
 * Cache leve em memória para o Set de NCMs (evita varreduras repetidas).
 */
const _setCache: { value: Set<string> | null; expires: number } = {
  value: null,
  expires: 0,
};

/**
 * Retorna um Set com todos os NCMs (8 dígitos) da CGIM.
 * Implementado por varredura paginada para evitar agregações/quotas.
 * Usa cache em memória com TTL de 5 minutos.
 */
export async function getNcmSetCgim(): Promise<Set<string>> {
  const now = Date.now();
  if (_setCache.value && _setCache.expires > now) {
    return _setCache.value;
  }

  const s = new Set<string>();
  let cursor: string | undefined = undefined;

  // páginas grandes para reduzir round-trips
  const PAGE = 3000;

  while (true) {
    const { items, nextCursor } = await listarNcmsPorPrefixoPaginado("", PAGE, cursor);
    if (!items.length) break;
    for (const it of items) {
      const n8 = norm8(it.ncm);
      if (n8) s.add(n8);
    }
    if (!nextCursor) break;
    cursor = nextCursor;
  }

  _setCache.value = s;
  _setCache.expires = now + 5 * 60 * 1000; // 5 min
  return s;
}

/**
 * Limpa o cache do Set (se precisar forçar recarga).
 */
export function clearNcmSetCache() {
  _setCache.value = null;
  _setCache.expires = 0;
}

/**
 * Conta NCMs CGIM (aceita opcionalmente prefixo).
 * Tenta usar getCountFromServer (rápido e barato). Se falhar, faz fallback por páginas.
 */
export async function getNcmCountCgim(prefix?: string): Promise<number> {
  const db = getFirestore();
  try {
    const col = collection(db, COLLECTION);
    const constraints: QueryConstraint[] = [];

    const p = onlyDigits(prefix);
    if (p) {
      constraints.push(where("ncm", ">=", p));
      constraints.push(where("ncm", "<=", p + "\uf8ff"));
      constraints.push(orderBy("ncm", "asc"));
    }

    const q = constraints.length ? query(col, ...constraints) : col;
    const snap = await getCountFromServer(q);
    return Number(snap.data().count || 0);
  } catch {
    // Fallback paginado
    let count = 0;
    let cursor: string | undefined = undefined;
    const PAGE = 3000;

    while (true) {
      const { items, nextCursor } = await listarNcmsPorPrefixoPaginado(prefix ?? "", PAGE, cursor);
      if (!items.length) break;
      count += items.length;
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    return count;
  }
}

// =========================
// Upsert
// =========================

/** Upsert (insere/atualiza) um NCM. */
export async function upsertNcm(ncm: string, data: Partial<NcmDoc> = {}): Promise<void> {
  const db = getFirestore();
  const n8 = norm8(ncm);
  if (!n8) throw new Error("NCM inválido (precisa ter 8 dígitos).");
  const ref = doc(db, COLLECTION, n8);
  const prev = await getDoc(ref);
  const merged = { ...(prev.exists() ? prev.data() : {}), ...data, ncm: n8 };
  await setDoc(ref, merged, { merge: true });
}

// =========================
// Importação de Excel
// =========================

/**
 * Importa NCMs a partir de um ArrayBuffer de Excel.
 * - Lê a primeira planilha;
 * - Detecta colunas por cabeçalho (NCM / Setor / Produto) com fallback A/F/I;
 * - Grava por batch (até 500 por commit) — aqui usamos 450 por margem.
 */
export async function importarNcmsArrayBuffer(buf: ArrayBuffer, sourceName = "planilha.xlsx") {
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Planilha sem abas.");

  const json = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
  if (!json.length) throw new Error("Planilha vazia.");

  const header = (json[0] || []).map((h: any) => String(h ?? "").trim());
  const idxOf = (labels: string[]) => {
    const idx = header.findIndex((h) => labels.some((l) => h.toLowerCase() === l.toLowerCase()));
    return idx >= 0 ? idx : -1;
  };

  let iNcm = idxOf(["NCM", "Código NCM", "Codigo NCM", "Código", "Codigo", "NCM 8"]);
  let iSet = idxOf(["Setor", "Setores", "Area", "Área", "Segmento"]);
  let iPro = idxOf(["Produto", "Descrição do Produto", "Descricao do Produto", "Produto/Descrição", "Descrição", "Descricao"]);

  if (iNcm < 0) iNcm = 0;
  if (iSet < 0) iSet = 5;
  if (iPro < 0) iPro = 8;

  const db = getFirestore();
  const col = collection(db, COLLECTION);

  let batch = writeBatch(db);
  let pend = 0;
  let total = 0;

  const FLUSH = async () => {
    if (pend > 0) {
      await batch.commit();
      batch = writeBatch(db);
      pend = 0;
    }
  };

  for (let r = 1; r < json.length; r++) {
    const row = json[r] || [];
    const n8 = norm8(row[iNcm]);
    if (!n8) continue;

    const setor = String(row[iSet] ?? "").trim();
    const produto = String(row[iPro] ?? "").trim();

    const ref = doc(col, n8);
    batch.set(ref, { ncm: n8, setor, produto, fonte: sourceName }, { merge: true });
    pend++;
    total++;

    if (pend >= 450) await FLUSH();
  }
  await FLUSH();

  // Como houve mudança de dados, invalida cache do Set
  clearNcmSetCache();

  return { total };
}

/** Lê arquivo Excel (do input `<input type="file">`) e importa. */
export async function importarNcmsPlanilha(file: File) {
  const buf = await file.arrayBuffer();
  return importarNcmsArrayBuffer(buf, file.name);
}
