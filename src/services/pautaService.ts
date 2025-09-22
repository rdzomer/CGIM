// src/services/pautaService.ts
// Serviços ligados às pautas, histórico e tarefas/atribuições.
// >>> Nova estratégia: o ID do doc de pauta é gerado pelo Firestore.
//     O hash do arquivo é apenas um CAMPO (para dedupe), não o id.
//     Mantemos compatibilidade com código antigo: "regravarPautaPorHash"
//     aceita ID OU hash (faz lookup pelo campo 'hash' se não achar por id).

import {
  getFirestore,
  collection,
  doc,
  setDoc,
  addDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
} from "firebase/firestore";

// ===================== Tipos =====================
export type PleitoRow = Record<string, string | undefined>;

export type Secao = {
  titulo: string;       // ex.: "2.1.1 Pleitos em análise na CCM"
  campos?: string[];    // cabeçalhos usados nessa seção (NCM, Produto, etc.)
  rows: PleitoRow[];    // linhas extraídas da pauta
};

export type Stats = { secoes: number; tabelas: number; itens: number };

export type PautaFirestore = {
  tituloArquivo: string;
  hash: string;                     // hash do conteúdo (para dedupe)
  secoes: Secao[];
  stats: Stats;
  meeting?: string | null;          // ex.: "Reunião do CAT — Setembro/2025"
  meetingDate?: any;                // opcional (Timestamp/Date)
  createdAt?: any;
  updatedAt?: any;

  // >>> versionamento/retificação
  isRetificadora?: boolean;
  revIndex?: number;                // 0 = base, 1 = 1ª retificação (exibir v2), 2 = v3, ...
  diffResumo?: { baseId?: string } | null;
};

// ===================== Helpers =====================
/** Hash SHA-256 do arquivo (hex). */
export async function hashDoArquivo(buf: ArrayBuffer): Promise<string> {
  // Browser moderno
  if (typeof crypto !== "undefined" && crypto?.subtle) {
    const h = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(h))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Fallback (Node)
  const { createHash } = await import("crypto");
  return createHash("sha256").update(Buffer.from(buf)).digest("hex");
}

/** Busca doc de pauta por ID direto; caso não exista, tenta pelo campo 'hash'. */
async function findPautaRefByIdOrHash(
  idOrHash: string
): Promise<{ id: string } | null> {
  const db = getFirestore();
  // 1) tenta como ID
  const byId = await getDoc(doc(db, "pautas", idOrHash));
  if (byId.exists()) return { id: byId.id };

  // 2) tenta como hash
  const q = query(collection(db, "pautas"), where("hash", "==", idOrHash), limit(1));
  const snap = await getDocs(q);
  if (!snap.empty) return { id: snap.docs[0].id };

  return null;
}

/** Calcula revIndex para uma retificação de baseId (0=base; 1=1ª retificação...). */
async function calcularRevIndex(baseId: string, ignoreId?: string): Promise<number> {
  const db = getFirestore();
  // conta quantas retificações já existem para esta base
  const q = query(collection(db, "pautas"), where("diffResumo.baseId", "==", baseId));
  const snap = await getDocs(q);
  // desconsidera o doc atual (se já existir e estivermos regravando)
  const count = snap.docs.filter((d) => d.id !== ignoreId).length;
  // 1ª retificação -> revIndex=1, que na UI exibiremos como "v2"
  return count + 1;
}

// ===================== Operações principais =====================

/**
 * Cria (se não existir) e retorna o ID da pauta.
 * - Se já houver pauta com o MESMO `hash`, retorna o ID existente (dedupe).
 * - O doc é criado com ID automático (não usa mais o hash como id).
 */
export async function salvarPautaNoFirestoreAuto(
  tituloArquivo: string,
  hash: string,
  secoes: Secao[],
  stats: Stats,
  meeting?: string | null
): Promise<string | null> {
  const db = getFirestore();
  // Dedupe por hash
  const q = query(collection(db, "pautas"), where("hash", "==", hash), limit(1));
  const snap = await getDocs(q);
  if (!snap.empty) {
    // já existe: devolve o ID existente (compat com fluxo antigo)
    return snap.docs[0].id;
  }

  const payload: PautaFirestore = {
    tituloArquivo,
    hash,
    secoes,
    stats,
    meeting: meeting ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, "pautas"), payload);
  return ref.id;
}

/**
 * Atualiza parcialmente uma pauta.
 * Aceita id **OU** hash (para compatibilidade com o código antigo).
 * Se `data.diffResumo.baseId` estiver definido, calcula/atribui `revIndex` e `isRetificadora`.
 */
export async function regravarPautaPorHash(
  idOuHash: string,
  data: Partial<PautaFirestore>
): Promise<string | null> {
  const db = getFirestore();
  const found = await findPautaRefByIdOrHash(idOuHash);
  if (!found) return null;

  const ref = doc(db, "pautas", found.id);
  const toMerge: any = {
    ...data,
    updatedAt: serverTimestamp(),
  };

  // Se for retificadora e não tiver revIndex, calcula
  const baseId = data?.diffResumo?.baseId;
  if (baseId) {
    toMerge.isRetificadora = true;
    if (typeof (await getDoc(ref)).data()?.revIndex !== "number") {
      toMerge.revIndex = await calcularRevIndex(baseId, found.id);
    }
  }

  await updateDoc(ref, toMerge);
  return found.id;
}

/** Lista pautas mais recentes (por createdAt desc). */
export async function listarPautas(limitRows = 12) {
  const db = getFirestore();
  const q = query(
    collection(db, "pautas"),
    orderBy("createdAt", "desc"),
    limit(limitRows)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

/** Carrega uma pauta completa pelo ID. */
export async function carregarPautaCompleta(id: string) {
  const db = getFirestore();
  const ref = doc(collection(db, "pautas"), id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Pauta não encontrada.");
  return { id: snap.id, ...(snap.data() as any) };
}
