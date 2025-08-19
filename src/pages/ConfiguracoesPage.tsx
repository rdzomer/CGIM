// src/pages/ConfiguracoesPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  listarNcmsPorPrefixoPaginado,
  getNcmCountCgim,
  importarNcmsPlanilha,
  Page,
  NcmDoc,
} from "../services/ncmsService";

type NcmLinha = Pick<NcmDoc, "ncm" | "setor" | "produto">;

function onlyDigits(s?: string | null) {
  return (s || "").replace(/\D+/g, "");
}
function formatNcm(ncm?: string | null) {
  const d = onlyDigits(ncm);
  if (!d) return "";
  return [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8)].filter(Boolean).join(".");
}

const PAGE_SIZES = [25, 50, 100, 200];

const ConfiguracoesPage: React.FC = () => {
  const [prefixo, setPrefixo] = useState<string>("");
  const [pageSize, setPageSize] = useState<number>(50);
  const [linhas, setLinhas] = useState<NcmLinha[]>([]);
  const [carregando, setCarregando] = useState<boolean>(false);
  const [total, setTotal] = useState<number>(0);

  const nextCursorRef = useRef<string | undefined>(undefined);

  const totalFmt = useMemo(() => new Intl.NumberFormat("pt-BR").format(total), [total]);

  // 1ª carga: lista primeiro (rápido), conta em paralelo
  useEffect(() => {
    (async () => {
      try {
        setCarregando(true);
        const res = await listarNcmsPorPrefixoPaginado(onlyDigits(prefixo), pageSize);
        setLinhas(res.items);
        nextCursorRef.current = res.nextCursor;
        setCarregando(false);

        // conta em paralelo
        getNcmCountCgim(onlyDigits(prefixo))
          .then((t) => setTotal(t))
          .catch((e) => console.warn("Falha ao contar:", e));
      } catch (e) {
        console.error(e);
        setCarregando(false);
        toast.error("Falha ao carregar NCMs.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onImportar = async (file?: File | null) => {
    if (!file) return;
    try {
      setCarregando(true);
      const res = await importarNcmsPlanilha(file);
      toast.success(
        `Planilha processada. Total de linhas gravadas/atualizadas: ${res?.total ?? "?"}`
      );

      // Reload primeira página
      const L = await listarNcmsPorPrefixoPaginado(onlyDigits(prefixo), pageSize);
      setLinhas(L.items);
      nextCursorRef.current = L.nextCursor;
      setCarregando(false);

      // Count em paralelo
      getNcmCountCgim(onlyDigits(prefixo))
        .then((t) => setTotal(t))
        .catch((e) => console.warn("Falha ao contar após importação:", e));
    } catch (e) {
      console.error(e);
      setCarregando(false);
      toast.error("Falha ao importar a planilha.");
    }
  };

  const aplicarFiltro = async () => {
    try {
      setCarregando(true);
      const res = await listarNcmsPorPrefixoPaginado(onlyDigits(prefixo), pageSize);
      setLinhas(res.items);
      nextCursorRef.current = res.nextCursor;
      setCarregando(false);

      getNcmCountCgim(onlyDigits(prefixo))
        .then((t) => setTotal(t))
        .catch((e) => console.warn("Falha ao contar no filtro:", e));
    } catch (e) {
      console.error(e);
      setCarregando(false);
      toast.error("Erro ao aplicar o filtro.");
    }
  };

  const proximaPagina = async () => {
    try {
      if (!nextCursorRef.current) return;
      setCarregando(true);
      const res: Page<NcmLinha> = await listarNcmsPorPrefixoPaginado(
        onlyDigits(prefixo),
        pageSize,
        nextCursorRef.current
      );
      setLinhas(res.items);
      nextCursorRef.current = res.nextCursor;
      setCarregando(false);
    } catch (e) {
      console.error(e);
      setCarregando(false);
      toast.error("Erro ao carregar próxima página.");
    }
  };

  const limparFiltro = async () => {
    setPrefixo("");
    await aplicarFiltro();
  };

  return (
    <div className="p-6 flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Configurações</h1>

      {/* Upload de planilha */}
      <div className="bg-white rounded border p-4">
        <div className="flex items-center gap-3">
          <label className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 cursor-pointer">
            <input
              type="file"
              className="hidden"
              accept=".xlsx,.xls"
              onChange={(e) => onImportar(e.target.files?.[0] || null)}
            />
            Escolher arquivo
          </label>
          {carregando && <span className="text-sm text-gray-500">Carregando…</span>}
        </div>
        <div className="mt-3 text-sm text-gray-600">
          Total atual no banco: <b>{totalFmt}</b> NCM(s)
        </div>
      </div>

      {/* Filtros e paginação */}
      <div className="bg-white rounded border p-4 mb-3">
        <div className="flex flex-wrap items-center gap-3 w-full">
          <input
            className="border rounded px-3 py-2 w-64"
            type="text"
            inputMode="numeric"
            placeholder="Buscar por NCM (prefixo)..."
            value={prefixo}
            onChange={(e) => setPrefixo(e.target.value || "")}
          />

          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="px-3 py-2 rounded border"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} / pág.
              </option>
            ))}
          </select>

          <button
            onClick={aplicarFiltro}
            className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300"
            disabled={carregando}
          >
            Recarregar
          </button>

          <button
            onClick={proximaPagina}
            className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300"
            disabled={carregando || !nextCursorRef.current}
          >
            Próxima página
          </button>

          <button
            onClick={limparFiltro}
            className="px-3 py-2 rounded bg-gray-100 hover:bg-gray-200"
            disabled={carregando}
          >
            Limpar filtro
          </button>
        </div>
        <div className="text-xs text-gray-500 mt-2">
          Exibindo <b>{linhas.length}</b> itens nesta página
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded border overflow-x-auto">
        <table className="min-w-full table-fixed">
          <thead>
            <tr className="bg-gray-100">
              <th className="px-4 py-2 text-left w-40">NCM</th>
              <th className="px-4 py-2 text-left w-80">Setor</th>
              <th className="px-4 py-2 text-left">Produto</th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-gray-500">
                  Nenhum item encontrado.
                </td>
              </tr>
            ) : (
              linhas.map((l) => (
                <tr key={l.ncm} className="border-t">
                  <td className="px-4 py-3 font-mono">{formatNcm(l.ncm) || "—"}</td>
                  <td className="px-4 py-3">{l.setor || "—"}</td>
                  <td className="px-4 py-3">{l.produto || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ConfiguracoesPage;
