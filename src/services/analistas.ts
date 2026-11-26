// src/services/analistas.ts
// Lista única dos analistas que recebem pleitos na Pauta CAT
// e o reconhecimento de nomes/e-mails gravados com grafias diferentes.

export const ANALISTAS = [
  "Ricardo Zomer",
  "Pedro Reckziegel",
  "Antônio Azambuja",
  "Tólio Ribeiro",
] as const;

const fold = (s?: string | null) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9@._\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "ricardo.zomer@mdic.gov.br" -> ["ricardo","zomer"]; "Ricardo D. Zomer" -> ["ricardo","d","zomer"] */
function tokens(s?: string | null): string[] {
  const f = fold(s);
  const local = f.includes("@") ? f.split("@")[0] : f;
  return local.split(/[\s._\-]+/).filter(Boolean);
}

/**
 * Devolve o nome canônico da lista ANALISTAS que corresponde a algum dos
 * candidatos (nome, nome de exibição ou e-mail), ou "" se nenhum corresponder.
 * Casa por nome idêntico (sem acentos/caixa) ou por primeiro + último nome.
 */
export function resolverAnalista(...candidatos: Array<string | null | undefined>): string {
  for (const c of candidatos) {
    const t = tokens(c);
    if (!t.length) continue;
    for (const a of ANALISTAS) {
      const ta = tokens(a);
      if (t.join(" ") === ta.join(" ")) return a;
      if (t.length >= 2 && t[0] === ta[0] && t[t.length - 1] === ta[ta.length - 1]) return a;
    }
  }
  return "";
}

/** Nome do responsável de um doc de atribuição (com tolerância a dados antigos). */
export function responsavelDaAtribuicao(v: any): string {
  if (!v) return "";
  // null = atribuição removida explicitamente na Pauta CAT ("—")
  if (v.responsavelNome === null) return "";
  const canon = resolverAnalista(
    v.responsavelNome,
    v.responsavelEmail,
    v.analistaNome,
    v.analistaEmail
  );
  return canon || String(v.responsavelNome || "").trim();
}
