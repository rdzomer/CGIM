// src/services/pautaVersioningCompat.ts
import { getFirestore, doc, getDoc, updateDoc } from "firebase/firestore";
import { gerarPleitoKey } from "./atribuicoesService";

// Tipos flexíveis para não quebrar com schemas variados
type PautaDoc = Record<string, any> & {
  id?: string;
  sections?: { title: string; rows?: any[] }[];
  secoes?: { title?: string; headers?: string[]; rows?: any[]; tabelas?: any[]; tables?: any[] }[];
};

type Row = Record<string, any>;

const norm = (s: any) => String(s ?? "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
const only8 = (s: any) => String(s ?? "").replace(/\D+/g, "").slice(0, 8);

function projectCore(row: Row) {
  const keys = Object.keys(row || {});
  const by = (labels: string[]) => {
    const hit =
      keys.find((k) => labels.some((l) => k.toLowerCase() === l.toLowerCase())) ??
      keys.find((k) => labels.some((l) => k.toLowerCase().includes(l.toLowerCase())));
    return hit ? String(row[hit] ?? "") : "";
  };

  const ncm = by(["NCM", "Código NCM", "Codigo NCM", "Código", "Codigo", "NCM 8"]);
  const produto = by(["Produto", "Descrição do Produto", "Descricao do Produto", "Descrição", "Descricao", "Mercadoria"]);
  const pleiteante = by(["Pleiteante", "Requerente", "Solicitante", "Interessado", "Empresa"]);
  return { ncm, produto, pleiteante };
}

function flattenRows(p: PautaDoc): Row[] {
  const out: Row[] = [];
  const secList =
    (Array.isArray(p?.sections) ? p.sections : undefined) ??
    (Array.isArray(p?.secoes) ? p.secoes : undefined) ??
    [];
  const pushRows = (rows?: any[]) => {
    if (!Array.isArray(rows)) return;
    for (const r of rows) out.push(r as Row);
  };
  for (const sec of secList as any[]) {
    pushRows(sec?.rows);
    if (Array.isArray(sec?.tabelas)) for (const tb of sec.tabelas) pushRows(tb?.rows);
    if (Array.isArray(sec?.tables)) for (const tb of sec.tables) pushRows(tb?.rows);
    if (Array.isArray(sec?.pleitos)) pushRows(sec?.pleitos);
  }
  if (Array.isArray((p as any)?.tabelas)) for (const tb of (p as any).tabelas) pushRows(tb?.rows);
  if (Array.isArray((p as any)?.pleitos)) pushRows((p as any)?.pleitos);
  return out;
}

function keyFromRow(row: Row) {
  try {
    const { ncm, produto, pleiteante } = projectCore(row);
    const key = gerarPleitoKey({
      NCM: only8(ncm),
      Produto: norm(produto),
      Pleiteante: norm(pleiteante),
    });
    return key;
  } catch {
    // fallback: concat NCM+Produto+Pleiteante
    const { ncm, produto, pleiteante } = projectCore(row);
    return [only8(ncm), norm(produto), norm(pleiteante)].filter(Boolean).join("|");
  }
}

function shallowComparableRow(row: Row): Row {
  const copy: Row = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (k === "statusVigencia") continue;
    if (k === "id" || k === "_id" || k === "key" || k.toLowerCase().includes("hash")) continue;
    copy[k] = v;
  }
  return copy;
}

export type DiffResumo = {
  contagens: { novos: number; alterados: number; removidos: number; mantidos: number };
  removidos: Row[];
  alterados: { key: string; base: Row; nova: Row }[];
  novos: Row[];
  mantidos: Row[];
};

type Options = { aplicarMarcacoes?: boolean };

