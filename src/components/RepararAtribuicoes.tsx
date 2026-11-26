// src/components/RepararAtribuicoes.tsx
// Corrige atribuições cujo responsável foi sobrescrito ao salvar a análise
// (versões anteriores gravavam o nome/e-mail de quem salvou, às vezes em branco).
import React, { useState } from "react";
import toast from "react-hot-toast";
import { getFirestore, collection, getDocs, doc, writeBatch } from "firebase/firestore";
import { resolverAnalista } from "../services/analistas";

type Reparo = { id: string; produto: string; ncm: string; de: string; para: string };

const RepararAtribuicoes: React.FC = () => {
  const [carregando, setCarregando] = useState(false);
  const [reparos, setReparos] = useState<Reparo[] | null>(null);

  const verificar = async () => {
    setCarregando(true);
    try {
      const snap = await getDocs(collection(getFirestore(), "atribuicoes"));
      const lista: Reparo[] = [];
      snap.forEach((d) => {
        const v = d.data() as any;
        if (v?.responsavelNome === null) return; // removido de propósito na Pauta CAT
        if (v?.redirectTo) return; // documento legado espelhado
        const atual = String(v?.responsavelNome ?? "");
        const canon = resolverAnalista(v?.responsavelNome, v?.responsavelEmail, v?.analistaNome, v?.analistaEmail);
        if (canon && canon !== atual) {
          lista.push({ id: d.id, produto: String(v?.produto || ""), ncm: String(v?.ncm || ""), de: atual || "(vazio)", para: canon });
        }
      });
      setReparos(lista);
      if (!lista.length) toast.success("Nenhuma atribuição precisa de reparo.");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Falha ao verificar atribuições.");
    } finally {
      setCarregando(false);
    }
  };

  const aplicar = async () => {
    if (!reparos?.length) return;
    if (!window.confirm(`Atualizar o responsável de ${reparos.length} pleito(s) conforme a lista?`)) return;
    setCarregando(true);
    try {
      const db = getFirestore();
      for (let i = 0; i < reparos.length; i += 400) {
        const b = writeBatch(db);
        for (const r of reparos.slice(i, i + 400)) b.update(doc(db, "atribuicoes", r.id), { responsavelNome: r.para });
        await b.commit();
      }
      toast.success(`${reparos.length} atribuição(ões) reparada(s).`);
      setReparos([]);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Falha ao reparar atribuições.");
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="bg-white rounded border p-4">
      <h2 className="font-semibold">Reparar atribuições</h2>
      <p className="text-sm text-gray-600 mt-1">
        Versões anteriores trocavam o responsável do pleito por quem salvava a análise (às vezes deixando-o em branco),
        e o pleito aparecia sem atribuição na Pauta CAT. Esta rotina reconhece o analista pelo nome ou e-mail gravado e
        restaura o nome na lista oficial. Nada é alterado antes da sua confirmação.
      </p>
      <div className="mt-3 flex gap-2">
        <button className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300" onClick={verificar} disabled={carregando}>
          {carregando ? "Verificando…" : "Verificar"}
        </button>
        {!!reparos?.length && (
          <button className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700" onClick={aplicar} disabled={carregando}>
            Aplicar {reparos.length} reparo(s)
          </button>
        )}
      </div>
      {!!reparos?.length && (
        <div className="mt-3 max-h-80 overflow-auto border rounded">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-3 py-2">NCM</th>
                <th className="px-3 py-2">Produto</th>
                <th className="px-3 py-2">Responsável hoje</th>
                <th className="px-3 py-2">Passa a ser</th>
              </tr>
            </thead>
            <tbody>
              {reparos.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 font-mono">{r.ncm}</td>
                  <td className="px-3 py-2">{r.produto.slice(0, 90)}</td>
                  <td className="px-3 py-2">{r.de}</td>
                  <td className="px-3 py-2 font-medium">{r.para}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default RepararAtribuicoes;
