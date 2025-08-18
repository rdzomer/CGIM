
import React, { useEffect, useMemo, useState } from 'react';
import { listarAnalistas, salvarPleito, Pleito } from '../../services/pautaService';
import toast from 'react-hot-toast';

type Props = {
  pautaId: string;
  secaoTitulo: string;
  row: Record<string, string>;
  headers: string[];
};

const normKey = (s: string) =>
  (s || '').replace(/\u00A0/g, ' ').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function pick(row: Record<string, string>, headers: string[], pattern: RegExp): string | undefined {
  const key = headers.find((h) => pattern.test(normKey(h)));
  return key ? row[key] : undefined;
}

const PleitoActions: React.FC<Props> = ({ pautaId, secaoTitulo, row, headers }) => {
  const [open, setOpen] = useState(false);
  const [analistas, setAnalistas] = useState<Array<{ uid: string; nome: string }>>([]);
  const [uid, setUid] = useState<string>('');

  const data = useMemo(() => {
    const ncm = pick(row, headers, /^ncm/);
    const produto = pick(row, headers, /produto/);
    const pleiteante = pick(row, headers, /pleiteante/);
    const quota = pick(row, headers, /quota/);
    const reducao = pick(row, headers, /(redu(c|ç)ao|al[ií]quota)/);
    const processo = pick(row, headers, /processo/);
    return { ncm, produto, pleiteante, quota, reducao, processo };
  }, [row, headers]);

  useEffect(() => {
    listarAnalistas().then(setAnalistas).catch(() => setAnalistas([]));
  }, []);

  const atribuir = async () => {
    if (!uid) {
      toast.error('Selecione um responsável');
      return;
    }
    const analista = analistas.find((a) => a.uid === uid);
    const pleito: Pleito = {
      pautaId,
      secaoTitulo,
      ncm: data.ncm,
      produto: data.produto,
      pleiteante: data.pleiteante,
      quota: data.quota,
      reducao: data.reducao,
      processo: data.processo,
      responsavelUid: uid,
      responsavelNome: analista?.nome || null,
      status: 'novo',
    };
    try {
      await salvarPleito(pautaId, pleito);
      toast.success('Pleito atribuído com sucesso.');
      setOpen(false);
      setUid('');
    } catch (e) {
      console.error(e);
      toast.error('Falha ao atribuir pleito.');
    }
  };

  return (
    <div className="relative">
      <button
        className="px-2 py-1 text-xs rounded bg-gray-200 hover:bg-gray-300"
        onClick={() => setOpen((v) => !v)}
      >
        Atribuir
      </button>

      {open && (
        <div className="absolute z-10 mt-1 w-64 bg-white border rounded shadow p-3">
          <div className="text-sm mb-2 font-medium">Atribuir a:</div>
          <select
            className="w-full border rounded px-2 py-1 mb-3"
            value={uid}
            onChange={(e) => setUid(e.target.value)}
          >
            <option value="">Selecione…</option>
            {analistas.map((a) => (
              <option key={a.uid} value={a.uid}>{a.nome}</option>
            ))}
          </select>

          <div className="flex items-center justify-end gap-2">
            <button className="px-2 py-1 text-xs rounded" onClick={() => setOpen(false)}>Cancelar</button>
            <button className="px-2 py-1 text-xs rounded bg-violet-600 text-white hover:bg-violet-700" onClick={atribuir}>
              Salvar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PleitoActions;
