// src/services/geminiComercioService.ts
import mammoth from 'mammoth';
import JSZip from 'jszip';
import type { DadosComexstat } from './comexstatService';

// ─── Configuração Gemini ───────────────────────────────────────────────────────

const SUPPORTED_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

async function geminiPost(parts: GeminiPart[], maxTokens = 8192): Promise<string> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('Chave VITE_GEMINI_API_KEY não encontrada no .env.local');

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0, maxOutputTokens: maxTokens },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(`Gemini ${res.status}: ${err?.error?.message ?? res.statusText}`);
  }

  const data = await res.json() as any;
  const result: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!result) throw new Error('Gemini não retornou texto. Verifique a entrada.');
  return result.trim();
}

// ─── Prompt curto e rígido (fluxo ComexStat) ─────────────────────────────────
// O Gemini APENAS redige. Todos os valores já estão calculados e formatados no JSON.

function buildPromptComexstat(dados: DadosComexstat): string {
  const { ano_completo: ac, acumulado_parcial: ap, janela_12m: j12 } = dados;

  return `Você é analista de comércio exterior do CGIM/MDIC. Redija a seção "Análise de comércio exterior" a partir dos dados estruturados abaixo.

REGRA FUNDAMENTAL: TODOS OS VALORES JÁ ESTÃO CALCULADOS E FORMATADOS. Não calcule, não converta, não arredonde, não estime e não reformate nenhum número. Copie os valores exatamente como estão nos campos do JSON.

═══════════════════════════════════════════════
DADOS ESTRUTURADOS (NCM ${dados.ncm} — atualizado até ${dados.atualizado_ate}):

${JSON.stringify(dados, null, 2)}
═══════════════════════════════════════════════

ESTRUTURA OBRIGATÓRIA — ${ap ? (j12 ? '4' : '3') : (j12 ? '3' : '2')} parágrafos, nesta ordem:

PARÁGRAFO 1 — use EXCLUSIVAMENTE o bloco "ano_completo" (anos fechados).
Modelo obrigatório:
"Em ${ac.ano_ref}, as importações da NCM ${dados.ncm} somaram ${ac.volume_ref_formatado} e ${ac.valor_ref_formatado}, [alta/queda] de ${ac.var_volume_pct_formatado} em volume e ${ac.var_valor_pct_formatado} em valor frente a ${ac.ano_prev}. O preço médio de importação [recuou/subiu] de ${ac.preco_prev_formatado} em ${ac.ano_prev} para ${ac.preco_ref_formatado} em ${ac.ano_ref}, variação de ${ac.var_preco_pct_formatado}. Os dados indicam [interpretação]."

${ap
  ? `PARÁGRAFO 2 — use EXCLUSIVAMENTE o bloco "acumulado_parcial" (${ap.n_meses} meses parciais, NÃO é janela móvel).
Modelo obrigatório:
"No acumulado de ${ap.periodo_ref}, as importações alcançaram ${ap.volume_ref_formatado} e ${ap.valor_ref_formatado}, [alta/queda] de ${ap.var_volume_pct_formatado} em volume e ${ap.var_valor_pct_formatado} em valor frente a ${ap.periodo_prev}. O preço médio foi de ${ap.preco_ref_formatado}, [alta/queda] de ${ap.var_preco_pct_formatado}. O dado mais recente sugere [interpretação]."
⚠️ Nunca use valores de "acumulado_parcial" em outro parágrafo.`
  : `OMITA o parágrafo de acumulado parcial (bloco ausente nos dados).`}

${j12
  ? `PARÁGRAFO ${ap ? '3' : '2'} — use EXCLUSIVAMENTE o bloco "janela_12m" (cada janela = 12 meses completos).
Modelo obrigatório:
"A análise em janelas móveis de 12 meses indica [alta/queda/estabilidade]. No período ${j12.W0_label}, as importações somaram ${j12.W0_volume_formatado}, [alta/queda] de ${j12.W0_vs_W1_pct_formatado} frente ao período ${j12.W1_label}${j12.W0_vs_media_3_pct_formatado ? `. O volume ficou ${j12.W0_vs_media_3_pct_formatado} [acima/abaixo] da média dos três períodos anteriores${j12.W0_vs_media_4_pct_formatado ? ` e ${j12.W0_vs_media_4_pct_formatado} [acima/abaixo] da média dos quatro períodos anteriores` : ''}, o que sugere [interpretação]."` : '."'}
⚠️ W0_label = "${j12.W0_label}". Nunca chame W0 de outro período. Nunca use o volume de "acumulado_parcial" (${ap?.volume_ref_formatado ?? 'N/A'}) como volume de W0.`
  : `OMITA o parágrafo de janelas móveis (bloco ausente nos dados).`}

