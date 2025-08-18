// src/contexts/PleitosContext.tsx
import React, { createContext, useContext, useState } from "react";

type Pleito = any;

type PleitosCtx = {
  busca: string;
  setBusca: (v: string) => void;
  pleitos: Pleito[];
  setPleitos: (v: Pleito[]) => void;
};

const defaultCtx: PleitosCtx = {
  busca: "",
  setBusca: () => {},
  pleitos: [],
  setPleitos: () => {},
};

export const PleitosContext = createContext<PleitosCtx>(defaultCtx);

export const PleitosProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [busca, setBusca] = useState("");
  const [pleitos, setPleitos] = useState<Pleito[]>([]);

  return (
    <PleitosContext.Provider value={{ busca, setBusca, pleitos, setPleitos }}>
      {children}
    </PleitosContext.Provider>
  );
};

export const usePleitos = () => useContext(PleitosContext);
