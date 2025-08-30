// src/services/retificacaoHistoricoSync.ts
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { upsertHistoricoFromAtribuicao } from "./historicoAnalisesService";

type AnyRow = Record<string, any>;
type Atrib = {
  id: string;
  status?: string;
  updatedAt?: any;
  analise?: { resumo?: string; comercio?: string; tecnica?: string; sugestao?: string } | null;
  pautaId?: string;
  pleitoKey?: string;
  ncm?: string;
  produto?: string;
  pleiteante?: string;
};

const norm = (s?: string) => (s ?? "").toString().replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
const normKey = (s?: string) => norm(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const only8 = (s?: string) => (s ?? "").replace(/\D+/g, "").slice(0, 8);

const toMillis = (t: any): number => {
  if (!t) return 0;
  if (typeof t === "number") return t;
  if (t instanceof Date) return t.getTime();
  if (typeof t?.toMillis === "function") return t.toMillis();
  return 0;
};

function pickKey(row: AnyRow, candidates: string[]): string | undefined {
  const keys = Object.keys(row || {});
  for (const cand of candidates) {
    const k = keys.find((kk) => normKey(kk) === normKey(cand));
    if (k) return k;
  }
  for (const kk of keys) {
    const nk = normKey(kk);
    if (candidates.some((c) => nk.includes(normKey(c)))) return kk;
  }
  return undefined;
}

function tryMakeKeyFromRow(row: AnyRow): string {
  const kNcm = pickKey(row, ["NCM", "Código NCM", "Codigo NCM", "Código", "Codigo", "NCM 8"]);
  const kProd = pickKey(row, ["Produto","Descrição do Produto","Descricao do Produto","Produto/Descrição","Descrição","Descricao"]);
  const kPlt  = pickKey(row, ["Pleiteante","Empresa","Requerente","Solicitante"]);
  const n8 = only8(kNcm ? String(row[kNcm] ?? "") : "");
  const produto = kProd ? String(row[kProd] ?? "") : "";
  const pleiteante = kPlt ? String(row[kPlt] ?? "") : "";
  return `${n8}|${normKey(produto)}|${normKey(pleiteante)}`;
}

function hasContent(a?: Atrib | null) {
  if (!a) return false;
  const an = a.analise || {};
  return Boolean(norm(an.resumo) || norm(an.comercio) || norm(an.tecnica) || norm(an.sugestao));
}

function normalizeStatus(s?: string) {
  const v = (s || "").toLowerCase();
  if (/conclu[ií]d/.test(v)) return "concluido";
  if (/em[\s_ ]?an[aá]lis/.test(v)) return "em_analise";
  return "nao_iniciado";
}

function rankAtrib(a: Atrib) {
  const st = normalizeStatus(a.status);
  if (st === "concluido" && hasContent(a)) return 3;
  if (hasContent(a)) return 2;
  return 1;
}

/** Busca a “melhor” atribuição para um pleitoKey: concluída com conteúdo > não concluída com conteúdo > mais recente. */
async function bestAtribForPleitoKey(db: any, pleitoKey: string): Promise<Atrib | null> {
  const snap = await getDocs(query(collection(db, "atribuicoes"), where("pleitoKey", "==", pleitoKey)));
  const arr: Atrib[] = [];
  snap.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
  if (!arr.length) return null;
  arr.sort((a, b) => {
    const r = rankAtrib(b) - rankAtrib(a);
    if (r !== 0) return r;
    return toMillis(b.updatedAt) - toMillis(a.updatedAt);
  });
  return arr[0] || null;
}

/** Sincroniza `analisesHistoricas` a partir dos `removidos` de uma pauta retificadora (idempotente). */
export async function syncHistoricoFromRetificadora(retifPautaId: string, db = getFirestore()) {
  const pRef = doc(db, "pautas", retifPautaId);
  const pSnap = await getDoc(pRef);
  if (!pSnap.exists()) throw new Error("Pauta retificadora não encontrada.");

  const p = pSnap.data() as any;
  const removidos: any[] = Array.isArray(p?.removidos) ? p.removidos : [];
  if (!removidos.length) return { processed: 0 };

  let processed = 0;
  for (const r of removidos) {
    const pleitoKey: string =
      String((r as any)?.pleitoKey || "").trim() || tryMakeKeyFromRow(r as AnyRow);
    if (!pleitoKey) continue;

    const best = await bestAtribForPleitoKey(db, pleitoKey);
    if (!best || !hasContent(best)) {
      // sem conteúdo útil → ainda assim podemos garantir a criação do canônico vazio? aqui preferimos pular.
      continue;
    }
    await upsertHistoricoFromAtribuicao(db, best);
    processed++;
  }
  return { processed };
}