PARÁGRAFO ${ap && j12 ? '4' : ap || j12 ? '3' : '2'} — use EXCLUSIVAMENTE o bloco "origens".
Cite os principais países de "origens.ano_completo". Se "origens.acumulado_parcial" existir, compare a composição.
Interprete: China >80% = elevada concentração; >50% = concentração relevante; <10% = participação residual.
Aponte origens não alcançadas por eventuais medidas de defesa comercial.

═══════════════════════════════════════════════
PROIBIÇÕES ABSOLUTAS:
1. Nunca use valores de "acumulado_parcial" no parágrafo de "ano_completo".
2. Nunca use valores de "acumulado_parcial" no parágrafo de "janela_12m".
3. Nunca substitua W0_label ("${j12?.W0_label ?? '—'}") pelo periodo_ref ("${ap?.periodo_ref ?? '—'}").
4. Nunca calcule, converta ou estime qualquer número.
5. Responda APENAS com os parágrafos: sem título, sem bullets, sem markdown.
6. Texto corrido. Parágrafos separados por linha em branco.`;
}

// ─── Prompt para Análise Técnica (fluxo ComexStat) ───────────────────────────

function buildPromptAnaliseTecnica(dados: DadosComexstat): string {
  const { ano_completo: ac, acumulado_parcial: ap, janela_12m: j12 } = dados;

  return `Você é analista técnico sênior do CGIM/MDIC. Redija a seção "Análise de comércio exterior" de uma análise técnica de pleito tarifário, a partir dos dados estruturados abaixo.

REGRA FUNDAMENTAL: TODOS OS VALORES JÁ ESTÃO CALCULADOS E FORMATADOS. Não calcule, não converta, não arredonde, não estime. Use os valores exatamente como constam nos campos do JSON.

A análise deve considerar apenas importações. Linguagem técnica, institucional e objetiva, adequada para uso interno no MDIC.

═══════════════════════════════════════════════
DADOS ESTRUTURADOS (NCM ${dados.ncm} — atualizado até ${dados.atualizado_ate}):

${JSON.stringify(dados, null, 2)}
═══════════════════════════════════════════════

ESTRUTURA OBRIGATÓRIA — ${ap ? (j12 ? '4' : '3') : (j12 ? '3' : '2')} parágrafos:

PARÁGRAFO 1 — bloco "ano_completo" EXCLUSIVAMENTE.
"Em ${ac.ano_ref}, as importações da NCM ${dados.ncm} somaram ${ac.volume_ref_formatado} e ${ac.valor_ref_formatado}, [alta/queda] de ${ac.var_volume_pct_formatado} em volume e ${ac.var_valor_pct_formatado} em valor frente a ${ac.ano_prev}. O preço médio [recuou/subiu] de ${ac.preco_prev_formatado} para ${ac.preco_ref_formatado}, variação de ${ac.var_preco_pct_formatado}. Os dados [indicam/apontam/sugerem] [interpretação técnica objetiva]."

${ap
  ? `PARÁGRAFO 2 — bloco "acumulado_parcial" EXCLUSIVAMENTE (${ap.n_meses} meses — NÃO é janela de 12 meses).
"No acumulado de ${ap.periodo_ref}, as importações alcançaram ${ap.volume_ref_formatado} e ${ap.valor_ref_formatado}, [alta/queda] de ${ap.var_volume_pct_formatado} em volume e ${ap.var_valor_pct_formatado} em valor frente a ${ap.periodo_prev}. O preço médio foi de ${ap.preco_ref_formatado}, [alta/queda] de ${ap.var_preco_pct_formatado}. O dado mais recente [sugere/aponta/é compatível com] [interpretação de tendência]."
⚠️ Nunca use valores de "acumulado_parcial" em outro parágrafo.`
  : `OMITA o parágrafo de acumulado (bloco ausente).`}

