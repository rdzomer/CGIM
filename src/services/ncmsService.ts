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
  limit as qLimit,
  startAfter,
  writeBatch,
} from "firebase/firestore";

// Opcional (usado apenas em fallback de contagem; pode ser removido se preferir evitar quotas):
import { getCountFromServer } from "firebase/firestore";

// Se o projeto já utiliza a lib 'xlsx' no client:
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

type NcmDoc = {
  ncm: string;
  setor?: string;
  produto?: string;
  fonte?: string;
  [k: string]: any;
};

type Page<T> = {
  items: T[];
  nextCursor?: string; // último ncm da página
};

// =========================
// CRUD básico / leitura
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
  const db = getFirestore();
  const col = collection(db, COLLECTION);

  let q = query(col, orderBy("ncm", "asc"), qLimit(pageSize));
  if (cursor) {
    // Como ordenamos por campo simples, podemos usar startAfter(cursorString)
    q = query(col, orderBy("ncm", "asc"), startAfter(cursor), qLimit(pageSize));
  }

  const snap = await getDocs(q);
  const items: NcmDoc[] = [];
  let last: string | undefined;

  snap.forEach((d) => {
    const v = d.data() as any;
    const n8 = norm8(v?.ncm ?? v?.codigo ?? v?.code);
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

/**
 * Retorna um Set com todos os NCMs (8 dígitos) da CGIM.
 * Implementado por varredura paginada para evitar agregações/quotas.
 */
export async function getNcmSetCgim(): Promise<Set<string>> {
  const s = new Set<string>();
  let cursor: string | undefined = undefined;

  // Páginas grandes (1000) para reduzir round-trips.
  const PAGE = 1000;

  while (true) {
    const { items, nextCursor } = await listarNcmsPaginado(PAGE, cursor);
    if (!items.length) break;
    for (const it of items) {
      const n8 = norm8(it.ncm);
      if (n8) s.add(n8);
    }
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return s;
}

/**
 * Conta NCMs CGIM.
 * Tenta usar getCountFromServer (rápido), mas faz fallback para varredura se quota estourar.
 */
export async function getNcmCountCgim(): Promise<number> {
  const db = getFirestore();
  try {
    const col = collection(db, COLLECTION);
    const snap = await getCountFromServer(col);
    return Number(snap.data().count || 0);
  } catch {
    // Fallback: pagina e conta
    let count = 0;
    let cursor: string | undefined = undefined;
    const PAGE = 2000;
    while (true) {
      const { items, nextCursor } = await listarNcmsPaginado(PAGE, cursor);
      if (!items.length) break;
      count += items.length;
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    return count;
  }
}

/**
 * Upsert (insere/atualiza) um NCM.
 */
export async function upsertNcm(ncm: string, data: Partial<NcmDoc> = {}): Promise<void> {
  const db = getFirestore();
  const n8 = norm8(ncm);
  if (!n8) throw new Error("NCM inválido (precisa ter 8 dígitos).");
  const ref = doc(db, COLLECTION, n8);
  const prev = await getDoc(ref);
  const merged = { ...(prev.exists() ? prev.data() : {}), ...data, ncm: n8 };
  await setDoc(ref, merged, { merge: true });
}

/**
 * Importa NCMs a partir de um ArrayBuffer de Excel.
 * Regras adotadas:
 *  - lê a primeira planilha;
 *  - tenta detectar colunas por cabeçalho (NCM / Setor / Produto), mas
 *    também funciona com posições fixas A (NCM), F (Setor), I (Produto);
 *  - grava por batch (até 500 por commit).
 */
export async function importarNcmsArrayBuffer(buf: ArrayBuffer, sourceName = "planilha.xlsx") {
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Planilha sem abas.");

  const json = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
  if (!json.length) throw new Error("Planilha vazia.");

  // Detecta cabeçalhos
  const header = (json[0] || []).map((h: any) => String(h ?? "").trim());
  const idxOf = (labels: string[]) => {
    const idx = header.findIndex((h) =>
      labels.some((l) => h.toLowerCase() === l.toLowerCase())
    );
    return idx >= 0 ? idx : -1;
  };

  // Tentativas por cabeçalho:
  let iNcm = idxOf(["NCM", "Código NCM", "Codigo NCM", "Código", "Codigo", "NCM 8"]);
  let iSet = idxOf(["Setor", "Setores", "Area", "Área", "Segmento"]);
  let iPro = idxOf(["Produto", "Descrição do Produto", "Descricao do Produto", "Produto/Descrição", "Descrição", "Descricao"]);

  // Se não achou por cabeçalho, usa posições "A=0, F=5, I=8" como fallback
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

    if (pend >= 450) await FLUSH(); // margem antes de 500
  }
  await FLUSH();

  return { total };
}

/** Lê arquivo Excel (do input `<input type="file">`) e importa. */
export async function importarNcmsPlanilha(file: File) {
  const buf = await file.arrayBuffer();
  return importarNcmsArrayBuffer(buf, file.name);
}

// Aliases aceitos pela UI (evita quebrar imports antigos):
export const importarPlanilhaDeNcms = importarNcmsPlanilha;
export const importarExcelNcms = importarNcmsPlanilha;

// =========================
// Compatibilidade de nomes
// =========================

// Nome “correto” usado no app:
export { getNcmSetCgim as getNcmSetCGIM }; // mesma função, alias com CGIM maiúsculo
// Tolerância a typos que apareceram em logs (getNcmSetCgm sem "i"):
export { getNcmSetCgim as getNcmSetCgm };
