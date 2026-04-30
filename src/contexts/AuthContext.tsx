/* src/contexts/AuthContext.tsx */
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { auth, db } from "../firebase";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  User as FirebaseUser,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import type { Role, Usuario } from "../types";

// helper simples no topo do arquivo (ou acima do useEffect)
function withTimeout<T>(promise: Promise<T>, ms: number, label = "timeout"): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(label)), ms);
    promise
      .then((v) => {
        clearTimeout(id);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(id);
        reject(e);
      });
  });
}

type AuthContextType = {
  user: Usuario | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
});

/** Monta um objeto sem campos undefined (Firestore não aceita undefined). */
function clean(obj: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

async function readOrCreateUserDoc(fbUser: FirebaseUser): Promise<Usuario> {
  const ref = doc(db, "users", fbUser.uid);
  const snap = await withTimeout(getDoc(ref), 2500, "firestore_boot_timeout");

  if (!snap.exists()) {
    // Inclua apenas campos definidos; use serverTimestamp para datas
    const novo = clean({
      uid: fbUser.uid,
      email: fbUser.email ?? null,        // null é aceito, undefined não
      nome: fbUser.displayName ?? undefined,
      role: ("analista" as unknown) as Role,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await setDoc(ref, novo, { merge: true });

    // leia o que foi salvo (garante retorno consistente)
    const created = await getDoc(ref);
    return { uid: fbUser.uid, ...(created.data() as any) } as Usuario;
  }

  const data = snap.data() as any;
  // Na leitura, tudo bem ter campos ausentes; complete com o que vier do auth
  return {
    uid: fbUser.uid as any,
    email: fbUser.email ?? data?.email ?? null,
    nome: fbUser.displayName ?? data?.nome ?? null,
    role: (data?.role as Role) ?? (("analista" as unknown) as Role),
    ...data,
  } as Usuario;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<Usuario | null>(null);
  const [loading, setLoading] = useState(true);

  // Somente o onAuthStateChanged decide quando loading=false
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fb) => {
      try {
        if (!fb) {
          setUser(null);
          return; // setLoading(false) acontece no finally
        }
        const u = await readOrCreateUserDoc(fb);
        setUser(u);
      } catch (e) {
  console.error("[Auth] onAuthStateChanged error:", e);
  if (fb) {
    // fallback temporário: entra com dados básicos do Auth
    setUser({
      uid: fb.uid,
      email: fb.email ?? "",
      nome: fb.displayName ?? "Usuário",
      role: "Analista" as any,
    } as any);
  } else {
    setUser(null);
  }
} finally {
  setLoading(false);
}
    });
    return () => unsub();
  }, []);

  // Importante: não dar loading=false aqui; deixamos para o onAuthStateChanged
  const signIn = async (email: string, password: string) => {
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setLoading(false);
      throw err;
    }
  };

  const signUp = async (email: string, password: string, displayName?: string) => {
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName) {
        try {
          await updateProfile(cred.user, { displayName });
        } catch {
          /* ignore */
        }
      }
      // readOrCreateUserDoc será chamado pelo onAuthStateChanged
    } catch (err) {
      setLoading(false);
      throw err;
    }
  };

  const signOut = async () => {
    setLoading(true);
    try {
      await fbSignOut(auth);
    } catch (err) {
      setLoading(false);
      throw err;
    }
  };

  const value = useMemo(
    () => ({ user, loading, signIn, signUp, signOut }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Hook padrão
export const useAuth = () => useContext(AuthContext);
export default AuthProvider;