${j12
  ? `PARÁGRAFO ${ap ? '3' : '2'} — bloco "janela_12m" EXCLUSIVAMENTE (cada W = 12 meses completos).
"A análise em janelas móveis de 12 meses [reforça/revela/indica] [interpretação]. No período ${j12.W0_label}, as importações somaram ${j12.W0_volume_formatado}, [alta/queda] de ${j12.W0_vs_W1_pct_formatado} frente ao período ${j12.W1_label}${j12.W0_vs_media_3_pct_formatado ? `. O volume ficou ${j12.W0_vs_media_3_pct_formatado} [acima/abaixo] da média dos três períodos anteriores${j12.W0_vs_media_4_pct_formatado ? ` e ${j12.W0_vs_media_4_pct_formatado} [acima/abaixo] da média dos quatro períodos anteriores` : ''}, [interpretação sobre persistência, aceleração ou desaceleração da pressão importadora]."` : '."'}
⚠️ W0 = "${j12.W0_label}" com volume ${j12.W0_volume_formatado}. Nunca use o volume de "acumulado_parcial" (${ap?.volume_ref_formatado ?? 'N/A'}) aqui.`
  : `OMITA o parágrafo de janelas (bloco ausente).`}

PARÁGRAFO ${ap && j12 ? '4' : ap || j12 ? '3' : '2'} — bloco "origens" EXCLUSIVAMENTE.
Análise da estrutura de origem no "origens.ano_completo" e, se disponível, "origens.acumulado_parcial".
Interprete: concentração (China >80% = elevada; >50% = relevante; <10% = residual), diversificação, mudanças de composição entre períodos, origens não alcançadas por eventual defesa comercial (antidumping/salvaguardas).

═══════════════════════════════════════════════
PROIBIÇÕES ABSOLUTAS:
1. Nunca use "acumulado_parcial" em parágrafos de "ano_completo" ou "janela_12m".
2. Nunca use o volume ${ap?.volume_ref_formatado ?? '(N/A)'} como volume de W0.
3. Nunca chame W0 de "${ap?.periodo_ref ?? '—'}" — W0 é "${j12?.W0_label ?? '—'}".
4. Não calcule, não converta, não estime qualquer número.
5. Responda APENAS com os parágrafos: sem título, sem bullets, sem markdown.
6. Texto corrido. Parágrafos separados por linha em branco.`;
}

// ─── Validação automática ──────────────────────────────────────────────────────

function validarAnalise(texto: string, dados: DadosComexstat): void {
  const paras = texto.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  if (paras.length === 0) throw new Error('Gemini retornou texto vazio.');

  const erros: string[] = [];
  const p0 = paras[0];

  // §1: parágrafo anual deve conter ano_ref e volume anual
  if (!p0.includes(String(dados.ano_completo.ano_ref))) {
    erros.push(`§1: ano de referência "${dados.ano_completo.ano_ref}" ausente no primeiro parágrafo.`);
  }
  if (dados.ano_completo.volume_ref_formatado && !p0.includes(dados.ano_completo.volume_ref_formatado)) {
    erros.push(`§1: volume anual "${dados.ano_completo.volume_ref_formatado}" ausente no primeiro parágrafo.`);
  }

  // §1: não pode conter volume do acumulado parcial (se valores diferentes)
  if (dados.acumulado_parcial) {
    const ap = dados.acumulado_parcial;
    const accVol = ap.volume_ref_formatado;
    if (dados.ano_completo.volume_ref_formatado !== accVol && p0.includes(accVol)) {
      erros.push(`§1: volume do acumulado parcial "${accVol}" encontrado no parágrafo anual — mistura de períodos.`);
    }
    // §1 must not contain period labels from acumulado_parcial
    for (const label of [ap.periodo_ref, ap.periodo_prev]) {
      if (label && p0.includes(label)) {
        erros.push(`§1: rótulo de período parcial "${label}" encontrado no parágrafo de ano completo — mistura de períodos.`);
      }
    }
  }

  // §3 (janela móvel): deve conter W0_label e W0_volume; não pode conter volume acumulado
  if (dados.janela_12m) {
    const { W0_label, W0_volume_formatado } = dados.janela_12m;
    const paraJanela = paras.find(p => p.includes(W0_label));

    if (!paraJanela) {
      erros.push(`§3: W0_label "${W0_label}" não encontrado no texto — parágrafo de janela móvel ausente ou com período errado.`);
    } else {
      if (!paraJanela.includes(W0_volume_formatado)) {
        erros.push(`§3: volume W0 "${W0_volume_formatado}" ausente no parágrafo da janela móvel.`);
      }
      if (dados.acumulado_parcial) {
        const accVol = dados.acumulado_parcial.volume_ref_formatado;
        if (W0_volume_formatado !== accVol && paraJanela.includes(accVol)) {
          erros.push(`§3: volume do acumulado parcial "${accVol}" encontrado no parágrafo da janela móvel — mistura de períodos.`);
        }
      }
    }
  }

  if (erros.length > 0) {
    const detalhe = erros.join('\n• ');
    throw new Error(
      `A análise gerada misturou períodos. Gere novamente ou revise os dados estruturados.\n\n• ${detalhe}`,
    );
  }
}

