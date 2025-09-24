// src/services/usuariosService.ts
import { db } from "../firebase";
import { collection, getDocs, query, where } from "firebase/firestore";

export type Usuario = {
  uid: string;
  nome: string;
  role?: string;
};

export async function listarAnalistas(): Promise<Usuario[]> {
  // colecao "users" com {uid, nome, role:'analista'}
  const qy = query(collection(db, "users"), where("role", "==", "analista"));
  const snap = await getDocs(qy);
  const arr: Usuario[] = [];
  snap.forEach((d) => {
    arr.push({ uid: d.id, ...(d.data() as any) });
  });
  return arr;
}
