// src/pages/SyncHistoricoRetificadorPage.tsx
import React, { useEffect, useState } from "react";
import { getFirestore, collection, getDocs, orderBy, query } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { syncHistoricoFromRetificadora } from "../services/retificacaoHistoricoSync";

type PautaLight = { id: string; meeting?: string; titulo?: string; createdAt?: any; diffResumo?: any; isRetificadora?: boolean };

const fmtDate = (t: any) => {
  if (!t) return "—";
  const ms = typeof t?.toMillis === "function" ? t.toMillis() : (typeof t === "number" ? t : 0);
  if (!ms) return "—";
  return new Date(ms).toLocaleString("pt-BR");
};

const SyncHistoricoRetificadorPage: React.FC = () => {
  const db = getFirestore();
  const nav = useNavigate();
  const [retifs, setRetifs] = useState<PautaLight[]>([]);
  const [sel, setSel] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    (async () => {
      const snap = await getDocs(query(collection(db, "pautas"), orderBy("createdAt", "desc")));
      const arr: PautaLight[] = [];
      snap.forEach((d) => {
        const v = d.data() as any;
        const isRet = !!(v?.diffResumo?.baseId || v?.isRetificadora);
        if (isRet) arr.push({ id: d.id, ...v, isRetificadora: true });
      });
      setRetifs(arr.slice(0, 100));
    })();
  }, [db]);

  async function onSync() {
    if (!sel) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await syncHistoricoFromRetificadora(sel, db);
      setMsg(`Sincronização concluída. Registros processados: ${res.processed}.`);
    } catch (e: any) {
      console.error(e);
      setMsg(e?.message || "Falha ao sincronizar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">Sincronizar Histórico (Retificadora)</h1>
      <p className="text-sm text-slate-600">
        Selecione a pauta <b>retificadora</b> e clique em <i>Sincronizar histórico</i>. O processo é idempotente.
      </p>

      <div className="flex flex-col gap-2">
        <label className="text-sm text-slate-700">Retificadora</label>
        <select
          className="border rounded-lg px-3 py-2 bg-white"
          value={sel}
          onChange={(e) => setSel(e.target.value)}
        >
          <option value="">— selecione —</option>
          {retifs.map((p) => {
            const baseId = p.diffResumo?.baseId || "—";
            const lab = `${p.meeting || p.titulo || p.id}  •  ${fmtDate(p.createdAt)}  •  baseId: ${baseId}`;
            return <option key={p.id} value={p.id}>{lab}</option>;
          })}
        </select>
      </div>

      <div className="flex gap-2">
        <button
          className="px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
          onClick={onSync}
          disabled={!sel || busy}
        >
          {busy ? "Sincronizando…" : "Sincronizar histórico"}
        </button>
        <button className="px-4 py-2 rounded-xl border" onClick={() => nav("/")}>
          Voltar
        </button>
      </div>

      {msg && <div className="p-3 border rounded-xl bg-white/70">{msg}</div>}

      <div className="mt-6">
        <div className="text-sm font-semibold mb-2">Últimas retificadoras</div>
        <div className="overflow-auto rounded-xl border bg-white/70">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="p-2">Pauta</th>
                <th className="p-2">Criada em</th>
                <th className="p-2">baseId</th>
              </tr>
            </thead>
            <tbody>
              {retifs.slice(0, 10).map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-2">{p.meeting || p.titulo || p.id}</td>
                  <td className="p-2">{fmtDate(p.createdAt)}</td>
                  <td className="p-2">{p.diffResumo?.baseId || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SyncHistoricoRetificadorPage;
