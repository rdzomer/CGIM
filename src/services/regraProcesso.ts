// src/services/regraProcesso.ts
export type Linha = Record<string, string>;
export type Secao = { titulo: string; rows: Linha[] };

/** Exemplo: normaliza NCM e, se não há 'tipoPleito' mas o título contém 'renova', preenche 'Renovação' */
export function aplicarRegrasPosImport(secoes: Secao[]): Secao[] {
  return secoes.map((s) => {
    const tituloLower = s.titulo.toLowerCase();

    const rows = s.rows.map((r) => {
      const out: Linha = { ...r };

      // Normaliza NCM: 8 dígitos -> XXXX.XX.XX
      if (out.ncm) {
        const digits = out.ncm.replace(/\D/g, "");
        if (digits.length >= 4) {
          const pad = digits.slice(0, 8).padEnd(8, "0");
          out.ncm = `${pad.slice(0, 4)}.${pad.slice(4, 6)}.${pad.slice(6, 8)}`;
        }
      }

      // Exemplo de inferência de tipo de pleito pela seção
      if (!out.tipoPleito) {
        if (/\brenova/.test(tituloLower)) out.tipoPleito = "Renovação";
        if (/\binclus/.test(tituloLower)) out.tipoPleito = "Inclusão";
      }

      return out;
    });

    return { ...s, rows };
  });
}
