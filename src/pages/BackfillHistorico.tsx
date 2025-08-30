// src/pages/BackfillHistorico.tsx
import React, { useState } from "react";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import { upsertHistoricoFromAtribuicao } from "../services/historicoAnalisesService";

const BackfillHistorico: React.FC = () => {
  const db = getFirestore();
  const [log, setLog] = useState<string>("");

  async function run() {
    setLog("Lendo atribuições…");
    const snap = await getDocs(collection(db, "atribuicoes"));
    let ok = 0, skip = 0;
    for (const d of snap.docs) {
      const a = { id: d.id, ...(d.data() as any) };
      try {
        await upsertHistoricoFromAtribuicao(db, a as any);
        ok++;
      } catch {
        skip++;
      }
    }
    setLog(`Concluído: ${ok} atualizadas; ${skip} ignoradas (sem análise/sem pleitoKey).`);
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Backfill do Histórico de Análises</h1>
      <p className="mt-2 text-sm text-slate-600">
        Isto cria/atualiza documentos em <code>analisesHistoricas</code> a partir de <code>atribuicoes</code>.
      </p>
      <button className="mt-4 px-4 py-2 rounded border hover:bg-gray-50" onClick={run}>
        Executar backfill
      </button>
      {log && <pre className="mt-4 p-3 bg-gray-50 rounded border whitespace-pre-wrap">{log}</pre>}
    </div>
  );
};

export default BackfillHistorico;
