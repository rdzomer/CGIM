// src/services/geminiComercioService.ts
import mammoth from 'mammoth';
import JSZip from 'jszip';

const SUPPORTED_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function buildPrompt(ncm: string): string {
  return `Você é um analista especialista em comércio exterior do CGIM/MDIC \
(Coordenação-Geral de Importações de Metais e Insumos, Ministério do Desenvolvimento, \
Indústria, Comércio e Serviços do Brasil).

O documento fornecido contém a ficha de comércio exterior da NCM ${ncm || '[NCM]'}, incluindo \
textos, tabelas e gráficos (treemaps de origem por país, gráficos de linha de volume/valor/preço \
e média móvel de 12 meses). Leia TODO o conteúdo — textual E visual — antes de redigir.

SUA TAREFA: redigir a Análise de Comércio Exterior em exatamente 3 ou 4 parágrafos, \
seguindo o formato padronizado CGIM/MDIC abaixo.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSTRUÇÕES DE PERÍODO (use os anos presentes no documento):
• Identifique o ano completo mais recente disponível (ex.: 2024) e o anterior (ex.: 2023).
• Identifique o período acumulado mais recente (ex.: jan–ago/2025) e compare com o mesmo \
período do ano anterior (jan–ago/2024).
• Use esses períodos reais em toda a análise — nunca invente períodos não documentados.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

§1 – EVOLUÇÃO GERAL (ano completo mais recente vs ano anterior):
OBRIGATÓRIO incluir:
  • Volume total importado em mil toneladas e variação % frente ao ano anterior
  • Valor total importado em US$ milhões e variação % frente ao ano anterior
  • Preço médio (US$/t) = valor / volume, e variação % frente ao ano anterior
  • Interpretação do movimento (crescimento, retração, sobreoferta, pressão de custos, etc.)

§2 – ACUMULADO DO PERÍODO MAIS RECENTE (jan–<último mês>/<ano corrente> vs mesmo período do ano anterior):
OBRIGATÓRIO incluir:
  • Volume acumulado e variação % frente ao mesmo período do ano anterior
  • Valor acumulado e variação % frente ao mesmo período do ano anterior
  • Preço médio do período e tendência (queda, estabilidade, elevação)
  • Indicação de persistência ou reversão do desequilíbrio identificado no §1

§3 – ESTRUTURA GEOGRÁFICA (extraída dos treemaps e tabelas de origem):
OBRIGATÓRIO incluir:
  • Os 3 principais países fornecedores com participação em % do valor total importado
  • Os 3 principais países fornecedores com participação em % do peso/volume total
  • Interpretação sobre concentração, dependência e vulnerabilidade da indústria nacional

§4 – MÉDIA MÓVEL DE 12 MESES (somente se o documento apresentar este gráfico):
  • Manutenção, aceleração ou desaceleração dos fluxos de importação
  • Síntese sobre a efetividade da medida tarifária vigente
  ⚠️ Se o documento NÃO apresentar gráfico de média móvel, OMITA este parágrafo.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MODELO DE ESTILO OBRIGATÓRIO — escreva exatamente neste padrão:

"Em [ano], as importações da NCM [xxxx] totalizaram [x] mil toneladas e US$ [y] milhões, \
[crescimento/queda] de [x%] em volume e [y%] em valor frente a [ano anterior]. \
O preço médio [caiu/subiu] [z%], para US$ [valor]/t, refletindo [interpretação].

No acumulado de janeiro a [mês] de [ano corrente], as importações somaram [x] mil toneladas \
e US$ [y] milhões, [crescimento/queda] de [x%] em volume e [y%] em valor frente ao mesmo \
período de [ano anterior]. O preço médio [comportamento], mantendo tendência \
[descendente/ascendente/estável] [contexto adicional].

A estrutura de importações mostra elevada concentração: [país 1] respondeu por [x%] do valor \
e [y%] do volume, seguido de [país 2] ([x%] e [y%]) e [país 3] ([x%] e [y%]). \
Essa concentração confirma a dependência de poucos fornecedores e a vulnerabilidade da \
indústria nacional.

A média móvel de 12 meses indica que [síntese sobre tendência e efetividade tarifária]."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DIRETRIZES DE TOM E LINGUAGEM:

Sobre tendências de preço e volume:
• Afirme tendência ascendente ou de reversão APENAS quando houver consistência ao longo de \
múltiplos períodos ou confirmação na média móvel de 12 meses.
• Quando houver apenas uma variação pontual ou quando o preço permanecer em patamar próximo \
ao período anterior, use termos como "relativa estabilidade", "oscilação moderada" ou \
"variação pontual sem alteração estrutural".
• Evite expressões como "tendência de alta", "reversão de tendência" ou "recuperação de preços" \
sem suporte nos dados de múltiplos períodos.

Sobre concentração geográfica:
• Use linguagem objetiva e proporcional aos dados: prefira "elevada concentração", \
"forte participação do fornecedor predominante" e "participações individualmente reduzidas \
dos demais fornecedores".
• Quando os dados listarem vários países (mesmo com participações menores), reconheça sua \
existência — evite sugerir que apenas um ou dois países são identificáveis.
• Evite exageros como "dependência absoluta" ou "ausência de alternativas" a menos que os \
dados realmente mostrem isso.

Sobre interpretação e cautela:
• Distinguir com nitidez: (a) fatos observados nos dados, (b) interpretações plausíveis, \
(c) pontos que demandam cautela ou acompanhamento adicional.
• O texto deve ser claro, sintético e tecnicamente embasado, voltado a subsidiar \
análise institucional — sem julgamentos além do que os dados permitem.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGRAS ABSOLUTAS:
1. Use APENAS dados explicitamente presentes no documento. NUNCA invente ou estime números.
2. Todos os números devem ser extraídos do documento — tabelas, gráficos, treemaps ou texto.
3. Se um dado específico não estiver disponível, omita aquela frase — não use placeholders.
4. Responda SOMENTE com os parágrafos da análise: sem títulos, sem bullets, sem markdown.
5. Texto corrido. Parágrafos separados por linha em branco.
6. É PROIBIDO produzir apenas um parágrafo — a análise mínima tem 3 parágrafos completos.`;
}

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

export async function analisarComercioComGemini(file: File, ncm: string): Promise<string> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('Chave VITE_GEMINI_API_KEY não encontrada no .env.local');

  const arrayBuffer = await file.arrayBuffer();

  // Extrai texto do .docx via mammoth
  const { value: text } = await mammoth.extractRawText({ arrayBuffer });

  // Extrai imagens da estrutura ZIP do .docx
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

  const parts: GeminiPart[] = [
    { text: `${buildPrompt(ncm)}\n\n--- CONTEÚDO TEXTUAL DO DOCUMENTO ---\n${text}` },
    ...imageParts,
  ];

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0, maxOutputTokens: 8192 },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    const msg = err?.error?.message ?? res.statusText;
    throw new Error(`Gemini ${res.status}: ${msg}`);
  }

  const data = await res.json() as any;
  const result: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!result) throw new Error('Gemini não retornou texto. Verifique o documento enviado.');
  return result.trim();
}
