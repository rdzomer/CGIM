// src/services/comexstatService.ts
import { only8 } from "../utils/stringUtils";

const BASE = "https://api-comexstat.mdic.gov.br";

const MESES_PT = [
  "janeiro","fevereiro","março","abril","maio","junho",
  "julho","agosto","setembro","outubro","novembro","dezembro",
];

function pct(a: number, b: number): string {
  if (!b) return "—";
  const v = ((a - b) / b) * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function toMilT(kg: number): string {
  return (kg / 1_000_000).toFixed(3) + " mil t";
}

function toMilUSD(usd: number): string {
  return "US$ " + (usd / 1_000_000).toFixed(2) + " milhões";
}

function precoMedio(kg: number, usd: number): string {
  if (!kg || !usd) return "—";
  return "US$ " + Math.round((usd / kg) * 1000).toLocaleString("pt-BR") + "/t";
}

function pctPreco(kgA: number, fobA: number, kgB: number, fobB: number): string {
  const pA = kgA ? fobA / kgA : 0;
  const pB = kgB ? fobB / kgB : 0;
  return pct(pA, pB);
}

async function comexGet(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`ComexStat ${res.status}: ${path}`);
  return res.json();
}

async function comexPost(body: object): Promise<any[]> {
  const res = await fetch(`${BASE}/general`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ComexStat HTTP ${res.status}`);
  return (await res.json())?.data?.list ?? [];
}

function sumRows(rows: any[]): { fob: number; kg: number } {
  return rows.reduce(
    (acc, r) => ({ fob: acc.fob + (Number(r.metricFOB) || 0), kg: acc.kg + (Number(r.metricKG) || 0) }),
    { fob: 0, kg: 0 },
  );
}

function topCountries(rows: any[], topN = 6): { pais: string; pctFob: number; pctKg: number; fob: number; kg: number }[] {
  const agg: Record<string, { fob: number; kg: number }> = {};
  for (const r of rows) {
    const c = String(r.country || r.noCountry || "Outros").trim();
    if (!agg[c]) agg[c] = { fob: 0, kg: 0 };
    agg[c].fob += Number(r.metricFOB) || 0;
    agg[c].kg += Number(r.metricKG) || 0;
  }
  const totalFob = Object.values(agg).reduce((s, v) => s + v.fob, 0);
  const totalKg = Object.values(agg).reduce((s, v) => s + v.kg, 0);
  return Object.entries(agg)
    .sort((a, b) => b[1].fob - a[1].fob)
    .slice(0, topN)
    .map(([pais, v]) => ({
      pais,
      fob: v.fob,
      kg: v.kg,
      pctFob: totalFob ? (v.fob / totalFob) * 100 : 0,
      pctKg: totalKg ? (v.kg / totalKg) * 100 : 0,
    }));
}

function rollingSum(arr: number[], window: number): number[] {
  return arr.map((_, i) => {
    const start = Math.max(0, i - window + 1);
    return arr.slice(start, i + 1).reduce((s, v) => s + v, 0);
  });
}

export async function buscarDadosComexstat(ncm: string): Promise<string> {
  const ncm8 = only8(ncm);
  if (ncm8.length !== 8) throw new Error("NCM inválido — esperado 8 dígitos.");

  // 1. Data de atualização
  const updJson = await comexGet("/general/dates/updated");
  const lastYear: number = updJson?.data?.year ?? new Date().getFullYear();
  const lastMonth: number = updJson?.data?.monthNumber ?? new Date().getMonth();
  const lastMonthName = MESES_PT[(lastMonth - 1) % 12];

  const currentYear = new Date().getFullYear();
  const annualRef = currentYear - 1;   // último ano completo
  const annualPrev = currentYear - 2;  // ano de comparação
  const periodLabel = lastMonth === 1 ? "janeiro" : `janeiro a ${lastMonthName}`;
  const monthPad = String(lastMonth).padStart(2, "0");

  const filter = [{ filter: "ncm", values: [ncm8] }];

  // 2–6: chamadas em paralelo para reduzir latência
  const [
    annualRows,
    periodCurrRows,
    periodPrevRows,
    countryAnnualRows,
    countryPeriodRows,
    monthlyRows,
  ] = await Promise.all([
    // Totais anuais (2 anos)
    comexPost({
      flow: "import", monthDetail: false,
      period: { from: `${annualPrev}-01`, to: `${annualRef}-12` },
      filters: filter, details: [], metrics: ["metricFOB", "metricKG"],
    }),
    // Acumulado ano corrente
    comexPost({
      flow: "import", monthDetail: false,
      period: { from: `${currentYear}-01`, to: `${currentYear}-${monthPad}` },
      filters: filter, details: [], metrics: ["metricFOB", "metricKG"],
    }),
    // Acumulado mesmo período do ano anterior
    comexPost({
      flow: "import", monthDetail: false,
      period: { from: `${currentYear - 1}-01`, to: `${currentYear - 1}-${monthPad}` },
      filters: filter, details: [], metrics: ["metricFOB", "metricKG"],
    }),
    // Países — ano de referência
    comexPost({
      flow: "import", monthDetail: false,
      period: { from: `${annualRef}-01`, to: `${annualRef}-12` },
      filters: filter, details: ["country"], metrics: ["metricFOB", "metricKG"],
    }),
    // Países — período acumulado corrente
    comexPost({
      flow: "import", monthDetail: false,
      period: { from: `${currentYear}-01`, to: `${currentYear}-${monthPad}` },
      filters: filter, details: ["country"], metrics: ["metricFOB", "metricKG"],
    }),
    // Série mensal (últimos 3 anos)
    comexPost({
      flow: "import", monthDetail: true,
      period: { from: `${currentYear - 2}-01`, to: `${currentYear}-${monthPad}` },
      filters: filter, details: [], metrics: ["metricKG"],
    }),
  ]);

  // Agrega anuais por ano
  const byYear: Record<string, { fob: number; kg: number }> = {};
  for (const r of annualRows) {
    const y = String(r.year);
    if (!byYear[y]) byYear[y] = { fob: 0, kg: 0 };
    byYear[y].fob += Number(r.metricFOB) || 0;
    byYear[y].kg += Number(r.metricKG) || 0;
  }
  const ref  = byYear[String(annualRef)]  ?? { fob: 0, kg: 0 };
  const prev = byYear[String(annualPrev)] ?? { fob: 0, kg: 0 };

  const pc = sumRows(periodCurrRows);
  const pp = sumRows(periodPrevRows);

  const topAnual   = topCountries(countryAnnualRows);
  const topPeriodo = topCountries(countryPeriodRows);

  // Série mensal + média móvel 12m
  const mensal = monthlyRows
    .map((r: any) => ({
      date: `${r.year}-${String(r.monthNumber).padStart(2, "0")}`,
      kg: Number(r.metricKG) || 0,
    }))
    .sort((a: any, b: any) => a.date.localeCompare(b.date));

  const kgArr = mensal.map((m: any) => m.kg);
  const mm12  = rollingSum(kgArr, 12);
  const serieRecente = mensal.slice(-18).map((m: any, i: number, arr: any[]) => {
    const globalIdx = mensal.length - 18 + i;
    return `  ${m.date}: ${toMilT(m.kg)} | MM-12m: ${toMilT(mm12[globalIdx])}`;
  });

  // Monta texto estruturado para o Gemini
  const lines: string[] = [
    `╔══════════════════════════════════════════════════════════════╗`,
    `  DADOS DE IMPORTAÇÃO — NCM ${ncm8} (ComexStat / MDIC)`,
    `  Dados atualizados até: ${lastMonthName} de ${lastYear}`,
    `╚══════════════════════════════════════════════════════════════╝`,
    "",
    `▸ EVOLUÇÃO ANUAL — ${annualRef} vs ${annualPrev}`,
    `  ${annualRef} : ${toMilT(ref.kg)} | ${toMilUSD(ref.fob)} | Preço médio ${precoMedio(ref.kg, ref.fob)}`,
    `  ${annualPrev}: ${toMilT(prev.kg)} | ${toMilUSD(prev.fob)} | Preço médio ${precoMedio(prev.kg, prev.fob)}`,
    `  Var. volume : ${pct(ref.kg, prev.kg)}`,
    `  Var. valor  : ${pct(ref.fob, prev.fob)}`,
    `  Var. preço  : ${pctPreco(ref.kg, ref.fob, prev.kg, prev.fob)}`,
    "",
    `▸ ACUMULADO ${periodLabel.toUpperCase()} — ${currentYear} vs ${currentYear - 1}`,
    `  ${currentYear}          : ${toMilT(pc.kg)} | ${toMilUSD(pc.fob)} | Preço médio ${precoMedio(pc.kg, pc.fob)}`,
    `  ${currentYear - 1} (mesmo período): ${toMilT(pp.kg)} | ${toMilUSD(pp.fob)} | Preço médio ${precoMedio(pp.kg, pp.fob)}`,
    `  Var. volume : ${pct(pc.kg, pp.kg)}`,
    `  Var. valor  : ${pct(pc.fob, pp.fob)}`,
    `  Var. preço  : ${pctPreco(pc.kg, pc.fob, pp.kg, pp.fob)}`,
    "",
    `▸ PRINCIPAIS PAÍSES DE ORIGEM — ${annualRef} (por US$ FOB)`,
    ...topAnual.map((p, i) =>
      `  ${i + 1}. ${p.pais}: ${toMilUSD(p.fob)} — ${p.pctFob.toFixed(1)}% do valor | ${p.pctKg.toFixed(1)}% do peso`
    ),
    "",
    `▸ PRINCIPAIS PAÍSES DE ORIGEM — ${periodLabel}/${currentYear} (por US$ FOB)`,
    ...topPeriodo.map((p, i) =>
      `  ${i + 1}. ${p.pais}: ${toMilUSD(p.fob)} — ${p.pctFob.toFixed(1)}% do valor | ${p.pctKg.toFixed(1)}% do peso`
    ),
    "",
    `▸ SÉRIE MENSAL + MÉDIA MÓVEL 12 MESES (últimos 18 meses)`,
    ...serieRecente,
  ];

  return lines.join("\n");
}
