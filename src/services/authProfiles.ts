// src/services/authProfiles.ts
// Mapeamento canônico de emails ↔ nomes + helpers.

export type KnownUser = {
  email: string;
  nome: string;
};

export const KNOWN_USERS: KnownUser[] = [
  { email: "tolio.riberio@mdic.gov.br",   nome: "Tólio Ribeiro" },
  { email: "ricardo.zomer@mdic.gov.br",   nome: "Ricardo Zomer" },
  { email: "pedro.reckziegel@mdic.gov.br",nome: "Pedro Reckziegel" },
  { email: "antonio.azambuja@mdic.gov.br",nome: "Antonio Azambuja" },
];

// Nomes que aparecem no dropdown da Pauta
export const ANALISTAS_PADRAO = KNOWN_USERS.map(u => u.nome);

const norm = (s: string) => (s || "").trim().toLowerCase();

export function emailPorNome(nome: string): string | null {
  const n = norm(nome);
  const hit = KNOWN_USERS.find(u => norm(u.nome) === n);
  return hit?.email ?? null;
}

export function nomePorEmail(email?: string | null): string | null {
  if (!email) return null;
  const e = norm(email);
  const hit = KNOWN_USERS.find(u => norm(u.email) === e);
  return hit?.nome ?? null;
}
