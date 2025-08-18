import { GoogleGenAI } from "@google/genai";
import toast from "react-hot-toast";
import { Pleito, SessaoAnalise } from "../types";

// ------------------------------------------------------------------
// IMPORTANTE: Vite expõe variáveis com prefixo VITE_.
// Crie um .env.local com:  VITE_GEMINI_API_KEY=SUAS_CHAVE_AQUI
// ------------------------------------------------------------------

let ai: GoogleGenAI | null = null;

const getAIClient = () => {
  if (!ai) {
    // 🔧 AQUI estava o problema: process.env.* não existe no browser.
    // Use import.meta.env (padrão Vite).
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
    if (!apiKey) {
      // Erro amigável se a chave não estiver configurada
      throw new Error(
        "VITE_GEMINI_API_KEY ausente. Crie um arquivo .env.local com sua chave: VITE_GEMINI_API_KEY=..."
      );
    }
    ai = new GoogleGenAI({ apiKey });
  }
  return ai;
};

// Separador usado na saída do modelo
const PLEITO_SEPARATOR = "&&&PLEITO_SEPARATOR&&&";

export const geminiService = {
  extractPleitosFromDocumentText: async (
    documentText: string,
    fileName?: string
  ): Promise<Partial<Pleito>[]> => {
    const SESSAO_ANALISE_OPTIONS_FOR_AI = Object.values(SessaoAnalise)
      .map((value) => `'${value}'`)
      .join("\n");

    console.log(
      `Gemini Service: Processing HTML content from ${
        fileName || `uploaded HTML`
      } (length: ${documentText.length})...`
    );
    const client = getAIClient();

    const prompt = `
Você é um assistente de IA especialista em processar documentos de pauta do governo brasileiro em formato HTML. Sua única tarefa é ler o HTML e extrair CADA pleito individualmente em um objeto JSON.

REGRAS ABSOLUTAS E CRÍTICAS:

1.  **CAMPO 'sessaoAnalise'**: Este é o campo mais importante. Ele DEVE ser preenchido para CADA pleito.
    - O valor para 'sessaoAnalise' DEVE SER UMA DAS STRINGS EXATAS da lista abaixo. NÃO INVENTE VALORES. NÃO USE O TEXTO DO TÍTULO. ESCOLHA UMA OPÇÃO DA LISTA.
    - Para escolher a opção correta, leia o título da seção (h1, h2, h3, etc.) que vem imediatamente antes do pleito. Use sempre o título mais específico (o de nível mais baixo, ex: 2.1.2.1) para decidir.

--- LISTA DE OPÇÕES VÁLIDAS PARA 'sessaoAnalise' ---
${SESSAO_ANALISE_OPTIONS_FOR_AI}
--- FIM DA LISTA DE OPÇÕES ---

2.  **EXTRAÇÃO DE DADOS**: Para cada pleito (geralmente uma linha de tabela <tr>), extraia todos os dados disponíveis: 'ncm', 'produto', 'pleiteante', etc. Se um campo não estiver presente, omita-o do JSON.

3.  **FORMATO DE SAÍDA**:
    - Gere um objeto JSON para CADA pleito encontrado.
    - Após CADA objeto JSON, adicione o separador exato em uma nova linha: "${PLEITO_SEPARATOR}"

4.  **NÃO FAÇA ISSO**:
    - NÃO adicione explicações, comentários ou qualquer texto antes ou depois dos dados.
    - NÃO formate a saída com blocos de código markdown (\`\`\`json).
    - NÃO agrupe os pleitos em um array JSON. A saída deve ser uma sequência de objetos JSON, cada um seguido pelo separador.

Abaixo está o documento HTML para análise:
---
${documentText}
---
`;

    try {
      // Mantive sua chamada na mesma forma que você já usa com @google/genai
      const response = await (client as any).models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          temperature: 0.0,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });

      // A SDKs podem expor o texto em propriedades diferentes; tentamos em ordem.
      const responseText: string =
        (response?.text as string) ??
        (response?.output_text as string) ??
        (response?.candidates?.[0]?.content?.parts?.[0]?.text as string) ??
        "";

      if (!responseText.trim()) {
        throw new Error(
          "A IA não retornou nenhum dado. A pauta pode estar em um formato inesperado ou o modelo pode ter atingido limites."
        );
      }

      const pleitoStrings = responseText.split(PLEITO_SEPARATOR);
      const extractedPleitos: Partial<Pleito>[] = [];

      pleitoStrings.forEach((pleitoStr, index) => {
        const trimmedStr = pleitoStr.trim();
        if (!trimmedStr) return;

        try {
          // Às vezes vem embrulhado em ```json
          const cleanedStr = trimmedStr.replace(/^```json\s*|```$/g, "").trim();
          if (cleanedStr) {
            const pleito = JSON.parse(cleanedStr);
            extractedPleitos.push(pleito);
          }
        } catch (e: any) {
          console.warn(
            `Could not parse pleito object at index ${index}. Error: ${e.message}. Content: "${trimmedStr}"`
          );
        }
      });

      if (extractedPleitos.length === 0) {
        console.error("Full response from Gemini:", responseText);
        throw new Error(
          "Nenhum pleito foi extraído. A IA pode não ter conseguido processar o documento. Verifique o console para a resposta completa."
        );
      }

      console.log(
        `Total of ${extractedPleitos.length} pleitos extracted and parsed successfully.`
      );
      return extractedPleitos;
    } catch (error: any) {
      console.error("Error processing with Gemini:", error);
      toast.error(
        error?.message ||
          "Ocorreu um erro de comunicação com a IA. Tente novamente."
      );
      throw error;
    }
  },
};
