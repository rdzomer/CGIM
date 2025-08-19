// src/pages/ConfiguracoesPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

// Importa o service em namespace para tolerar variações de exports
import * as ncmsService from "../services/ncmsService";

// Tipos mínimos usados na tabela
type NcmLinha = {
  ncm: string;
  setor?: string;
  produto?: string;
};

// Helpers
function onlyDigits(s: string | undefined | null): string {
  if (!s) return "";
  return String(s).replace(/\D+/g, "");
}
function formatNcm(ncm: string | undefined | null): string {
  const d = onlyDigits(ncm);
  if (!d) return "";
  const p1 = d.slice(0, 4);
  const p2 = d.slice(4, 6);
  const p3 = d.slice(6, 8);
  return [p1, p2, p3].filter(Boolean).join(".");
}

// Services já existentes no seu projeto (mantidos)
const svcImportarPlanilha =
  // @ts-expect-error - pode existir com esse nome
  (ncmsService.importarNcmsPlanilha as (file: File) => Promise<{
    inseridos?: number;
    atualizados?: number;
    totalLidas?: number;
  }>) ??
  // @ts-expect-error - fallback legado
  (ncmsService.importarPlanilhaNcms as (file: File) => Promise<any>);

const svcContarNcms =
  // @ts-expect-error - preferir contador mais novo
  (ncmsService.getNcmCountCgim as (prefix?: string) => Promise<number>) ??
  // @ts-expect-error - legado
  (ncmsService.contarNcms as (prefix?: string) => Promise<number>) ??
  // @ts-expect-error - legado
  (ncmsService.totalNcms as () => Promise<number>);

// Resultado padronizado de listagem
type PageResult = {
  items: NcmLinha[];
  nextCursor?: any;
  page?: number;
  total?: number;
};

// *** Mais rápido: prioriza listarNcmsPaginado e não bloqueia na contagem ***
async function svcListarNcms(
  opts: { limit: number; prefix?: string; cursor?: any; page?: number }
): Promise<PageResult> {
  const { limit, prefix, cursor, page } = opts;

  // 1) TENTAR listarNcmsPaginado — geralmente é a versão mais eficiente
  if ((ncmsService as any).listarNcmsPaginado) {
    const fn = (ncmsService as any).listarNcmsPaginado;
    try {
      const arity = typeof fn === "function" ? fn.length : 0;
      let res: any;

      if (arity >= 3) {
        // assinatura (prefix, limit, cursor)
        res = await fn(prefix || "", limit, cursor);
      } else if (arity === 2) {
        // assinatura (limit, cursor)
        res = await fn(limit, cursor);
      } else if (arity === 1) {
        // (limit) ou (options)
        try {
          res = await fn({ limit, prefix, cursor });
        } catch {
          res = await fn(limit);
        }
      } else {
        // arity 0 → opções por objeto
        res = await fn({ limit, prefix, cursor });
      }

      return {
        items: res?.items || res?.itens || [],
        nextCursor: res?.nextCursor,
        page: res?.page,
        total: res?.total,
      };
    } catch (e) {
      console.warn("listarNcmsPaginado falhou, tentando outras assinaturas…", e);
    }
  }

  // 2) listarNcms({ limit, prefix, page })
  if ((ncmsService as any).listarNcms) {
    try {
      const res = await (ncmsService as any).listarNcms({ limit, prefix, page, cursor });
      return {
        items: res?.items || res?.itens || [],
        nextCursor: res?.nextCursor,
        page: res?.page,
        total: res?.total,
      };
    } catch (e) {
      console.warn("listarNcms falhou, tentando fallback…", e);
    }
  }

  // 3) listarNcmsPorPagina(prefix, page, limit)
  if ((ncmsService as any).listarNcmsPorPagina) {
    const res = await (ncmsService as any).listarNcmsPorPagina(prefix || "", page ?? 1, limit);
    return {
      items: res?.items || res?.itens || [],
      nextCursor: undefined,
      page: res?.page ?? page ?? 1,
      total: res?.total,
    };
  }

  // Sem nada disponível
  return { items: [] };
}

