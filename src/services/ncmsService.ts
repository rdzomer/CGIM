// src/services/ncmsService.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "../firebase";
import * as XLSX from "xlsx";
import {
  collection,
  doc,
  getDocs,
  getCountFromServer,
  limit as qLimit,
  orderBy,
  query,
  startAfter,
  writeBatch,
  where,
  startAt,
  endAt,
  DocumentSnapshot,
  Timestamp,
} from "firebase/firestore";

export type NcmCgim = {
  ncm: string;            // "25010011"
  setor?: string;
  produto?: string;
  agrupamento?: string;
  descricao?: string;
  fonte?: string;         // ex.: "20241011_NCMs-CGIM-DINTE.xlsx"
  ativo?: boolean;
  updatedAt?: number;     // epoch seconds
};

const COLLECTION = "ncmsCGIM";

// ---------------------------
// Helpers
// ---------------------------
function onlyDigits(s: string | number | undefined | null): string {
  const raw = (s ?? "").toString();
  return raw.replace(/\D+/g, "");
}
function padNcm8(n: string): string {
  const d = onlyDigits(n).slice(0, 8);
  return d.padEnd(8, "0");
}
function normalizeBool(v: any): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return ["1", "true", "sim", "ativo", "yes"].includes(v.trim().toLowerCase());
  return true;
}

// ---------------------------
// Importação via Excel
// ---------------------------
export async function importarNcmsPlanilha(file: File, sourceName?: string): Promise<{ inseridos: number; atualizados: number; total: number; }> {
  const buf = await file.arrayBuffer();
  return importarNcmsArrayBuffer(buf, sourceName ?? file.name);
}

export async function importarNcmsArrayBuffer(buf: ArrayBuffer, sourceName = "upload.xlsx"): Promise<{ inseridos: number; atualizados: number; total: number; }> {
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Não encontrei planilha no arquivo enviado.");
  const ws = wb.Sheets[sheetName];

  // Tenta ler como objetos pela primeira linha (cabeçalho).
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
  if (!rows.length) throw new Error("Planilha vazia.");

  // Mapeamento flexível de colunas
  // Aceita cabeçalhos como: ncm, código ncm, codigo, produto, setor, agrupamento, descrição, ativo
  const mapRow = (r: Record<string, any>): NcmCgim | null => {
    // Descobrir possíveis nomes
    const keys = Object.keys(r).reduce<Record<string, string>>((acc, k) => {
      acc[k.toLowerCase().trim()] = k;
      return acc;
    }, {});

    const ncmKey =
      keys["ncm"] ??
      keys["código ncm"] ??
      keys["codigo ncm"] ??
      keys["codigo"] ??
      keys["código"] ??
      keys["code"];

    if (!ncmKey) return null;

    const ncm = padNcm8(r[ncmKey]);

    const setorKey = keys["setor"] ?? keys["setor/segmento"];
    const produtoKey = keys["produto"] ?? keys["produto/mercadoria"];
    const agrupKey = keys["agrupamento"] ?? keys["grupo"];
    const descKey = keys["descricao"] ?? keys["descrição"] ?? keys["description"];
    const ativoKey = keys["ativo"] ?? keys["status"];

    const item: NcmCgim = {
      ncm,
      setor: r[setorKey] ?? "",
      produto: r[produtoKey] ?? "",
      agrupamento: r[agrupKey] ?? "",
      descricao: r[descKey] ?? "",
      ativo: normalizeBool(r[ativoKey]),
      fonte: sourceName,
      updatedAt: Math.floor(Date.now() / 1000),
    };

    return item;
  };

  const parsed = rows
    .map(mapRow)
    .filter((x): x is NcmCgim => !!x && !!x.ncm && x.ncm.length === 8);

  if (!parsed.length) throw new Error("Não encontrei nenhuma NCM válida (8 dígitos) na planilha.");

  // Gravação em batch (máx. ~400 por batch para folga)
  let inseridos = 0;
  let atualizados = 0;

  const colRef = collection(db, COLLECTION);

  for (let i = 0; i < parsed.length; i += 400) {
    const slice = parsed.slice(i, i + 400);
    const batch = writeBatch(db);

    // Para diferenciar inserção x atualização, buscamos docs atuais do slice.
    // (otimização: como o id é o próprio ncm, checamos por getDocs com where in blocos de 10)
    for (const item of slice) {
      const ref = doc(colRef, item.ncm);
      // Não vamos ler cada doc individualmente aqui (latência alta).
      // Em vez disso, marcamos todos como set(..., {merge:true}) e contamos como “inseridos” se updatedAt inexistente.
      // Para efeito de contagem aproximada, consideraremos “atualizado” quando sobrescrever um doc existente
      // ==> faremos um set com merge e usaremos a heurística: if (createdAt ausente) => atualizados++ depois via transform.
      batch.set(ref, {
        ...item,
        ativo: item.ativo ?? true,
        updatedAt: item.updatedAt,
      }, { merge: true });
    }

    await batch.commit();

    // Como não lemos antes, contamos todos como "atualizados".
    // Para ter contagem exata, poderíamos fazer round-trip, mas não é necessário para o app.
    atualizados += slice.length;
  }

  return { inseridos, atualizados, total: parsed.length };
}

// ---------------------------
// Listagem/Paginação com filtro por prefixo
// ---------------------------
export type ListaNcmResult = {
  itens: NcmCgim[];
  nextCursor?: DocumentSnapshot;
};

export async function listarNcmsPaginado(
  pageSize: number,
  opts?: { prefix?: string; cursor?: DocumentSnapshot | null }
): Promise<ListaNcmResult> {
  const prefix = (opts?.prefix ?? "").trim();
  const cursor = opts?.cursor ?? null;

  const colRef = collection(db, COLLECTION);
  const ord = orderBy("ncm");
  const lim = qLimit(pageSize);

  let q;

  if (prefix) {
    // Busca por prefixo: >= prefix e <= prefix + \uf8ff
    // (funciona bem com strings ordenadas lexicograficamente)
    const start = startAt(prefix);
    const end = endAt(prefix + "\uf8ff");
    q = query(colRef, ord, start, end, lim);
  } else {
    q = cursor ? query(colRef, ord, startAfter(cursor), lim) : query(colRef, ord, lim);
  }

  const snap = await getDocs(q);
  const itens = snap.docs.map((d) => d.data() as NcmCgim);
  const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1] : undefined;

  return { itens, nextCursor };
}

export async function getNcmCountCgim(): Promise<number> {
  try {
    const c = collection(db, COLLECTION);
    const snap = await getCountFromServer(c);
    return snap.data().count;
  } catch {
    // Fallback: conta por paginação (mais lento, mas seguro em projetos sem agregações)
    let total = 0;
    let cursor: DocumentSnapshot | null | undefined = undefined;
    // 200 por página para acelerar
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { itens, nextCursor } = await listarNcmsPaginado(200, { cursor: cursor ?? null });
      total += itens.length;
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    return total;
  }
}
