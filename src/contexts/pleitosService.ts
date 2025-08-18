// src/services/pleitosService.ts
// Serviço para buscar pleitos — aqui você pode integrar com Firebase ou API

export interface Pleito {
  id: string;
  titulo?: string;
  descricao?: string;
  [key: string]: any;
}

// Exemplo com dados mockados para rodar sem backend
export async function listarPleitos(): Promise<Pleito[]> {
  try {
    // Se quiser integrar com Firebase, basta substituir este bloco pelo fetch real
    return Promise.resolve([
      { id: "1", titulo: "Pleito 1", descricao: "Descrição do pleito 1" },
      { id: "2", titulo: "Pleito 2", descricao: "Descrição do pleito 2" },
    ]);
  } catch (error) {
    console.error("Erro ao listar pleitos:", error);
    return [];
  }
}