export async function diffPautas(baseId: string, novaId: string, opt: Options = {}): Promise<DiffResumo> {
  const db = getFirestore();
  const baseSnap = await getDoc(doc(db, "pautas", baseId));
  const novaSnap = await getDoc(doc(db, "pautas", novaId));
  if (!baseSnap.exists() || !novaSnap.exists()) {
    throw new Error("Pautas não encontradas para diff.");
  }
  const base = baseSnap.data() as PautaDoc;
  const nova = novaSnap.data() as PautaDoc;

  const baseRows = flattenRows(base);
  const novaRows = flattenRows(nova);

  const baseMap = new Map<string, Row>();
  const novaMap = new Map<string, Row>();
  baseRows.forEach((r) => {
    const k = keyFromRow(r);
    if (k) baseMap.set(k, r);
  });
  novaRows.forEach((r) => {
    const k = keyFromRow(r);
    if (k) novaMap.set(k, r);
  });

  const removidos: Row[] = [];
  const novos: Row[] = [];
  const alterados: { key: string; base: Row; nova: Row }[] = [];
  const mantidos: Row[] = [];

  // comuns e removidos
  for (const [k, rBase] of baseMap) {
    const rNova = novaMap.get(k);
    if (!rNova) {
      removidos.push(rBase);
    } else {
      // compara conteúdo
      const a = JSON.stringify(shallowComparableRow(rBase));
      const b = JSON.stringify(shallowComparableRow(rNova));
      if (a !== b) {
        alterados.push({ key: k, base: rBase, nova: rNova });
      } else {
        mantidos.push(rNova);
      }
    }
  }
  // novos
  for (const [k, rNova] of novaMap) {
    if (!baseMap.has(k)) novos.push(rNova);
  }

  const contagens = {
    novos: novos.length,
    alterados: alterados.length,
    removidos: removidos.length,
    mantidos: mantidos.length,
  };

  if (opt.aplicarMarcacoes) {
    // marca status nos rows da NOVA pauta
    const secList =
      (Array.isArray(nova?.sections) ? nova.sections : undefined) ??
      (Array.isArray(nova?.secoes) ? nova.secoes : undefined) ??
      [];
    const hasSectionsEn = Array.isArray(nova?.sections);

    const markRow = (r: Row) => {
      const k = keyFromRow(r);
      if (!k) return r;
      if (baseMap.has(k)) {
        const rBase = baseMap.get(k)!;
        const a = JSON.stringify(shallowComparableRow(rBase));
        const b = JSON.stringify(shallowComparableRow(r));
        return { ...r, statusVigencia: a !== b ? "alterado" : "ativo" };
      } else {
        return { ...r, statusVigencia: "novo" };
      }
    };

    const markedSec = (secList as any[]).map((s) => {
      const clone = { ...s };
      if (Array.isArray(s?.rows)) clone.rows = s.rows.map(markRow);
      if (Array.isArray(s?.tabelas)) clone.tabelas = s.tabelas.map((tb: any) =>
        Array.isArray(tb?.rows) ? { ...tb, rows: tb.rows.map(markRow) } : tb
      );
      if (Array.isArray(s?.tables)) clone.tables = s.tables.map((tb: any) =>
        Array.isArray(tb?.rows) ? { ...tb, rows: tb.rows.map(markRow) } : tb
      );
      if (Array.isArray(s?.pleitos)) clone.pleitos = s.pleitos.map(markRow);
      return clone;
    });

    // Persiste no mesmo campo que já existe (sections ou secoes)
    if (hasSectionsEn) {
      await updateDoc(doc(db, "pautas", novaId), {
        sections: markedSec,
        diffResumo: { contagens, baseId },
        removidos: removidos.map((r) => {
          const { ncm, produto, pleiteante } = projectCore(r);
          return { NCM: only8(ncm), Produto: norm(produto), Pleiteante: norm(pleiteante) };
        }),
      });
    } else {
      await updateDoc(doc(db, "pautas", novaId), {
        secoes: markedSec,
        diffResumo: { contagens, baseId },
        removidos: removidos.map((r) => {
          const { ncm, produto, pleiteante } = projectCore(r);
          return { NCM: only8(ncm), Produto: norm(produto), Pleiteante: norm(pleiteante) };
        }),
      });
    }
  }

  return { contagens, removidos, alterados, novos, mantidos };
}
