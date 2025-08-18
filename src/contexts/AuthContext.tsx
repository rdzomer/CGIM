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
      // coerente com seu tipo Role/Usuario atual
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

  // Bootstrap da sessão: somente este listener decide quando loading=false
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
        setUser(null);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // Não fazer setLoading(false) aqui; o onAuthStateChanged cuidará disso
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
      // Não chamar readOrCreateUserDoc aqui; deixamos para o onAuthStateChanged
    } catch (err) {
      setLoading(false);
      throw err;
    }
  };

  const signOut = async () => {
    setLoading(true);
    try {
      await fbSignOut(auth);
      // onAuthStateChanged colocará user=null e loading=false
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

export const useAuth = () => useContext(AuthContext);
export default AuthProvider;
