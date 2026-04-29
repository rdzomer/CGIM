// src/firebase.ts
import { initializeApp, getApps } from "firebase/app";
import { initializeFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

/**
 * Sanitiza variável de ambiente:
 * - remove aspas no início/fim
 * - remove vírgula no fim
 * - trim
 */
function env(name: string): string | undefined {
  const raw = (import.meta.env as any)?.[name];
  if (raw == null) return undefined;
  let v = String(raw).trim();

  // remove aspas externas
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }

  // remove vírgula final acidental
  v = v.replace(/,+\s*$/, "").trim();

  return v || undefined;
}

// Lê configuração do Vite (exposta no cliente via prefixo VITE_)
const cfg = {
  apiKey: env("VITE_FIREBASE_API_KEY"),
  authDomain: env("VITE_FIREBASE_AUTH_DOMAIN"),
  projectId: env("VITE_FIREBASE_PROJECT_ID"),
  storageBucket: env("VITE_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: env("VITE_FIREBASE_MESSAGING_SENDER_ID"),
  appId: env("VITE_FIREBASE_APP_ID"),
  ...(env("VITE_FIREBASE_MEASUREMENT_ID")
    ? { measurementId: env("VITE_FIREBASE_MEASUREMENT_ID") as string }
    : {}),
};

function assertConfigPresent() {
  const missing: string[] = [];
  for (const [k, v] of Object.entries(cfg)) {
    if (!v || String(v).trim() === "") missing.push(k);
  }
  if (missing.length) {
    const msg =
      `[Firebase] Variáveis faltando no ambiente: ${missing.join(", ")}.\n` +
      `Defina no Netlify (Environment variables) e no .env.local.`;
    if (import.meta.env.DEV) console.error(msg);
    throw new Error(msg);
  }
}

assertConfigPresent();

if (import.meta.env.DEV) {
  console.info("[Firebase] project:", cfg.projectId, "authDomain:", cfg.authDomain);
}

const app = getApps().length ? getApps()[0] : initializeApp(cfg as any);

export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false,
});

export const auth = getAuth(app);