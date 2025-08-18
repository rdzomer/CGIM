// src/services/adminPautasService.ts
// Exclusão de pauta + limpeza de "atribuicoes" relacionadas (em blocos de 500)

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  limit,
  query,
  where,
  writeBatch,
} from "firebase/firestore";

/**
 * Exclui uma pauta e, opcionalmente, apaga as atribuições relacionadas.
 * - pautaId: ID do documento em /pautas
 * - opts.cascadeAtribuicoes: se true, apaga documentos de /atribuicoes com pautaId igual
 */
export async function deletePauta(
  pautaId: string,
  opts: { cascadeAtribuicoes?: boolean } = {}
) {
  const db = getFirestore();

  // 1) Se solicitado, excluir /atribuicoes vinculadas à pauta
  if (opts.cascadeAtribuicoes) {
    const refAtr = collection(db, "atribuicoes");

    // Apaga em blocos de 500 para respeitar limite do batch
    // Continua até não encontrar mais documentos
    // where("pautaId", "==", pautaId) depende de índice simples (normalmente automático)
    while (true) {
      const qy = query(refAtr, where("pautaId", "==", pautaId), limit(500));
      const snap = await getDocs(qy);
      if (snap.empty) break;

      const b = writeBatch(db);
      snap.docs.forEach((d) => b.delete(d.ref));
      await b.commit();

      // Se retornou menos que 500, acabou
      if (snap.size < 500) break;
    }
  }

  // 2) Excluir a própria pauta
  await deleteDoc(doc(db, "pautas", pautaId));
}
