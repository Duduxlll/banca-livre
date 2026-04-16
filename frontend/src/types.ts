export type PixType = 'email' | 'cpf' | 'phone' | 'random' | null;

export interface SessionUser {
  username: string;
}

export interface Banca {
  id: string;
  nome: string;
  depositoCents: number;
  bancaCents: number | null;
  pixType: PixType;
  pixKey: string | null;
  message: string | null;
  createdAt: string;
}

export interface Pagamento {
  id: string;
  nome: string;
  pagamentoCents: number;
  pixType: PixType;
  pixKey: string | null;
  message: string | null;
  status: 'pago' | 'nao_pago';
  createdAt: string;
  paidAt: string | null;
}

export interface ApiErrorBody {
  error?: string;
  message?: string;
}

export type AdminTabId =
  | 'bancas'
  | 'pagamentos'
  | 'extratos'
  | 'sorteio'
  | 'palpite'
  | 'torneio'
  | 'gorjeta'
  | 'batalha-bonus'
  | 'cashbacks';

export interface AdminTabDefinition {
  id: AdminTabId;
  label: string;
  description: string;
  implemented: boolean;
}

export const ADMIN_TABS = [
  {
    id: 'bancas',
    label: 'Bancas',
    description: 'Gerencie depósitos e bancas ativas.',
    implemented: true
  },
  {
    id: 'pagamentos',
    label: 'Pagamentos',
    description: 'Controle pagamentos, PIX e status.',
    implemented: true
  },
  {
    id: 'extratos',
    label: 'Extratos',
    description: 'Histórico consolidado de depósitos e pagamentos.',
    implemented: false
  },
  {
    id: 'sorteio',
    label: 'Sorteio',
    description: 'Controle das inscrições do sorteio da live.',
    implemented: false
  },
  {
    id: 'palpite',
    label: 'Palpites',
    description: 'Rodadas e resultados do palpite.',
    implemented: false
  },
  {
    id: 'torneio',
    label: 'Torneio',
    description: 'Fases, times e resultados do torneio.',
    implemented: false
  },
  {
    id: 'gorjeta',
    label: 'Gorjeta',
    description: 'Sorteios e acompanhamento de gorjeta.',
    implemented: false
  },
  {
    id: 'batalha-bonus',
    label: 'Batalha bônus',
    description: 'Rodadas e participantes da batalha bônus.',
    implemented: false
  },
  {
    id: 'cashbacks',
    label: 'Print dos depósitos',
    description: 'Aprovação dos prints de cashback.',
    implemented: false
  }
] as const satisfies readonly AdminTabDefinition[];
