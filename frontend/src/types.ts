export type PixType = 'email' | 'cpf' | 'phone' | 'random' | null;

export interface SessionUser {
  username: string;
}

export interface ApiErrorBody {
  error?: string;
  message?: string;
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

export interface ExtratoItem {
  id: string;
  refId?: string;
  nome: string;
  tipo: 'deposito' | 'pagamento';
  valorCents: number;
  createdAt: string;
}

export type AreaTabId =
  | 'bancas'
  | 'pagamentos'
  | 'extratos'
  | 'sorteio'
  | 'palpite'
  | 'torneio'
  | 'gorjeta'
  | 'batalha-bonus'
  | 'cashbacks';
