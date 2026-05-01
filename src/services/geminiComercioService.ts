// src/services/geminiComercioService.ts
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { GoogleGenerativeAI } from '@google/generative-ai';

const SUPPORTED_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

function buildPrompt(ncm: string): string {
  const now = new Date();
  // Dados disponíveis até o mês anterior ao atual
  const lastData = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const currentYear = now.getFullYear();
  const lastDataMonthName = lastData.toLocaleDateString('pt-BR', { month: 'long' });

  // Comparativo anual: ano passado vs. retrasado (ex.: 2025 vs 2024)
  const annualRef = currentYear - 1;
  const annualPrev = currentYear - 2;

  // Comparativo por período: jan–<mês> do ano corrente vs. mesmo período do ano passado
  const periodPrev = currentYear - 1;

  return `Você é um analista especialista em comércio exterior do CGIM/MDIC \
(Coordenação-Geral de Importações de Metais e Insumos, Ministério do Desenvolvimento, \
Indústria, Comércio e Serviços do Brasil).

Analise os dados de importação da NCM ${ncm || '[NCM]'} contidos no documento fornecido \
— incluindo textos, tabelas e especialmente os gráficos (treemaps, gráficos de linha, barras, \
médias móveis, etc.) — e redija a Análise de Comércio Exterior seguindo EXATAMENTE o formato \
e estilo padronizado CGIM/MDIC descrito abaixo.

REFERÊNCIAS TEMPORAIS OBRIGATÓRIAS:
- Comparativo anual: ${annualRef} vs ${annualPrev}
- Período acumulado: janeiro a ${lastDataMonthName} de ${currentYear} vs mesmo período de ${periodPrev}

ESTRUTURA OBRIGATÓRIA (máximo 4 parágrafos):

§1 – EVOLUÇÃO GERAL (${annualRef} vs ${annualPrev}):
• Volume importado (mil toneladas) e valor (US$ milhões) com variação % frente a ${annualPrev}
• Preço médio (US$/t) e variação % anual
• Interpretação do movimento (crescimento, retração, sobreoferta, pressão de preços, etc.)

§2 – ACUMULADO ATÉ ${lastDataMonthName.toUpperCase()} DE ${currentYear} \
(janeiro–${lastDataMonthName}/${currentYear} vs janeiro–${lastDataMonthName}/${periodPrev}):
• Volume e valor com variação % frente ao mesmo período de ${periodPrev}
• Preço médio e tendência (queda, estabilidade, elevação)
• Indicação de persistência ou reversão do desequilíbrio

§3 – ESTRUTURA GEOGRÁFICA (com base nos treemaps e tabelas de origem):
• Participação dos principais países em valor e peso (%)
• Destaque para os 2 ou 3 maiores fornecedores
• Interpretação sobre concentração, dependência e vulnerabilidade da indústria nacional

§4 – MÉDIA MÓVEL DE 12 MESES (somente se o documento apresentar esse gráfico):
• Manutenção, aceleração ou desaceleração dos fluxos
• Síntese sobre a efetividade da medida tarifária vigente
• Se não houver dados de média móvel no documento, OMITA este parágrafo completamente

MODELO DE ESTILO — siga EXATAMENTE este padrão de escrita:

"Em ${annualRef}, as importações da NCM [xxxx] totalizaram [x mil toneladas] e [US$ x milhões], \
um aumento de [x%] em volume e [y%] em valor frente a ${annualPrev}. O preço médio caiu [z%], \
para [US$/t], refletindo [interpretação do cenário].

No acumulado até ${lastDataMonthName} de ${currentYear}, as importações somaram \
[x mil toneladas] e [US$ x milhões], representando [x%] de variação em volume e [y%] em valor \
frente ao mesmo período de ${periodPrev}. O preço médio [comportamento], mantendo tendência \
[descendente/ascendente/estável] mesmo após [medida vigente ou contexto].

A estrutura de importações mostra elevada concentração: [país 1] respondeu por [x%] do valor \
e [y%] do volume, seguido de [país 2] ([x%]; [y%]). Essa concentração confirma a dependência \
de poucos fornecedores e a vulnerabilidade da indústria nacional.

A média móvel de 12 meses indica que [síntese sobre tendência e efetividade tarifária]."

REGRAS INVIOLÁVEIS:
- Use APENAS dados presentes no documento fornecido. Nunca invente números.
- Se algum dado não estiver disponível, omita a menção ou use [dado não disponível no documento].
- Responda APENAS com os parágrafos da análise: sem títulos, sem marcadores, sem markdown.
- Texto corrido; parágrafos separados por linha em branco. Máximo 4 parágrafos.`;
}

export async function analisarComercioComGemini(file: File, ncm: string): Promise<string> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('Chave VITE_GEMINI_API_KEY não encontrada no .env.local');

  const arrayBuffer = await file.arrayBuffer();

  // Extrai texto do .docx via mammoth
  const { value: text } = await mammoth.extractRawText({ arrayBuffer });

  // Extrai imagens da estrutura ZIP do .docx
  const zip = await JSZip.loadAsync(arrayBuffer);
  const imageParts: { inlineData: { data: string; mimeType: string } }[] = [];

  for (const [name, entry] of Object.entries(zip.files)) {
    if (!name.startsWith('word/media/') || entry.dir) continue;
    const ext = (name.split('.').pop() ?? '').toLowerCase();
    const mimeType = SUPPORTED_MIME[ext];
    if (!mimeType) continue;
    const base64 = await entry.async('base64');
    imageParts.push({ inlineData: { data: base64, mimeType } });
    if (imageParts.length >= 15) break; // limite de segurança
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const result = await model.generateContent([
    { text: `${buildPrompt(ncm)}\n\n--- CONTEÚDO TEXTUAL DO DOCUMENTO ---\n${text}` },
    ...imageParts,
  ]);

  return result.response.text().trim();
}
