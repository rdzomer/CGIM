// src/services/pautaStore.ts
import { db } from "../firebase";
import {
  collection,
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

// Tipos iguais aos que usamos na PautaCatPage
export type Linha = Record<string, string>;
export type Secao = {
  titulo: string;
  rows: Linha[];
};

type Stats = {
  secoes: number;
  rows: number;
  origem?: string;
};

export async function salvarPautaFirestore(
  secoes: Secao[],
  stats: Stats
): Promise<string> {
  // cria um doc com id automático em 'pautas'
  const colRef = collection(db, "pautas");
  const docRef = doc(colRef);

  await setDoc(docRef, {
    criadoEm: serverTimestamp(),
    stats,
    secoes,
  });

  return docRef.id;
}
