// src/services/pautaService.ts
// Serviços ligados às pautas, histórico e tarefas/atribuições.

import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
} from 'firebase/firestore';

const db = getFirestore();

// --------------------- Tipos ---------------------

export type Secao = {
  titulo: string;
  headers: string[];
  rows: Record<string, string>[];
  qtd: number;
};

export type Stats = { secoes: number; tabelas: number; itens: number };

export type PautaFirestore = {
  tituloArquivo: string;
  hash: string;
  secoes: Secao[];
  stats: Stats;
  meeting?: string | null;
  createdAt?: any;
};

export type PleitoAtrib = {
  id: string; // doc id
  pleitoKey: string;
  pautaId: string;
  secaoTitulo: string;
  ncm?: string;
  produto?: string;
  pleiteante?: string;
  responsavelNome?: string;
  responsavelUid?: string;
  responsavelEmail?: string;
  status?: 'novo' | 'em_analise' | 'concluido';
  createdAt?: any;
  updatedAt?: any;
};

// --------------------- Pautas ---------------------

export async function hashDoArquivo(buf: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buf);
  const hex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex;
}

export async function salvarPautaNoFirestoreAuto(
  tituloArquivo: string,
  hash: string,
  secoes: Secao[],
  stats: Stats,
  meeting?: string | null
): Promise<string | null> {
  // coleções: pautas (id = hash) + índice adicional por ordem de criação
  const col = collection(db, 'pautas');
  const pautaRef = doc(col, hash);
  const snap = await getDoc(pautaRef);
  if (snap.exists()) {
    // já existe
    return null;
  }
  await setDoc(pautaRef, {
    tituloArquivo,
    hash,
    secoes,
    stats,
    meeting: meeting ?? null,
    createdAt: serverTimestamp(),
  } as PautaFirestore);
  return hash;
}

export async function regravarPautaPorHash(
  hash: string,
  data: Partial<PautaFirestore>
): Promise<string | null> {
  const ref = doc(collection(db, 'pautas'), hash);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  await setDoc(
    ref,
    { ...data, updatedAt: serverTimestamp() },
    { merge: true }
  );
  return hash;
}

export async function listarPautas(limitRows = 5) {
  const q = query(
    collection(db, 'pautas'),
    orderBy('createdAt', 'desc'),
    limit(limitRows)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

export async function carregarPautaCompleta(id: string) {
  const ref = doc(collection(db, 'pautas'), id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Pauta não encontrada.');
  return { id: snap.id, ...(snap.data() as any) };
}

// --------------------- Atribuições (coleção: atribuicoes) ---------------------

// salva/atualiza uma atribuição de pleito
export async function salvarAtribuicaoPleito(data: {
  pleitoKey: string;
  pautaId: string;
  secaoTitulo: string;
  ncm?: string;
  produto?: string;
  pleiteante?: string;
  responsavelNome?: string;
  responsavelUid?: string;
  responsavelEmail?: string;
  status?: 'novo' | 'em_analise' | 'concluido';
}) {
  const ref = doc(collection(db, 'atribuicoes'), data.pleitoKey);
  await setDoc(
    ref,
    {
      ...data,
      status: data.status ?? 'novo',
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );
}

// lista tarefas do responsável **por UID**
export async function listarPleitosDoResponsavel(uid: string): Promise<PleitoAtrib[]> {
  const q = query(
    collection(db, 'atribuicoes'),
    where('responsavelUid', '==', uid)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

// lista tarefas do responsável **por NOME** (para mapear e-mails → nomes)
export async function listarPleitosDoResponsavelNome(nome: string): Promise<PleitoAtrib[]> {
  const q = query(
    collection(db, 'atribuicoes'),
    where('responsavelNome', '==', nome)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}