const PAGE_SIZES = [25, 50, 100, 200];

const ConfiguracoesPage: React.FC = () => {
  const [prefixo, setPrefixo] = useState<string>("");
  const [pageSize, setPageSize] = useState<number>(50);
  const [linhas, setLinhas] = useState<NcmLinha[]>([]);
  const [carregando, setCarregando] = useState<boolean>(false);
  const [total, setTotal] = useState<number>(0);

  // paginação com cursor OU página numérica
  const nextCursorRef = useRef<any>(undefined);
  const pageNumberRef = useRef<number>(1);

  const totalFmt = useMemo(() => new Intl.NumberFormat("pt-BR").format(total), [total]);
  const linhasFiltradas = useMemo(() => linhas, [linhas]);
  const qtdRender = useMemo(() => linhasFiltradas.length, [linhasFiltradas]);

  // Primeira carga: lista primeiro, conta em paralelo (não bloqueia a UI)
  useEffect(() => {
    (async () => {
      try {
        setCarregando(true);

        // FAZ A LISTA (rápido na maioria dos casos)
        const res = await svcListarNcms({
          limit: pageSize,
          prefix: onlyDigits(prefixo) || undefined,
          page: 1,
        });
        setLinhas(res.items ?? []);
        if (typeof res.nextCursor !== "undefined") {
          nextCursorRef.current = res.nextCursor;
          pageNumberRef.current = 0;
        } else {
          nextCursorRef.current = undefined;
          pageNumberRef.current = res.page ?? 1;
        }
        // Se a API já trouxe total, usa; senão, mantemos o antigo até a contagem chegar
        if (typeof res.total === "number") setTotal(res.total);

        setCarregando(false);

        // EM PARALELO: atualiza o total sem travar a tela
        if (svcContarNcms) {
          try {
            const t = await svcContarNcms(prefixo ? onlyDigits(prefixo) : "");
            setTotal(t || 0);
          } catch (e) {
            // não quebra a UI se a contagem falhar
            console.warn("Falha ao obter total:", e);
          }
        }
      } catch (err) {
        console.error(err);
        setCarregando(false);
        toast.error("Falha ao carregar NCMs.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Handlers =====
  const onImportar = async (file?: File | null) => {
    if (!file) return;
    try {
      setCarregando(true);
      const res = await svcImportarPlanilha(file);
      const { inseridos, atualizados, totalLidas } = res || {};

      toast.success(
        `Planilha processada. Lidas: ${totalLidas ?? "?"} · Inseridos: ${inseridos ?? "?"} · Atualizados: ${atualizados ?? "?"}`
      );

      // Recarrega lista rapidamente
      const list = await svcListarNcms({
        limit: pageSize,
        prefix: onlyDigits(prefixo) || undefined,
        page: 1,
      });
      setLinhas(list.items ?? []);
      nextCursorRef.current = list.nextCursor;
      pageNumberRef.current = list.page ?? 1;

      setCarregando(false);

      // Conta em paralelo
      if (svcContarNcms) {
        try {
          const t = await svcContarNcms(prefixo ? onlyDigits(prefixo) : "");
          setTotal(t || 0);
        } catch (e) {
          console.warn("Falha ao contar após importação:", e);
        }
      }
    } catch (e) {
      console.error(e);
      setCarregando(false);
      toast.error("Falha ao importar a planilha de NCMs.");
    }
  };

  const onChangePrefixo = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPrefixo(e.target.value || "");
  };

  // Recarrega a página atual (lista primeiro, total depois)
  const recarregar = async (resetPagina = false) => {
    try {
      setCarregando(true);
      const base: any = {
        limit: pageSize,
        prefix: onlyDigits(prefixo) || undefined,
      };

      if (resetPagina) {
        nextCursorRef.current = undefined;
        pageNumberRef.current = 1;
      }

      const params: any =
        typeof nextCursorRef.current !== "undefined"
          ? { ...base, cursor: undefined }
          : { ...base, page: pageNumberRef.current ?? 1 };

      const res = await svcListarNcms(params);
      setLinhas(res.items ?? []);

      if (typeof res.nextCursor !== "undefined") {
        nextCursorRef.current = res.nextCursor;
        pageNumberRef.current = 0;
      } else {
        nextCursorRef.current = undefined;
        pageNumberRef.current = res.page ?? 1;
      }

      if (typeof res.total === "number") setTotal(res.total);

      setCarregando(false);

      // Conta em paralelo (não bloqueia)
      if (svcContarNcms) {
        try {
          const t = await svcContarNcms(prefixo ? onlyDigits(prefixo) : "");
          setTotal(t || 0);
        } catch (e) {
          console.warn("Falha ao contar no recarregar:", e);
        }
      }
    } catch (err) {
      console.error(err);
      setCarregando(false);
      toast.error("Erro ao recarregar NCMs.");
    }
  };

  const proximaPagina = async () => {
    try {
      setCarregando(true);
      if (typeof nextCursorRef.current !== "undefined") {
        const res = await svcListarNcms({
          limit: pageSize,
          prefix: onlyDigits(prefixo) || undefined,
          cursor: nextCursorRef.current,
        });
        setLinhas(res.items ?? []);
        nextCursorRef.current = res.nextCursor;
      } else {
        const proxima = (pageNumberRef.current ?? 1) + 1;
        const res = await svcListarNcms({
          limit: pageSize,
          prefix: onlyDigits(prefixo) || undefined,
          page: proxima,
        });
        setLinhas(res.items ?? []);
        pageNumberRef.current = res.page ?? proxima;
      }
      setCarregando(false);
      // não reconta a cada página (evita custo)
    } catch (err) {
      console.error(err);
      setCarregando(false);
      toast.error("Erro ao carregar próxima página.");
    }
  };

  const onApplyPrefixo = async () => {
    try {
      setCarregando(true);
      const res = await svcListarNcms({
        limit: pageSize,
        prefix: onlyDigits(prefixo) || undefined,
        page: 1,
      });
      setLinhas(res.items ?? []);
      nextCursorRef.current = res.nextCursor;
      pageNumberRef.current = res.page ?? 1;

      if (typeof res.total === "number") setTotal(res.total);

      setCarregando(false);

      // Conta em paralelo
      if (svcContarNcms) {
        try {
          const t = await svcContarNcms(prefixo ? onlyDigits(prefixo) : "");
          setTotal(t || 0);
        } catch (e) {
          console.warn("Falha ao contar ao aplicar prefixo:", e);
        }
      }
    } catch (err) {
      console.error(err);
      setCarregando(false);
      toast.error("Erro ao filtrar por prefixo.");
    }
  };

  return (
    <div className="p-6 flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Configurações</h1>

      {/* Upload de planilha de NCMs da CGIM */}
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
            onChange={onChangePrefixo}
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
            onClick={onApplyPrefixo}
            className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300"
            disabled={carregando}
          >
            Recarregar
          </button>

          <button
            onClick={proximaPagina}
            className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300"
            disabled={carregando}
          >
            Próxima página
          </button>

          <button
            onClick={() => {
              setPrefixo("");
              recarregar(true);
            }}
            className="px-3 py-2 rounded bg-gray-100 hover:bg-gray-200"
            disabled={carregando}
          >
            Limpar filtro
          </button>

          {carregando && <span className="text-sm text-gray-500">Carregando…</span>}
        </div>
        <div className="text-xs text-gray-500 mt-2">
          Exibindo <b>{qtdRender}</b> de <b>{linhas.length}</b> itens da página
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
            {linhasFiltradas.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-gray-500">
                  Nenhum item encontrado.
                </td>
              </tr>
            ) : (
              linhasFiltradas.map((l) => (
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
