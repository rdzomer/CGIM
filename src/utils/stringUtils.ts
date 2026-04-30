export const norm = (s: string | null | undefined): string =>
  String(s ?? "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();

export const normKey = (s: string | null | undefined): string =>
  norm(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export const only8 = (s: string | null | undefined): string =>
  String(s ?? "").replace(/\D+/g, "").slice(0, 8);
