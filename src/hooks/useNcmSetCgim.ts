// src/hooks/useNcmSetCgim.ts
import { useEffect, useState } from "react";
import { getNcmSetCgim } from "../services/ncmsService";

export function useNcmSetCgim() {
  const [setCgim, setSetCgim] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getNcmSetCgim()
      .then((s) => {
        if (!alive) return;
        setSetCgim(s);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setSetCgim(new Set());
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { setCgim, loading };
}
