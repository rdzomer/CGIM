// src/types.ts

/** Perfis suportados */
export enum Role {
  Administrador = 'Administrador',
  Analista = 'Analista',
}

/** Usuário do sistema (coleção "users") */
export type Usuario = {
  uid: string;
  nome: string;
  email: string;
  role: Role;
  isActive?: boolean;
  createdAt?: any;
  updatedAt?: any;
};
