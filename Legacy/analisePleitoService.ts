// src/services/analisePleitoService.ts
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";

/**
 * Carrega a atribuição pelo ID (o próprio doc em /atribuicoes/{id})
 * e já tenta enriquecer com o 'meeting' da pauta.
 */
export async function carregarAtribuicaoPorId(atrId: string) {
  const db = getFirestore();

  const ref = doc(db, "atribuicoes", atrId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Atribuição não encontrada.");

  const v = snap.data() as any;
  // opcional: enriquecer meeting a partir de /pautas/{pautaId}
  let meeting: string | null = null;
  if (v?.pautaId) {
    try {
      const pautaSnap = await getDoc(doc(db, "pautas", v.pautaId));
      meeting = String(pautaSnap.data()?.meeting || "");
    } catch {}
  }

  return {
    id: snap.id,
    pautaId: v?.pautaId || "",
    tituloSecao: v?.tituloSecao || "",
    ncm: v?.ncm || "",
    produto: v?.produto || "",
    pleiteante: v?.pleiteante || "",
    status: v?.status || "novo",
    pleitoKey: v?.pleitoKey || "",
    analise: v?.analise || null,
    meeting,
  };
}

/**
 * Salva/atualiza a análise dentro do doc da atribuição.
 * Define status "em_andamento" quando não houver status definido.
 */
export async function salvarAnaliseDoPleito(
  atrId: string,
  analise: { resumo?: string; comercio?: string; tecnica?: string; sugestao?: string },
  autor?: { uid?: string | null; email?: string | null; nome?: string | null } | null,
  statusForcado?: string
) {
  const db = getFirestore();
  const ref = doc(db, "atribuicoes", atrId);

  const payload: any = {
    analise: {
      resumo: analise.resumo ?? "",
      comercio: analise.comercio ?? "",
      tecnica: analise.tecnica ?? "",
      sugestao: analise.sugestao ?? "",
    },
    ultimaEdicao: {
      uid: autor?.uid || null,
      email: autor?.email || null,
      nome: autor?.nome || null,
      at: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  };

  if (statusForcado) {
    payload.status = statusForcado;
  }

  await setDoc(ref, payload, { merge: true });
}

/**
 * Concluir análise: marca status "concluido" e registra finalização.
 */
export async function concluirAnaliseDoPleito(
  atrId: string,
  autor?: { uid?: string | null; email?: string | null; nome?: string | null } | null
) {
  const db = getFirestore();
  const ref = doc(db, "atribuicoes", atrId);
  await updateDoc(ref, {
    status: "concluido",
    finalizadoPor: {
      uid: autor?.uid || null,
      email: autor?.email || null,
      nome: autor?.nome || null,
      at: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });
}
