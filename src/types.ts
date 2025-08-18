// src/types.ts
// Tipos e enums compartilhados do app CGIM – Gestão de Pleitos

export type ID = string;

/** Perfis suportados (ENUM) */
export enum Role {
  Administrador = 'Administrador',
  Analista = 'Analista',
}
// alias opcional só se precisar usar união literal
export type RoleType = `${Role}`;

/** Status de um pleito
 *  OBS: É ENUM para existir em runtime (resolve o import do DashboardPage) */
export enum StatusPleito {
  pendente   = 'pendente',
  deferido   = 'deferido',
  indeferido = 'indeferido',
  em_analise = 'em_analise',
  arquivado  = 'arquivado',
}
// se em algum lugar você quiser a união de strings:
export type StatusPleitoType = `${StatusPleito}`;

/** Labels amigáveis para o Status */
export const STATUS_OPTIONS: { value: StatusPleito; label: string }[] = [
  { value: StatusPleito.pendente,   label: 'Pendente' },
  { value: StatusPleito.deferido,   label: 'Deferido' },
  { value: StatusPleito.indeferido, label: 'Indeferido' },
  { value: StatusPleito.em_analise, label: 'Em Análise' },
  { value: StatusPleito.arquivado,  label: 'Arquivado' },
];

/** Tipos de alteração (categorias da pauta) conforme seus prints */
export type TipoAlteracao =
  | 'Pleitos em análise na CCM'
  | 'Pleitos Pendentes na CCM: Pleitos do Brasil'
  | 'Pleitos Pendentes na CCM: Pleitos dos demais Estados Partes do Mercosul'
  | 'Pleitos Pendentes no CAT'
  | 'Pleitos Novos no CAT'
  | 'Pleitos dos demais Estados Partes do Mercosul no CAT: Pendentes'
  | 'Pleitos dos demais Estados Partes do Mercosul no CAT: Novos'
  | 'LETEC: Geral/Pendentes'
  | 'LETEC: Pleitos Novos'
  | 'CMC 27/15: Pendentes'
  | 'CMC 27/15: Novos'
  | 'LEBIT/BK: Pendentes'
  | 'LEBIT/BK: Novos'
  | 'CT-1: Pendentes'
  | 'CT-1: Novos';

/** Pauta de origem (texto livre ou id de pauta) */
export type PautaOrigem = 'Entrada Manual' | string;

/** Usuário do sistema (coleção "users") */
export type Usuario = {
  uid: string;
  nome: string;
  email: string;
  role: Role;          // usa o enum
  isActive?: boolean;
  createdAt?: any;     // Firestore Timestamp
  updatedAt?: any;     // Firestore Timestamp
};

/** Anotação interna (colaboração no pleito) */
export type AnotacaoInterna = {
  id: ID;
  autorUid: string;
  autorNome: string;
  texto: string;
  criadoEm: any; // Firestore Timestamp
};

/** Estrutura principal do Pleito (coleção "pleitos") */
export type Pleito = {
  id?: ID;

  // Dados descritivos
  ncm?: string;
  ex?: string;
  produto?: string;
  pleiteante?: string;
  pais?: string;
  processo?: string;

  // Classificação e origem
  tipoAlteracao?: TipoAlteracao;
  tipoPleitoGeral?: 'Inclusão' | 'Alteração' | 'Exclusão' | 'Outro';
  pautaOrigem?: PautaOrigem;
  pautaId?: string;             // id da pauta salva no Firestore (quando existir)
  pautaMeeting?: string | null; // nº da reunião (ex.: "63ª"), se disponível

  // Gestão/atribuição
  status?: StatusPleito;        // enum
  responsavelUid?: string | null;
  responsavelNome?: string | null;

  // Campos de análise (Subsídeo CGIM)
  resumo?: string;
  dadosComercio?: string;
  analiseTecnica?: string;
  sugestaoCgim?: string;

  // Gestão do processo (CGIM)
  prazoReuniaoCat?: any;  // Firestore Timestamp ou Date
  createdAt?: any;        // Firestore Timestamp
  atualizadoEm?: any;     // Firestore Timestamp

  // Colaboração
  anotacoes?: AnotacaoInterna[];
};

/** Filtro usado no painel de lista de pleitos */
export type PleitosFiltro = {
  q?: string;                               // busca geral
  ncm?: string;
  status?: StatusPleito | 'todos';
  responsavelUid?: string | 'todos';
  tipoAlteracao?: TipoAlteracao | 'todos';
  pautaOrigemId?: string | 'todos';
  apenasNcmsCgim?: boolean;                 // checkbox "Apenas NCMs CGIM"
};

/** Item da planilha de NCMs CGIM que você sobe nas Configurações */
export type NcmCgim = {
  ncm: string;        // preferir 8 dígitos (com ou sem pontuação)
  descricao?: string;
};

/** Stats de uma pauta salva */
export type PautaStats = { secoes: number; tabelas: number; itens: number };

/** Item de histórico de pauta (lista do card) */
export type PautaHistoricoItem = {
  id: string;
  tituloArquivo: string;
  hash: string;
  createdAt?: any;
  secoes?: number;
  tabelas?: number;
  itens?: number;
  meeting?: string | null;
};

/** Opções para exportação (Word) – quando for usar */
export type ExportWordOptions = {
  pleitosIds: string[];
  incluirAnexos?: boolean;
};

/** Modelo de usuário autenticado no contexto */
export type AuthUser = {
  uid: string;
  displayName: string | null;
  email: string | null;
  role?: Role;
};

/** Contrato do AuthContext */
export type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (nome: string, email: string, password: string, role: Role) => Promise<void>;
  signOut: () => Promise<void>;
};

/** Contrato do PleitosContext */
export type PleitosContextValue = {
  pleitos: Pleito[];
  loading: boolean;
  filtro: PleitosFiltro;
  setFiltro: (f: PleitosFiltro) => void;
  addPleito: (p: Pleito) => Promise<string>;
  updatePleito: (id: string, data: Partial<Pleito>) => Promise<void>;
  deletePleito: (id: string) => Promise<void>;
};

/** Helper de normalização de NCM para o padrão 0000.00.00 (opcional) */
export const normalizarNcm = (s?: string): string | undefined => {
  if (!s) return s;
  const onlyDigits = s.replace(/\D/g, '');
  if (!onlyDigits) return undefined;
  if (onlyDigits.length === 8) {
    return `${onlyDigits.slice(0, 4)}.${onlyDigits.slice(4, 6)}.${onlyDigits.slice(6, 8)}`;
  }
  return s;
};
