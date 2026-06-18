export const norm = (s: string | null | undefined): string =>
  String(s ?? "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();

export const normKey = (s: string | null | undefined): string =>
  norm(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export const only8 = (s: string | null | undefined): string =>
  String(s ?? "").replace(/\D+/g, "").slice(0, 8);

export const onlyDigits = (s: string | null | undefined): string =>
  String(s ?? "").replace(/\D+/g, "");

export const toMillis = (t: unknown): number => {
  if (!t) return 0;
  if (typeof t === "number") return t;
  if (t instanceof Date) return t.getTime();
  if (typeof (t as any)?.toMillis === "function") return (t as any).toMillis();
  if (typeof (t as any)?.toDate === "function") return (t as any).toDate().getTime?.() || 0;
  if ((t as any)?.seconds) return (t as any).seconds * 1000 + ((t as any).nanoseconds || 0) / 1e6;
  return 0;
};

export const normalizeStatus = (s?: string): "concluido" | "em_analise" | "nao_iniciado" => {
  const v = (s || "").toLowerCase();
  if (/conclu[ií]d/.test(v)) return "concluido";
  if (/em[\s_ ]?an[aá]lis/.test(v)) return "em_analise";
  return "nao_iniciado";
};

export const formatNcm8 = (s: string | null | undefined): string => {
  const n8 = only8(s);
  return n8.length === 8
    ? `${n8.slice(0, 4)}.${n8.slice(4, 6)}.${n8.slice(6, 8)}`
    : String(s ?? "").trim() || "—";
};
