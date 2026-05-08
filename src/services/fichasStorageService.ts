// src/services/fichasStorageService.ts
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { only8 } from "../utils/stringUtils";

// Extrai NCM de 8 dígitos do nome "Ficha_Individual_da_NCM_8111.0010.docx"
export function ncmFromFichaFilename(filename: string): string | null {
  const m = filename.match(/Ficha_Individual_da_NCM_([\d.]+)/i);
  if (!m) return null;
  const n8 = only8(m[1]);
  return n8.length === 8 ? n8 : null;
}

function fichaPath(pautaId: string, ncm8: string): string {
  return `pautas/${pautaId}/fichas/${ncm8}.docx`;
}

export type UploadResult = {
  filename: string;
  ncm: string | null;
  ok: boolean;
  erro?: string;
};

export async function uploadFichas(
  pautaId: string,
  files: File[],
): Promise<UploadResult[]> {
  const storage = getStorage();
  const results: UploadResult[] = [];

  for (const file of files) {
    const ncm8 = ncmFromFichaFilename(file.name);
    if (!ncm8) {
      results.push({ filename: file.name, ncm: null, ok: false, erro: "NCM não identificado no nome do arquivo" });
      continue;
    }
    try {
      const storageRef = ref(storage, fichaPath(pautaId, ncm8));
      await uploadBytes(storageRef, file, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      results.push({ filename: file.name, ncm: ncm8, ok: true });
    } catch (e: any) {
      results.push({ filename: file.name, ncm: ncm8, ok: false, erro: e?.message ?? "Erro no upload" });
    }
  }
  return results;
}

// Retorna URL de download ou null se não existir
export async function getFichaUrl(pautaId: string, ncm: string): Promise<string | null> {
  const ncm8 = only8(ncm);
  if (!pautaId || ncm8.length !== 8) return null;
  try {
    return await getDownloadURL(ref(getStorage(), fichaPath(pautaId, ncm8)));
  } catch {
    return null;
  }
}

// Baixa o arquivo .docx como ArrayBuffer
export async function getFichaArrayBuffer(pautaId: string, ncm: string): Promise<ArrayBuffer | null> {
  const url = await getFichaUrl(pautaId, ncm);
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.arrayBuffer();
  } catch {
    return null;
  }
}
