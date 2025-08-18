// src/firebase.ts
import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

/**
 * Lê preferencialmente de variáveis VITE_ (Netlify/ambiente),
 * mantendo fallback nos valores já usados localmente para não quebrar nada.
 * Observação: config web do Firebase não é "secreto", mas é boa prática
 * mantê-lo fora do repositório.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "AIzaSyBrnZhQYQbdFMDZTlfukSIjoY2m3akJ4Wc",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "catcgim.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "catcgim",
  // bucket do Storage deve ser no formato *.appspot.com
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "catcgim.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "503717887651",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "1:503717887651:web:876b4423a7d65fc6d28916",
  ...(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
    ? { measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID }
    : {}),
};

if (import.meta.env.DEV) {
  const key = (firebaseConfig.apiKey || "").slice(0, 6);
  // Logs úteis apenas em dev
  console.info("[Firebase] usando key prefix:", key);
  console.info("[Firebase] domain/project:", firebaseConfig.authDomain, firebaseConfig.projectId);
}

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
