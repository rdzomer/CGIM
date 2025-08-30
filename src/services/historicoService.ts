import { addDoc, collection, getFirestore, serverTimestamp } from "firebase/firestore";

export type HistoricoPayload = {
  ncm: string;            // "48109290" (8 dígitos)
  pautaId?: string;
  secao?: string;
  resumo?: string;
  tecnica?: string;
  sugestao?: string;
  comercio?: string;
  pleitoKey?: string;
  atrId?: string;         // id da atribuição (se quiser)
  status?: string;        // concluido, retirado, etc.
  encaminhadoGecex?: boolean;
  createdAt?: any;        // se não vier, será serverTimestamp()
};

export async function logHistoricoAnalise(data: HistoricoPayload) {
  const db = getFirestore();
  const payload = {
    ...data,
    createdAt: data.createdAt ?? serverTimestamp(),
  };
  await addDoc(collection(db, "historicoAnalises"), payload);
}
