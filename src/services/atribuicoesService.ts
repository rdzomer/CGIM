// src/services/atribuicoesService.ts
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { norm, onlyDigits } from "../utils/stringUtils";

/** ---------------------------------------------
 * Helpers de normalização / ID seguro
 * -------------------------------------------*/
export function toBase64Url(str: string): string {
  const utf8 = encodeURIComponent(str).replace(
    /%([0-9A-F]{2})/g,
    (_, p1) => String.fromCharCode(parseInt(p1, 16))
  );
  const b64 = btoa(utf8);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
export function makeAtribuicaoId(pleitoKey: string): string {
  const id = toBase64Url(String(pleitoKey || "").trim());
  return id.length > 512 ? id.slice(0, 512) : id;
}

/** ---------------------------------------------
 * Chave do pleito (independente do nome exato das colunas)
 * Espera um objeto com chaves "NCM", "Produto" e "Pleiteante".
 * -------------------------------------------*/
export function gerarPleitoKey(row: Record<string, string | undefined>): string {
  const ncm = onlyDigits(row["NCM"]);
  const produto = norm(row["Produto"]);
  const pleiteante = norm(row["Pleiteante"]);
  return [ncm, produto, pleiteante].filter(Boolean).join("|");
}

/** ---------------------------------------------
 * Upsert da atribuição
 * Quando responsavelNome = "—" (ou vazio), limpa a atribuição.
 * -------------------------------------------*/
type UpsertPayload = {
  pleitoKey: string;
  responsavelNome?: string | null;
  responsavelUid?: string | null;
  responsavelEmail?: string | null;
  ncm?: string;
  produto?: string;
  pleiteante?: string;
  pautaId?: string;
  tituloSecao?: string;
  status?: string; // default: "novo"
};
export async function salvarAtribuicaoPleito(payload: UpsertPayload) {
  const db = getFirestore();
  const pleitoKey = String(payload.pleitoKey || "").trim();
  if (!pleitoKey) throw new Error("pleitoKey ausente.");

  const id = makeAtribuicaoId(pleitoKey);
  const ref = doc(db, "atribuicoes", id);

  const limpar =
    !payload.responsavelNome ||
    payload.responsavelNome === "—" ||
    !String(payload.responsavelNome).trim();

  const base = {
    pleitoKey,
    ncm: payload.ncm ?? null,
    produto: payload.produto ?? null,
    pleiteante: payload.pleiteante ?? null,
    pautaId: payload.pautaId ?? null,
    tituloSecao: payload.tituloSecao ?? null,
    updatedAt: serverTimestamp(),
  };

  if (limpar) {
    // Mantemos o doc, mas sem responsável
    await setDoc(
      ref,
      {
        ...base,
        responsavelNome: null,
        responsavelUid: null,
        responsavelEmail: null,
        status: payload.status ?? "novo",
        createdAt: serverTimestamp(), // inofensivo em merge
      },
      { merge: true }
    );
    return;
  }

  await setDoc(
    ref,
    {
      ...base,
      responsavelNome: payload.responsavelNome ?? null,
      responsavelUid: payload.responsavelUid ?? null,
      responsavelEmail: payload.responsavelEmail ?? null,
      status: payload.status ?? "novo",
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/** ---------------------------------------------
 * Lê várias atribuições por chave (retorna map pleitoKey->responsável)
 * -------------------------------------------*/
export async function carregarAtribuicoesPorChaves(keys: string[]) {
  const db = getFirestore();
  const out: Record<string, string> = {};

  // Firestore não tem "IN" com >10, então fazemos em loop
  await Promise.all(
    keys.map(async (key) => {
      try {
        const id = makeAtribuicaoId(key);
        const snap = await getDoc(doc(db, "atribuicoes", id));
        if (snap.exists()) {
          const v = snap.data() as any;
          const nome = v?.responsavelNome || "";
          if (nome) out[key] = String(nome);
        }
      } catch {
        /* ignore */
      }
    })
  );

  return out;
}

/** ---------------------------------------------
 * Carrega uma atribuição por ID (Base64URL da pleitoKey)
 * -------------------------------------------*/
export async function carregarAtribuicaoPorId(atrId: string) {
  const db = getFirestore();
  const ref = doc(db, "atribuicoes", atrId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as any) };
}

/** ---------------------------------------------
 * Salva/atualiza a análise do pleito
 * (grava em "analise", mantém updatedAt e opcionalmente altera status)
 * -------------------------------------------*/
export async function salvarAnalisePleito(atrId: string, analise: any, novoStatus?: string) {
  const db = getFirestore();
  const ref = doc(db, "atribuicoes", atrId);
  const data: any = {
    analise: analise ?? {},
    updatedAt: serverTimestamp(),
  };
  if (novoStatus) data.status = novoStatus;
  await updateDoc(ref, data);
}

/** ---------------------------------------------
 * Busca tarefas do usuário (por e-mail e por nome) e junta "meeting"
 * Retorna itens prontos para a lista Minhas Tarefas.
 * -------------------------------------------*/
type TarefaItem = {
  id: string;
  pleitoKey: string;
  pautaId?: string | null;
  tituloSecao?: string | null;
  ncm?: string | null;
  produto?: string | null;
  pleiteante?: string | null;
  status?: string | null;
  meeting?: string | null;
};
export async function buscarTarefasDoUsuario(
  nome: string,
  email?: string | null
): Promise<TarefaItem[]> {
  const db = getFirestore();
  const col = collection(db, "atribuicoes");

  const consultas: Promise<any>[] = [];
  if (email) {
    consultas.push(getDocs(query(col, where("responsavelEmail", "==", email))));
  }
  if (nome) {
    consultas.push(getDocs(query(col, where("responsavelNome", "==", nome))));
  }

  const snaps = await Promise.all(consultas);
  const items: TarefaItem[] = [];
  const seen = new Set<string>();
  const pautaIds = new Set<string>();

  for (const s of snaps) {
    s.forEach((docSnap: any) => {
      const d = docSnap.data();
      const id = docSnap.id as string;
      if (seen.has(id)) return;
      seen.add(id);

      const pautaId = d?.pautaId || null;
      if (pautaId) pautaIds.add(pautaId);

      items.push({
        id,
        pleitoKey: d?.pleitoKey || "",
        pautaId,
        tituloSecao: d?.tituloSecao || null,
        ncm: d?.ncm || null,
        produto: d?.produto || null,
        pleiteante: d?.pleiteante || null,
        status: d?.status || null,
        meeting: null, // será preenchido abaixo
      });
    });
  }

  // Enriquecer com meeting das pautas
  if (pautaIds.size > 0) {
    const cache: Record<string, string | null> = {};

    await Promise.all(
      Array.from(pautaIds).map(async (pid) => {
        try {
          const pSnap = await getDoc(doc(db, "pautas", pid));
        // compatível com seu schema: meeting fica na raiz do doc
          cache[pid] = pSnap.exists() ? (pSnap.data() as any)?.meeting ?? null : null;
        } catch {
          cache[pid] = null;
        }
      })
    );

    items.forEach((it) => {
      if (it.pautaId && cache[it.pautaId] !== undefined) {
        it.meeting = cache[it.pautaId]!;
      }
    });
  }

  // Ordena por reunião/ seção / produto pra exibição consistente
  items.sort((a, b) => {
    const ra = (a.meeting || "").localeCompare(b.meeting || "");
    if (ra !== 0) return ra;
    const sa = (a.tituloSecao || "").localeCompare(b.tituloSecao || "");
    if (sa !== 0) return sa;
    return (a.produto || "").localeCompare(b.produto || "");
  });

  return items;
}
