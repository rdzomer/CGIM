// src/firebase.ts
import { initializeApp, getApps } from "firebase/app";
import { initializeFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Lê configuração do Vite (exposta no cliente via prefixo VITE_)
const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  // measurementId é opcional; só existe se você usa Analytics
  ...(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
    ? { measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string }
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
