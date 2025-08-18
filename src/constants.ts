
import { Pleito, Analista, Usuario, Role, StatusPleito, TipoPleitoEnum, SessaoAnalise, Anotacao } from './types';

export const MOCK_ANALISTAS: Analista[] = [
  { id: '1', nome: 'João da Silva', email: 'joao.silva@gov.br' },
  { id: '2', nome: 'Maria Oliveira', email: 'maria.oliveira@gov.br' },
  { id: '3', nome: 'Carlos Pereira', email: 'carlos.pereira@gov.br' },
];

export const MOCK_USUARIOS: Usuario[] = [
    { id: 'user1', nome: 'Admin User', email: 'admin@gov.br', role: Role.Administrador },
    { id: 'user2', nome: 'Gestor User', email: 'gestor@gov.br', role: Role.Gestor },
    { id: 'user3', nome: 'Analista User', email: 'analista@gov.br', role: Role.Analista },
    { id: 'user4', nome: 'João da Silva', email: 'joao.silva@gov.br', role: Role.Analista },
];

export const MOCK_PLEITOS: Pleito[] = [];

export const SESSAO_ANALISE_WORD_ORDER: SessaoAnalise[] = [
    SessaoAnalise.PENDENTES_CAT,
    SessaoAnalise.NOVOS_CAT,
    SessaoAnalise.LETEC_PENDENTES,
    SessaoAnalise.LETEC_NOVOS,
    SessaoAnalise.LEBIT_PENDENTES,
    SessaoAnalise.RENOVACAO_LETEC,
    SessaoAnalise.REDUCAO_TRANSITORIA,
    SessaoAnalise.CCM_ANALISE,
    SessaoAnalise.SEM_SESSAO,
];

export const SESSAO_ANALISE_DISPLAY_NAMES: Record<SessaoAnalise, string> = {
    [SessaoAnalise.CCM_ANALISE]: 'CCM - Em Análise',
    [SessaoAnalise.CCM_PENDENTES_BR]: 'CCM - Pendentes (BR)',
    [SessaoAnalise.CCM_PENDENTES_MERCOSUL]: 'CCM - Pendentes (Mercosul)',
    [SessaoAnalise.PENDENTES_CAT]: 'CAT - Pendentes',
    [SessaoAnalise.NOVOS_CAT]: 'CAT - Novos',
    [SessaoAnalise.CAT_MERCOSUL_PENDENTES]: 'CAT - Mercosul (Pendentes)',
    [SessaoAnalise.CAT_MERCOSUL_NOVOS]: 'CAT - Mercosul (Novos)',
    [SessaoAnalise.LETEC_PENDENTES]: 'LETEC - Geral/Pendentes',
    [SessaoAnalise.LETEC_NOVOS]: 'LETEC - Novos',
    [SessaoAnalise.CMC2715_PENDENTES]: 'CMC 27/15 - Pendentes',
    [SessaoAnalise.CMC2715_NOVOS]: 'CMC 27/15 - Novos',
    [SessaoAnalise.LEBIT_PENDENTES]: 'LEBIT/BK - Pendentes',
    [SessaoAnalise.LEBIT_NOVOS]: 'LEBIT/BK - Novos',
    [SessaoAnalise.CT1_PENDENTES]: 'CT-1 - Pendentes',
    [SessaoAnalise.CT1_NOVOS]: 'CT-1 - Novos',
    [SessaoAnalise.RENOVACAO_LETEC]: 'Renovação LETEC',
    [SessaoAnalise.REDUCAO_TRANSITORIA]: 'Redução Transitória',
    [SessaoAnalise.SEM_SESSAO]: 'Sem Seção Definida',
};
