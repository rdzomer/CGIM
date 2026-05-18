// src/services/__tests__/comexstatService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buscarDadosComexstat } from "../comexstatService";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Row = {
  year: string;
  monthNumber: string;
  country: string;
  metricKG: string;
  metricFOB: string;
};

function row(year: number, month: number, kg: number, fob: number, country = "China"): Row {
  return {
    year: String(year),
    monthNumber: String(month).padStart(2, "0"),
    country,
    metricKG: String(kg),
    metricFOB: String(fob),
  };
}

/** Gera 12 linhas mensais para um ano completo (mesma origem). */
function fullYear(year: number, kgPerMonth: number, fobPerMonth: number, country = "China"): Row[] {
  return Array.from({ length: 12 }, (_, i) => row(year, i + 1, kgPerMonth, fobPerMonth, country));
}

/** Gera linhas mensais para jan..nMeses de um ano. */
function partialYear(year: number, nMeses: number, kgPerMonth: number, fobPerMonth: number, country = "China"): Row[] {
  return Array.from({ length: nMeses }, (_, i) => row(year, i + 1, kgPerMonth, fobPerMonth, country));
}

function mockFetch(lastYear: string, lastMonth: string, rows: Row[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (typeof url === "string" && url.includes("dates/updated")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: { year: lastYear, monthNumber: lastMonth } }),
        } as Response);
      }
      if (typeof url === "string" && url.includes("/general") && opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: { list: rows } }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response);
    }),
  );
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe("buscarDadosComexstat", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── Cenário 1: ano completo (lastMonth === 12) ─────────────────────────────
  it("ano fechado (lastMonth=12): monta ano_completo sem acumulado_parcial", async () => {
    // API diz: último dado disponível = dezembro/2025
    // Dados: 2025 completo (100 t/mês) e 2024 completo (50 t/mês)
    const rows = [
      ...fullYear(2021, 10_000, 5_000),
      ...fullYear(2022, 20_000, 10_000),
      ...fullYear(2023, 30_000, 15_000),
      ...fullYear(2024, 50_000, 25_000),
      ...fullYear(2025, 100_000, 50_000),
    ];
    mockFetch("2025", "12", rows);

    const dados = await buscarDadosComexstat("72083990");

    expect(dados.ano_completo.ano_ref).toBe(2025);
    expect(dados.ano_completo.ano_prev).toBe(2024);
    expect(dados.acumulado_parcial).toBeUndefined();
    expect(dados.atualizado_ate).toBe("dezembro de 2025");

    // Volume anual ref = 12 meses × 100_000 kg = 1_200_000 kg = 1,20 mil toneladas
    expect(dados.ano_completo.volume_ref_formatado).toContain("1,20 mil toneladas");
    // Var volume: (1200000 - 600000) / 600000 = +100%
    expect(dados.ano_completo.var_volume_pct_formatado).toBe("+100,00%");
  });

  // ── Cenário 2: ano aberto (lastMonth === 3) ────────────────────────────────
  it("ano aberto (lastMonth=3): monta acumulado_parcial para o ano em curso", async () => {
    // API diz: último dado = março/2026
    // Dados históricos: 2025 completo + jan-mar/2026 (parcial)
    const rows = [
      ...fullYear(2022, 10_000, 5_000),
      ...fullYear(2023, 20_000, 10_000),
      ...fullYear(2024, 30_000, 15_000),
      ...fullYear(2025, 60_000, 30_000),    // ano ref completo
      ...partialYear(2026, 3, 20_000, 10_000), // jan-mar/2026 parcial
    ];
    mockFetch("2026", "03", rows);

    const dados = await buscarDadosComexstat("72083990");

    expect(dados.ano_completo.ano_ref).toBe(2025);
    expect(dados.acumulado_parcial).toBeDefined();
    expect(dados.acumulado_parcial!.periodo_ref).toBe("janeiro a março de 2026");
    expect(dados.acumulado_parcial!.periodo_prev).toBe("janeiro a março de 2025");
    expect(dados.acumulado_parcial!.n_meses).toBe(3);

    // Volume anual ref = 12 × 60_000 = 720_000 kg
    expect(dados.ano_completo.volume_ref_formatado).toContain("0,72 mil toneladas");

    // Volume parcial 2026 = 3 × 20_000 = 60_000 kg
    expect(dados.acumulado_parcial!.volume_ref_formatado).toContain("0,06 mil toneladas");

    // Volume parcial prev (jan-mar/2025) = 3 × 60_000 = 180_000 kg
    expect(dados.acumulado_parcial!.volume_prev_formatado).toContain("0,18 mil toneladas");
  });

  // ── Cenário 3: tipos string da API não devem zerar dados (o bug corrigido) ─
  it("campos year/monthNumber como strings não zeram periodCurrC", async () => {
    // Garante que Number() é aplicado e === funciona corretamente
    const rows = [
      ...fullYear(2024, 40_000, 20_000),
      ...fullYear(2025, 80_000, 40_000),
      ...partialYear(2026, 3, 25_000, 12_500),
    ];
    // API retorna strings (comportamento real observado)
    mockFetch("2026", "03", rows);

    const dados = await buscarDadosComexstat("72083990");

    // Acumulado parcial 2026 deve ser não-zero
    expect(dados.acumulado_parcial).toBeDefined();
    const volRef = dados.acumulado_parcial!.volume_ref_formatado;
    expect(volRef).not.toBe("0,00 mil toneladas");
    // 3 × 25_000 = 75_000 kg
    expect(volRef).toContain("0,08 mil toneladas");
  });

  // ── Cenário 4: sanity — volumes anual ≠ parcial quando há dados nos dois ──
  it("volume anual de 2025 não deve ser igual ao parcial jan-mar/2025", async () => {
    const rows = [
      ...fullYear(2024, 10_000, 5_000),
      ...fullYear(2025, 10_000, 5_000),     // 12 meses → 120_000 kg total
      ...partialYear(2026, 3, 10_000, 5_000), // 3 meses → 30_000 kg
    ];
    mockFetch("2026", "03", rows);

    const dados = await buscarDadosComexstat("72083990");

    // jan-mar/2025 = 30_000 kg; ano cheio 2025 = 120_000 kg → diferentes
    expect(dados.ano_completo.volume_ref_formatado).not.toBe(
      dados.acumulado_parcial!.volume_prev_formatado,
    );
  });

  // ── Cenário 5: janela móvel presente quando há dados suficientes ──────────
  it("janela_12m é montada quando há pelo menos 24 meses de histórico", async () => {
    const rows = [
      ...fullYear(2022, 10_000, 5_000),
      ...fullYear(2023, 20_000, 10_000),
      ...fullYear(2024, 30_000, 15_000),
      ...fullYear(2025, 40_000, 20_000),
      ...partialYear(2026, 3, 15_000, 7_500),
    ];
    mockFetch("2026", "03", rows);

    const dados = await buscarDadosComexstat("72083990");

    expect(dados.janela_12m).toBeDefined();
    // W0 = jan/2025–mar/2026 (últimos 12 meses a partir de março/2026)
    expect(dados.janela_12m!.W0_label).toBe("abr/2025–mar/2026");
    expect(dados.janela_12m!.W1_label).toBe("abr/2024–mar/2025");
    expect(dados.janela_12m!.W0_volume_formatado).not.toBe("0,00 mil toneladas");
  });

  // ── Cenário 6: NCM inválido lança erro ────────────────────────────────────
  it("lança erro para NCM com menos de 8 dígitos", async () => {
    await expect(buscarDadosComexstat("1234")).rejects.toThrow("NCM inválido");
  });

  // ── Cenário 7: origens corretas no ano de referência ──────────────────────
  it("origens.ano_completo lista países ordenados por FOB", async () => {
    const rows = [
      ...fullYear(2024, 10_000, 5_000, "China"),
      // 2025: China 70%, Egito 30%
      ...fullYear(2025, 70_000, 35_000, "China"),
      ...fullYear(2025, 30_000, 15_000, "Egito"),
      ...partialYear(2026, 3, 10_000, 5_000, "China"),
    ];
    mockFetch("2026", "03", rows);

    const dados = await buscarDadosComexstat("72083990");

    expect(dados.origens.ano_completo[0].pais).toBe("China");
    expect(dados.origens.ano_completo[1].pais).toBe("Egito");
    // China deve ter ~70% do valor
    expect(dados.origens.ano_completo[0].pct_valor).toBe("70,00%");
  });
});
