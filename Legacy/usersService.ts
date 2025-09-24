// usersService.ts
// Mapa oficial de e-mails dos analistas (pode crescer depois)
export const ANALISTAS_EMAIL_POR_NOME: Record<string, string> = {
  "Ricardo Zomer": "ricardo.zomer@mdic.gov.br",
  "Pedro Reckziegel": "pedro.reckziegel@mdic.gov.br",
  "Antônio Azambuja": "antonio.azambuja@mdic.gov.br",
  "Tólio Ribeiro": "tolio.ribeiro@mdic.gov.br",
};

export function normalizaEmail(s?: string | null) {
  return (s || "").trim().toLowerCase();
}

export function emailPorNome(nome: string): string | undefined {
  return ANALISTAS_EMAIL_POR_NOME[nome];
}