// ─── Função pública: Análise de Comércio (fluxo ComexStat) ───────────────────

export async function gerarAnaliseComercioComexstat(
  dados: DadosComexstat,
): Promise<string> {
  // Sanity: volumes iguais entre ano_completo e acumulado_parcial são sinal de bug de período
  if (
    dados.acumulado_parcial &&
    dados.ano_completo.volume_ref_formatado === dados.acumulado_parcial.volume_ref_formatado
  ) {
    throw new Error(
      `Erro de período: volume anual (${dados.ano_completo.volume_ref_formatado}) igual ao acumulado parcial — os dados podem estar sobrepostos. Verifique comexstatService.ts.`,
    );
  }

  console.log("[Comercio] DADOS ENVIADOS AO GEMINI:", JSON.stringify(dados, null, 2));
  const prompt = buildPromptComexstat(dados);
  const resultado = await geminiPost([{ text: prompt }], 8192);
  validarAnalise(resultado, dados);
  return resultado;
}

// ─── Função pública: Análise Técnica (fluxo ComexStat) ───────────────────────

export async function gerarAnaliseTecnica(
  dados: DadosComexstat,
): Promise<string> {
  // Sanity: mesmos volumes entre ano_completo e acumulado_parcial = sinal de bug de período
  if (
    dados.acumulado_parcial &&
    dados.ano_completo.volume_ref_formatado === dados.acumulado_parcial.volume_ref_formatado
  ) {
    throw new Error(
      `Erro de período: volume anual (${dados.ano_completo.volume_ref_formatado}) igual ao acumulado parcial — os dados podem estar sobrepostos. Verifique comexstatService.ts.`,
    );
  }

  console.log("[Tecnica] DADOS ENVIADOS AO GEMINI:", JSON.stringify(dados, null, 2));
  const prompt = buildPromptAnaliseTecnica(dados);
  const resultado = await geminiPost([{ text: prompt }], 4096);
  validarAnalise(resultado, dados);
  return resultado;
}

// ─── Função pública: Análise via DOCX (fallback, não é o fluxo principal) ────

export async function analisarComercioComGemini(file: File, ncm: string): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const { value: text } = await mammoth.extractRawText({ arrayBuffer });

  const zip = await JSZip.loadAsync(arrayBuffer);
  const imageParts: GeminiPart[] = [];

  for (const [name, entry] of Object.entries(zip.files)) {
    if (!name.startsWith('word/media/') || entry.dir) continue;
    const ext = (name.split('.').pop() ?? '').toLowerCase();
    const mimeType = SUPPORTED_MIME[ext];
    if (!mimeType) continue;
    const base64 = await entry.async('base64');
    imageParts.push({ inline_data: { mime_type: mimeType, data: base64 } });
    if (imageParts.length >= 15) break;
  }

  const promptDocx = `Você é analista de comércio exterior do CGIM/MDIC. \
Analise APENAS as importações da NCM ${ncm || '[NCM]'} com base no documento fornecido. \
Redija 3 ou 4 parágrafos de análise de comércio exterior em linguagem técnica e institucional: \
(1) evolução anual, (2) acumulado do ano corrente, (3) janelas móveis se disponível, (4) origens. \
Sem títulos, sem bullets, texto corrido, parágrafos separados por linha em branco.`;

  const parts: GeminiPart[] = [
    { text: `${promptDocx}\n\n--- CONTEÚDO DO DOCUMENTO ---\n${text}` },
    ...imageParts,
  ];

  return geminiPost(parts, 8192);
}
