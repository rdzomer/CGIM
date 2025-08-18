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
import { doc, getDoc, setDoc } from "firebase/firestore";
import type { Role, Usuario } from "../types";

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

async function readOrCreateUserDoc(fbUser: FirebaseUser): Promise<Usuario> {
  const ref = doc(db, "users", fbUser.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const novo: Partial<Usuario> = {
      uid: fbUser.uid as any,
      email: fbUser.email || undefined,
      nome: fbUser.displayName || undefined,
      // se tiver enum Role no seu projeto, isso aqui fica coerente
      // senão, o tipo aceita string (adjust no seu types se necessário)
      role: (("analista" as unknown) as Role),
      createdAt: new Date() as any,
      updatedAt: new Date() as any,
    };
    await setDoc(ref, novo, { merge: true });
    return novo as Usuario;
  }

  const data = snap.data() as Partial<Usuario>;
  return {
    uid: fbUser.uid as any,
    email: fbUser.email || data.email,
    nome: fbUser.displayName || (data as any).nome,
    role: (data as any).role as Role,
    ...(data as any),
  } as Usuario;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<Usuario | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fb) => {
      try {
        if (!fb) {
          setUser(null);
          setLoading(false);
          return;
        }
        const u = await readOrCreateUserDoc(fb);
        setUser(u);
      } catch (e) {
        console.error("[Auth] onAuthStateChanged error:", e);
        setUser(null);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged atualizará o estado
    setLoading(false);
  };

  const signUp = async (email: string, password: string, displayName?: string) => {
    setLoading(true);
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName) {
      try { await updateProfile(cred.user, { displayName }); } catch {}
    }
    await readOrCreateUserDoc(cred.user);
    setLoading(false);
  };

  const signOut = async () => {
    setLoading(true);
    await fbSignOut(auth);
    setLoading(false);
  };

  const value = useMemo(
    () => ({ user, loading, signIn, signUp, signOut }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// ✅ hook que muitas páginas importam
export const useAuth = () => useContext(AuthContext);

// ✅ exporta também default para evitar qualquer variação de import
export default AuthProvider;
