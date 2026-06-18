// src/services/comexstatService.ts
import { only8 } from "../utils/stringUtils";

// Em desenvolvimento usa proxy local (evita CORS); em produção chama direto
const BASE = import.meta.env.DEV
  ? "/comexstat-api"
  : "https://api-comexstat.mdic.gov.br";

const MESES_PT = [
  "janeiro","fevereiro","março","abril","maio","junho",
  "julho","agosto","setembro","outubro","novembro","dezembro",
];
const MESES_CURTO = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

// ─── Formatação final (pt-BR, 2 casas decimais) ───────────────────────────────
// Todos os campos formatados são produzidos aqui — o Gemini NÃO calcula nada.

function fmtVol(kg: number): string {
  // ex.: 6748626 → "6,75 mil toneladas"
  return (kg / 1_000_000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " mil toneladas";
}

function fmtUSD(usd: number): string {
  // ex.: 12049641 → "US$ 12,05 milhões"
  return "US$ " + (usd / 1_000_000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " milhões";
}

function fmtPreco(kg: number, usd: number): string {
  // ex.: (6748626, 12049641) → "US$ 1.785,50/t"
  if (!kg || !usd) return "—";
  const p = (usd / kg) * 1_000;
  return "US$ " + p.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "/t";
}

function fmtPct(a: number, b: number): string {
  // ex.: (-13.37) → "-13,37%"  |  (+32.85) → "+32,85%"
  if (!b) return "—";
  const v = ((a - b) / b) * 100;
  const s = Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v >= 0 ? "+" : "-") + s + "%";
}

function fmtPctPreco(kgA: number, fobA: number, kgB: number, fobB: number): string {
  const pA = kgA ? fobA / kgA : 0;
  const pB = kgB ? fobB / kgB : 0;
  return fmtPct(pA, pB);
}

// ─── Tipo exportado ────────────────────────────────────────────────────────────

export type OrigemEntry = {
  pais: string;
  valor_formatado: string;
  pct_valor: string;
  pct_peso: string;
};

export type DadosComexstat = {
  ncm: string;
  atualizado_ate: string;            // ex.: "março de 2026"
  ano_completo: {
    ano_ref: number;                 // ex.: 2025
    ano_prev: number;               // ex.: 2024
    volume_ref_formatado: string;   // ex.: "6,75 mil toneladas"
    valor_ref_formatado: string;    // ex.: "US$ 12,05 milhões"
    preco_ref_formatado: string;    // ex.: "US$ 1.785,50/t"
    volume_prev_formatado: string;
    valor_prev_formatado: string;
    preco_prev_formatado: string;
    var_volume_pct_formatado: string; // ex.: "-13,37%"
    var_valor_pct_formatado: string;
    var_preco_pct_formatado: string;
  };
  acumulado_parcial?: {
    periodo_ref: string;   // ex.: "janeiro a março de 2026"
    periodo_prev: string;  // ex.: "janeiro a março de 2025"
    n_meses: number;
    volume_ref_formatado: string;
    valor_ref_formatado: string;
    preco_ref_formatado: string;
    volume_prev_formatado: string;
    valor_prev_formatado: string;
    preco_prev_formatado: string;
    var_volume_pct_formatado: string;
    var_valor_pct_formatado: string;
    var_preco_pct_formatado: string;
  };
  janela_12m?: {
    W0_label: string;              // ex.: "abr/2025–mar/2026"
    W1_label: string;              // ex.: "abr/2024–mar/2025"
    W0_volume_formatado: string;   // ex.: "8,55 mil toneladas"
    W1_volume_formatado: string;   // ex.: "6,43 mil toneladas"
    W0_vs_W1_pct_formatado: string; // ex.: "+32,85%"
    media_3_label?: string;        // ex.: "W1+W2+W3"
    W0_vs_media_3_pct_formatado?: string;
    media_4_label?: string;        // ex.: "W1+W2+W3+W4"
    W0_vs_media_4_pct_formatado?: string;
  };
  origens: {
    ano_completo: OrigemEntry[];
    acumulado_parcial?: OrigemEntry[];
  };
};

// ─── Helpers internos ─────────────────────────────────────────────────────────



function rollingSum(arr: number[], window: number): number[] {
  return arr.map((_, i) => {
    const start = Math.max(0, i - window + 1);
    return arr.slice(start, i + 1).reduce((s, v) => s + v, 0);
  });
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const m0 = (year - 1) * 12 + (month - 1) + delta;
  return { year: Math.floor(m0 / 12) + 1, month: (m0 % 12) + 1 };
}

function mesMMMYY(year: number, month: number): string {
  return `${MESES_CURTO[month - 1]}/${year}`;
}

const delay = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

async function comexGet(path: string): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BASE}${path}`);
    if (res.status === 429 && attempt < 2) { await delay(12000); continue; }
    if (!res.ok) throw new Error(`ComexStat ${res.status}: ${path}`);
    return res.json();
  }
}

async function comexPost(body: object): Promise<any[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${BASE}/general`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      if (attempt === 0) { await delay(15000); continue; }
      throw new Error(
        "A API ComexStat está aplicando rate limit. Aguarde cerca de 1 minuto e tente novamente.",
      );
    }
    if (!res.ok) throw new Error(`ComexStat HTTP ${res.status}`);
    return (await res.json())?.data?.list ?? [];
  }
  return [];
}

