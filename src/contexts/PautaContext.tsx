import React, { createContext, useContext, useState } from 'react';

// Tipos mínimos (batem com o serviço/renderer que criamos)
export type PleitoRow = Record<string, string | undefined>;

export type Secao = {
  titulo: string;        // ex.: "2.1.1 Pleitos em análise na CCM"
  campos?: string[];     // cabeçalhos usados nessa seção (NCM, Produto, etc.)
  rows: PleitoRow[];     // linhas extraídas da pauta
};

export type PautaStats = {
  secoesDetectadas: number;
  tabelasConsideradas: number;
  itensExtraidos: number;
};

type PautaState = {
  secoes: Secao[];
  stats: PautaStats | null;
  setPauta: (s: Secao[], st: PautaStats) => void;
  limpar: () => void;
};

const Ctx = createContext<PautaState | null>(null);

export const PautaProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [secoes, setSecoes] = useState<Secao[]>([]);
  const [stats, setStats] = useState<PautaStats | null>(null);

  const setPauta = (s: Secao[], st: PautaStats) => {
    setSecoes(s);
    setStats(st);
  };

  const limpar = () => {
    setSecoes([]);
    setStats(null);
  };

  return (
    <Ctx.Provider value={{ secoes, stats, setPauta, limpar }}>
      {children}
    </Ctx.Provider>
  );
};

export function usePauta() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePauta must be used within PautaProvider');
  return ctx;
}
