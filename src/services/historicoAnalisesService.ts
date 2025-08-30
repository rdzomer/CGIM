// src/services/historicoAnalisesService.ts
import { getFirestore, doc, getDoc, setDoc, collection, addDoc, serverTimestamp } from "firebase/firestore";

export type HistoricoAnaliseDoc = {
  pleitoKey: string;
  ncm8?: string;
  produtoNorm?: string;
  pleiteanteNorm?: string;

  ultimaTecnica?: string;
  ultimaSugestao?: string;
  ultimoResumo?: string;
  ultimoComercio?: string;

  ultimaAtualizacao?: any; // Timestamp
  sourceAtribuicaoId?: string;
  sourcePautaId?: string;
};

type AtribuicaoLike = {
  id?: string;
  pautaId?: string;
  pleitoKey?: string;
  ncm?: string;
  produto?: string;
  pleiteante?: string;
  analise?: { tecnica?: string; sugestao?: string; resumo?: string; comercio?: string } | null;
  updatedAt?: any;
};

const norm = (s?: string) =>
  (s ?? "").toString().replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
const normKey = (s?: string) => norm(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const only8 = (s?: string) => (s ?? "").replace(/\D+/g, "").slice(0, 8);
const toMillis = (t: any): number => (typeof t?.toMillis === "function" ? t.toMillis() : (t instanceof Date ? t.getTime() : (typeof t === "number" ? t : 0)));

export function toHistoricoFromAtrib(a: AtribuicaoLike): HistoricoAnaliseDoc | null {
  const k = norm(a.pleitoKey || "");
  if (!k) return null;
  const tec = norm(a.analise?.tecnica);
  const sug = norm(a.analise?.sugestao);
  const res = norm(a.analise?.resumo);
  const com = norm(a.analise?.comercio);
  if (!(tec || sug || res || com)) return null;

  return {
    pleitoKey: k,
    ncm8: only8(a.ncm),
    produtoNorm: normKey(a.produto),
    pleiteanteNorm: normKey(a.pleiteante),
    ultimaTecnica: tec || undefined,
    ultimaSugestao: sug || undefined,
    ultimoResumo: res || undefined,
    ultimoComercio: com || undefined,
    ultimaAtualizacao: a.updatedAt || new Date(),
    sourceAtribuicaoId: a.id,
    sourcePautaId: a.pautaId,
  };
}

/** Upsert no doc principal + cria uma versão em /versoes */
export async function upsertHistoricoFromAtribuicao(db = getFirestore(), atrib: AtribuicaoLike): Promise<void> {
  const snap = toHistoricoFromAtrib(atrib);
  if (!snap) return;

  const ref = doc(db, "analisesHistoricas", snap.pleitoKey);
  const cur = await getDoc(ref);

  const curMillis = toMillis(cur.data()?.ultimaAtualizacao);
  const newMillis = toMillis(snap.ultimaAtualizacao);

  // Atualiza somente se for mais novo ou se não existir
  if (!cur.exists() || newMillis >= curMillis) {
    await setDoc(ref, {
      ...cur.data(),
      ...snap,
      ultimaAtualizacao: snap.ultimaAtualizacao || serverTimestamp(),
    });

    // salva versão (append-only)
    await addDoc(collection(ref, "versoes"), {
      ...snap,
      createdAt: serverTimestamp(),
    });
  }
}

/** Busca o snapshot canônico; retorna null se não existir */
export async function getHistoricoByPleitoKey(db = getFirestore(), pleitoKey: string): Promise<HistoricoAnaliseDoc | null> {
  const k = norm(pleitoKey || "");
  if (!k) return null;
  const ref = doc(db, "analisesHistoricas", k);
  const snap = await getDoc(ref);
  return snap.exists() ? ({ id: ref.id, ...(snap.data() as any) } as any) : null;
}
