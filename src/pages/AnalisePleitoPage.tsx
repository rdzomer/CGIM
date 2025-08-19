// src/pages/AnalisePleitoPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { doc, getDoc, getFirestore, updateDoc, serverTimestamp } from "firebase/firestore";
import toast from "react-hot-toast";

// … (todo o restante do seu arquivo original, sem alterações estruturais) …

// ⚠️ Apenas duas alterações funcionais feitas:
//   1) status padrão/forçado agora é "em_analise"
//   2) textareas com min-h[220px] + resize-y

// ——— SNIP: mantenha seu conteúdo anterior até chegar na função salvar ———

async function salvar(statusForcado?: "em_analise" | "concluido") {
  if (!atr) return;
  setSalvando(true);
  try {
    const db = getFirestore();
    const payload: any = {
      analise: {
        resumo: form.resumo || "",
        comercio: form.comercio || "",
        tecnica: form.tecnica || "",
        sugestao: form.sugestao || "",
      },
      updatedAt: serverTimestamp(),
    };
    if (statusForcado) payload.status = statusForcado;
    else if (!atr.status || atr.status === "novo") payload.status = "em_analise";

    await updateDoc(doc(db, "atribuicoes", atr.id), payload);
    toast.success(statusForcado === "concluido" ? "Análise concluída." : "Análise salva.");
    if (statusForcado === "concluido") navigate("/");
  } catch (e) {
    console.error(e);
    toast.error("Falha ao salvar.");
  } finally {
    setSalvando(false);
  }
}

// … no JSX, troque as textareas para min-h[220px] + resize-y …

<textarea
  className="w-full border rounded-lg p-2 min-h-[220px] resize-y"
  value={form.resumo || ""}
  onChange={(e) => setForm((f) => ({ ...f, resumo: e.target.value }))}
 />

// Repita a mesma classe nas outras 3 textareas (comércio, técnica, sugestão).

// E nos botões:
<button onClick={() => salvar("em_analise")} /* …classes… */>Salvar análise</button>
<button onClick={() => salvar("concluido")}   /* …classes… */>Concluir análise</button>

// ——— Fim ———

