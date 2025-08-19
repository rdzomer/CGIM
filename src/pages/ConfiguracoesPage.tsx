// src/pages/ConfiguracoesPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

// ⚡️ Usaremos apenas consultas one-shot do Firestore (sem onSnapshot)
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  limit as qlimit,
  startAfter,
  getDocs,
  getCountFromServer,
  QueryDocumentSnapshot,
  DocumentData,
} from "firebase/firestore";

// Mantemos o import do seu service só para a importação da planilha
import * as ncmsService from "../services/ncmsService";

type NcmLinha = {
  ncm: string;
  setor?: string;
  produto?: string;
};

function onlyDigits(s?: string | null) {
  return (s || "").replace(/\D+/g, "");
}
function formatNcm(ncm?: string | null) {
  const d = onlyDigits(ncm);
  if (!d) return "";
  return [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8)].filter(Boolean).join(".");
}

// ======== apenas para upload (mantém seu fluxo existente) ========
const svcImportarPlanilha =
  // @ts-ignore
  (ncmsService.importarNcmsPlanilha as (file: File) => Promise<{
    inseridos?: number;
    atualizados?: number;
    totalLidas?: number;
  }>) ??
  // @ts-ignore
  (ncmsService.importarPlanilhaNcms as (file: File) => Promise<any>);

// ===================== Consulta direta ao Firestore =====================
const COL = "ncmsCGIM"; // conforme seu Firestore

type PageResult = {
  items: NcmLinha[];
  lastVisible?: QueryDocumentSnapshot<DocumentData>;
  page?: number;
  total?: number;
};

function makeBaseQuery(db: ReturnType<typeof getFirestore>, opts: { prefix?: string }) {
  const colRef = collection(db, COL);
  const constraints: any[] = [orderBy("ncm")];

  const prefix = onlyDigits(opts.prefix);
  if (prefix) {
    constraints.push(where("ncm", ">=", prefix));
    constraints.push(where("ncm", "<=", prefix + "\uf8ff"));
  }

  return { colRef, constraints };
}

async function listNcmsOnce(opts: {
  limit: number;
  prefix?: string;
  after?: QueryDocumentSnapshot<DocumentData>;
}): Promise<PageResult> {
  const db = getFirestore();
  const { colRef, constraints } = makeBaseQuery(db, { prefix: opts.prefix });

  const q = query(
    colRef,
    ...constraints,
    ...(opts.after ? [startAfter(opts.after)] : []),
    qlimit(Math.max(1, opts.limit))
  );

  const snap = await getDocs(q);
  const items: NcmLinha[] = snap.docs.map((d) => {
    const v: any = d.data() || {};
    return {
      ncm: String(v.ncm ?? d.id ?? ""),
      setor: v.setor || "",
      produto: v.produto || "",
    };
  });

  return {
    items,
    lastVisible: snap.docs[snap.docs.length - 1],
  };
}

async function countNcmsOnce(prefix?: string) {
  const db = getFirestore();
  const { colRef, constraints } = makeBaseQuery(db, { prefix });
  const q = query(colRef, ...constraints);
  const agg = await getCountFromServer(q);
  return Number(agg.data().count || 0);
}

// ============================== Página ==============================
const PAGE_SIZES = [25, 50, 100, 200];

const ConfiguracoesPage: React.FC = () => {
  const [prefixo, setPrefixo] = useState<string>("");
  const [pageSize, setPageSize] = useState<number>(50);
  const [linhas, setLinhas] = useState<NcmLinha[]>([]);
  const [carregando, setCarregando] = useState<boolean>(false);
  const [total, setTotal] = useState<number>(0);

  const lastVisibleRef = useRef<QueryDocumentSnapshot<DocumentData> | undefined>(undefined);
  const totalFmt = useMemo(() => new Intl.NumberFormat("pt-BR").format(total), [total]);

  // Carrega imediatamente a primeira página; conta em paralelo
  useEffect(() => {
    (async () => {
      try {
        setCarregando(true);

        const lista = await listNcmsOnce({
          limit: pageSize,
          prefix: prefixo,
        });
        setLinhas(lista.items);
        lastVisibleRef.current = lista.lastVisible;
        setCarregando(false);

        // contagem em paralelo (não bloqueia a UI)
        countNcmsOnce(prefixo)
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
      const res = await svcImportarPlanilha(file);
      const { inseridos, atualizados, totalLidas } = res || {};
      toast.success(
        `Planilha processada. Lidas: ${totalLidas ?? "?"} · Inseridos: ${inseridos ?? "?"} · Atualizados: ${atualizados ?? "?"}`
      );

      // Recarrega primeira página rápido
      const lista = await listNcmsOnce({ limit: pageSize, prefix: prefixo });
      setLinhas(lista.items);
      lastVisibleRef.current = lista.lastVisible;
      setCarregando(false);

      // Conta em paralelo
      countNcmsOnce(prefixo)
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
      const lista = await listNcmsOnce({ limit: pageSize, prefix: prefixo });
      setLinhas(lista.items);
      lastVisibleRef.current = lista.lastVisible;
      setCarregando(false);

      // Conta em paralelo
      countNcmsOnce(prefixo)
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
      if (!lastVisibleRef.current) return;
      setCarregando(true);
      const lista = await listNcmsOnce({
        limit: pageSize,
        prefix: prefixo,
        after: lastVisibleRef.current,
      });
      setLinhas(lista.items);
      lastVisibleRef.current = lista.lastVisible;
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
            disabled={carregando || !lastVisibleRef.current}
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