// ─── Função principal ─────────────────────────────────────────────────────────

export async function buscarDadosComexstat(ncm: string): Promise<DadosComexstat> {
  const ncm8 = only8(ncm);
  if (ncm8.length !== 8) throw new Error("NCM inválido — esperado 8 dígitos.");

  // 1 GET + 1 POST — evita rate limiting
  const updJson = await comexGet("/general/dates/updated");
  const lastYear: number  = Number(updJson?.data?.year        ?? new Date().getFullYear());
  const lastMonth: number = Number(updJson?.data?.monthNumber ?? (new Date().getMonth() + 1));
  const lastMonthName = MESES_PT[(lastMonth - 1) % 12];

  // annualRef = último ano COMPLETO disponível na base
  // lastMonth < 12 → ano lastYear ainda não fechou → usar lastYear - 1
  // lastMonth === 12 → ano lastYear está completo → usar lastYear
  const annualRef  = lastMonth === 12 ? lastYear : lastYear - 1;
  const annualPrev = annualRef - 1;

  // Acumulado parcial só existe quando há meses do ano mais recente ainda não encerrado
  const showAccumulated = lastMonth !== 12;

  // Single query: January of (lastYear-4) through last available month.
  // Period is fully dynamic — derived from the API's own reported dates.
  const fromYear = lastYear - 4;
  const monthPad = String(lastMonth).padStart(2, "0");

  const rows = await comexPost({
    flow: "import",
    monthDetail: true,
    period: { from: `${fromYear}-01`, to: `${lastYear}-${monthPad}` },
    filters: [{ filter: "ncm", values: [ncm8] }],
    details: ["country"],
    metrics: ["metricFOB", "metricKG"],
  });


  type V = { fob: number; kg: number };

  const annualRefC:  Record<string, V> = {};
  const annualPrevC: Record<string, V> = {};
  const periodCurrC: Record<string, V> = {};
  const periodPrevC: Record<string, V> = {};
  const kgByYM:      Record<string, number> = {};

  for (const r of rows) {
    const y    = Number(r.year);
    // API may use "monthNumber" or "month" depending on the endpoint version
    const m    = Number(r.monthNumber ?? r.month ?? r.coMonth ?? 0);
    const pais = String(r.country || r.noCountry || "Outros").trim();
    const fob  = Number(r.metricFOB) || 0;
    const kg   = Number(r.metricKG)  || 0;

    if (!y || !m) continue; // skip malformed rows

    kgByYM[`${y}-${String(m).padStart(2, "0")}`] = (kgByYM[`${y}-${String(m).padStart(2, "0")}`] ?? 0) + kg;

    const add = (agg: Record<string, V>) => {
      if (!agg[pais]) agg[pais] = { fob: 0, kg: 0 };
      agg[pais].fob += fob;
      agg[pais].kg  += kg;
    };

    if (y === annualRef)                                          add(annualRefC);
    if (y === annualPrev)                                         add(annualPrevC);
    if (showAccumulated && y === lastYear     && m <= lastMonth)  add(periodCurrC);
    if (showAccumulated && y === lastYear - 1 && m <= lastMonth)  add(periodPrevC);
  }

  const sumV = (c: Record<string, V>): V =>
    Object.values(c).reduce((a, v) => ({ fob: a.fob + v.fob, kg: a.kg + v.kg }), { fob: 0, kg: 0 });

  const ref = sumV(annualRefC);
  const prv = sumV(annualPrevC);
  const pc  = sumV(periodCurrC);
  const pp  = sumV(periodPrevC);

  // ── Origens ──────────────────────────────────────────────────────────────────
  const rankC = (agg: Record<string, V>, topN = 12): OrigemEntry[] => {
    const tot = sumV(agg);
    return Object.entries(agg)
      .sort((a, b) => b[1].fob - a[1].fob)
      .slice(0, topN)
      .map(([pais, v]) => ({
        pais,
        valor_formatado: fmtUSD(v.fob),
        pct_valor: (tot.fob ? (v.fob / tot.fob) * 100 : 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%",
        pct_peso:  (tot.kg  ? (v.kg  / tot.kg)  * 100 : 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%",
      }));
  };

  // ── Série mensal + janelas móveis ─────────────────────────────────────────────
  const mensalC: Array<{ year: number; month: number; kg: number }> = [];
  {
    let cy = lastYear - 4, cm = 1;
    while (cy < lastYear || (cy === lastYear && cm <= lastMonth)) {
      mensalC.push({ year: cy, month: cm, kg: kgByYM[`${cy}-${String(cm).padStart(2, "0")}`] ?? 0 });
      if (++cm > 12) { cm = 1; cy++; }
    }
  }

  const mm12 = rollingSum(mensalC.map(m => m.kg), 12);
  const n    = mensalC.length;

  const janelas: Array<{ label: string; kg: number }> = [];
  for (let w = 0; w < 6; w++) {
    const ei = n - 1 - w * 12;
    if (ei < 11) break;
    const em = mensalC[ei];
    const sm = shiftMonth(em.year, em.month, -11);
    janelas.push({ label: `${mesMMMYY(sm.year, sm.month)}–${mesMMMYY(em.year, em.month)}`, kg: mm12[ei] });
  }

  // ── Montar objeto estruturado (todos os valores já formatados) ────────────────

  const periodoRefLabel  = lastMonth === 1 ? "janeiro de " : `janeiro a ${lastMonthName} de `;
  const periodo_ref  = periodoRefLabel + lastYear;
  const periodo_prev = periodoRefLabel + (lastYear - 1);

  const dados: DadosComexstat = {
    ncm: ncm8,
    atualizado_ate: `${lastMonthName} de ${lastYear}`,
    ano_completo: {
      ano_ref:  annualRef,
      ano_prev: annualPrev,
      volume_ref_formatado:  fmtVol(ref.kg),
      valor_ref_formatado:   fmtUSD(ref.fob),
      preco_ref_formatado:   fmtPreco(ref.kg, ref.fob),
      volume_prev_formatado: fmtVol(prv.kg),
      valor_prev_formatado:  fmtUSD(prv.fob),
      preco_prev_formatado:  fmtPreco(prv.kg, prv.fob),
      var_volume_pct_formatado: fmtPct(ref.kg,  prv.kg),
      var_valor_pct_formatado:  fmtPct(ref.fob, prv.fob),
      var_preco_pct_formatado:  fmtPctPreco(ref.kg, ref.fob, prv.kg, prv.fob),
    },
    origens: {
      ano_completo: rankC(annualRefC),
      ...(showAccumulated && Object.keys(periodCurrC).length > 0
        ? { acumulado_parcial: rankC(periodCurrC) }
        : {}),
    },
  };

  if (showAccumulated) {
    dados.acumulado_parcial = {
      periodo_ref,
      periodo_prev,
      n_meses: lastMonth,
      volume_ref_formatado:  fmtVol(pc.kg),
      valor_ref_formatado:   fmtUSD(pc.fob),
      preco_ref_formatado:   fmtPreco(pc.kg, pc.fob),
      volume_prev_formatado: fmtVol(pp.kg),
      valor_prev_formatado:  fmtUSD(pp.fob),
      preco_prev_formatado:  fmtPreco(pp.kg, pp.fob),
      var_volume_pct_formatado: fmtPct(pc.kg,  pp.kg),
      var_valor_pct_formatado:  fmtPct(pc.fob, pp.fob),
      var_preco_pct_formatado:  fmtPctPreco(pc.kg, pc.fob, pp.kg, pp.fob),
    };
  }

  if (janelas.length >= 2) {
    const j12: DadosComexstat["janela_12m"] = {
      W0_label: janelas[0].label,
      W1_label: janelas[1].label,
      W0_volume_formatado: fmtVol(janelas[0].kg),
      W1_volume_formatado: fmtVol(janelas[1].kg),
      W0_vs_W1_pct_formatado: fmtPct(janelas[0].kg, janelas[1].kg),
    };
    if (janelas.length >= 4) {
      const avg3 = janelas.slice(1, 4).reduce((s, j) => s + j.kg, 0) / 3;
      j12.media_3_label = "W1+W2+W3";
      j12.W0_vs_media_3_pct_formatado = fmtPct(janelas[0].kg, avg3);
    }
    if (janelas.length >= 5) {
      const avg4 = janelas.slice(1, 5).reduce((s, j) => s + j.kg, 0) / 4;
      j12.media_4_label = "W1+W2+W3+W4";
      j12.W0_vs_media_4_pct_formatado = fmtPct(janelas[0].kg, avg4);
    }
    dados.janela_12m = j12;
  }

  return dados;
}
