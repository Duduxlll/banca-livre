import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePageTitle, useStylesheets } from '../hooks/usePageAssets';
import { apiFetch } from '../lib/api';
import {
  centsFromCurrencyInput,
  formatCpf,
  formatCurrencyInput,
  formatDateTime,
  formatMoney,
  formatPhoneBr,
  normalizePixKeyByType
} from '../lib/format';
import { buildPixPayload } from '../lib/pix';
import { useSession } from '../providers/SessionProvider';
import type { AreaTabId, Banca, ExtratoItem, Pagamento, PixType } from '../types';
import { AREA_RUNTIME_CSS } from './areaRuntimeCss';
import { GORJETA_HTML, PALPITE_HTML } from './legacyAreaMarkup';
import { SorteioPanel } from './SorteioPanel';

const ASSET_VERSION = '20260416a';

const AREA_STYLES = [
  `/assets/css/area.css?v=${ASSET_VERSION}`,
  `/assets/css/sorteio.css?v=${ASSET_VERSION}`,
  `/assets/css/palpite.css?v=${ASSET_VERSION}`,
  `/assets/css/cashback.css?v=${ASSET_VERSION}`,
  `/assets/css/torneio.css?v=${ASSET_VERSION}`,
  `/assets/css/gorjeta.css?v=${ASSET_VERSION}`,
  `/assets/css/batalha-bonus.css?v=${ASSET_VERSION}`
];

const LEGACY_MODULE_SCRIPTS = [
  `/assets/js/palpite-admin.js?v=${ASSET_VERSION}`,
  `/assets/js/torneio-admin.js?v=${ASSET_VERSION}`,
  `/assets/js/cashback-admin.js?v=${ASSET_VERSION}`,
  `/assets/js/gorjeta-admin.js?v=${ASSET_VERSION}`,
  `/assets/js/batalha-bonus-admin.js?v=${ASSET_VERSION}`
];

const TABS: Array<{ id: AreaTabId; label: string }> = [
  { id: 'bancas', label: 'Bancas' },
  { id: 'pagamentos', label: 'Pagamentos' },
  { id: 'sorteio', label: 'Sorteio' },
  { id: 'palpite', label: 'Palpites' },
  { id: 'torneio', label: 'Torneio' },
  { id: 'gorjeta', label: 'Gorjeta' },
  { id: 'batalha-bonus', label: 'Batalha bônus' },
  { id: 'cashbacks', label: 'Print dos depositos' },
  { id: 'extratos', label: 'Extratos' }
];

const AREA_TAB_IDS = new Set<AreaTabId>(TABS.map((tab) => tab.id));

type ToastType = 'ok' | 'success' | 'error' | 'info';
type ExtratoTipo = 'all' | 'deposito' | 'pagamento';
type ExtratoRange = 'today' | 'last7' | 'last30' | 'custom';

interface ToastState {
  message: string;
  type: ToastType;
}

interface AddBancaFormState {
  nome: string;
  deposito: string;
  pixType: '' | Exclude<PixType, null>;
  pixKey: string;
}

interface ExtratoFilters {
  tipo: ExtratoTipo;
  range: ExtratoRange;
  from: string;
  to: string;
}

interface ExtratosState {
  depositos: ExtratoItem[];
  pagamentos: ExtratoItem[];
}

interface TotaisPopupState {
  kind: 'depositos' | 'bancas';
  top: number;
  left: number;
}

interface StatusMenuState {
  id: string;
  current: Pagamento['status'];
  top: number;
  left: number;
}

interface PixModalState {
  nome: string;
  valorCents: number;
  emv: string;
  qrUrl: string;
}

type LegacyAdminModule = {
  init?: () => void;
  refresh?: () => Promise<void> | void;
  render?: () => void;
  onTabShown?: () => void;
};

declare global {
  interface Window {
    __banquinhasLegacyModulesBooted?: boolean;
    apiFetch?: typeof apiFetch;
    notify?: (message: string, type?: ToastType | string) => void;
    showToast?: (message: string, type?: ToastType | string) => void;
    PalpiteAdmin?: LegacyAdminModule;
    TorneioAdmin?: LegacyAdminModule;
    CashbackAdmin?: LegacyAdminModule;
    GorjetaAdmin?: LegacyAdminModule;
    BatalhaBonusAdmin?: LegacyAdminModule;
  }
}

const INITIAL_EXTRATO_FILTERS: ExtratoFilters = {
  tipo: 'all',
  range: 'last30',
  from: '',
  to: ''
};

const INITIAL_ADD_BANCA_FORM: AddBancaFormState = {
  nome: '',
  deposito: '',
  pixType: '',
  pixKey: ''
};

function isAreaTabId(value: string | null | undefined): value is AreaTabId {
  return AREA_TAB_IDS.has(value as AreaTabId);
}

function normalizeToastType(type: ToastType | string | undefined): ToastType {
  if (type === 'error' || type === 'info' || type === 'success' || type === 'ok') return type;
  return 'ok';
}

function tabFromPathname(pathname: string): AreaTabId | null {
  const maybeTab = pathname.replace(/^\/+/, '').split('/')[0];
  return isAreaTabId(maybeTab) ? maybeTab : null;
}

function getInitialTab(pathname: string): AreaTabId {
  const pathTab = tabFromPathname(pathname);
  if (pathTab) return pathTab;

  const saved = window.localStorage.getItem('area_tab');
  return isAreaTabId(saved) ? saved : 'bancas';
}

function sortByCreatedAtDesc<T extends { createdAt?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => ((a.createdAt || '') < (b.createdAt || '') ? 1 : -1));
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-area-script="${src}"]`);
    if (existing) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset.areaScript = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.body.appendChild(script);
  });
}

function buildExtratosQuery(filters: ExtratoFilters, tipoOverride: 'deposito' | 'pagamento'): string {
  const params = new URLSearchParams();
  params.set('tipo', tipoOverride);

  if (filters.range === 'custom') {
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
  } else {
    params.set('range', filters.range);
  }

  params.set('limit', '500');
  return params.toString();
}

function LegacyDialog(props: {
  id: string;
  className?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  const { id, className, open, onClose, children } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }

    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    const handleClose = () => {
      if (open) onClose();
    };

    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('close', handleClose);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('close', handleClose);
    };
  }, [onClose, open]);

  return (
    <dialog
      ref={dialogRef}
      id={id}
      className={className}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>
  );
}

function LegacyHtmlTab(props: { id: AreaTabId; activeTab: AreaTabId; html?: string }): JSX.Element {
  const { id, activeTab, html = '' } = props;
  return (
    <div
      className={`tab tab-view${activeTab === id ? ' show' : ''}`}
      id={`tab-${id}`}
      dangerouslySetInnerHTML={html ? { __html: html } : undefined}
    />
  );
}

export function AreaPage(): JSX.Element {
  usePageTitle('Guigz • Área');
  useStylesheets(AREA_STYLES);

  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useSession();

  const [activeTab, setActiveTab] = useState<AreaTabId>(() => getInitialTab(location.pathname));
  const [bancas, setBancas] = useState<Banca[]>([]);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [extratos, setExtratos] = useState<ExtratosState>({ depositos: [], pagamentos: [] });
  const [bancaDrafts, setBancaDrafts] = useState<Record<string, string>>({});
  const [busca, setBusca] = useState('');
  const [buscaExtrato, setBuscaExtrato] = useState('');
  const [extratoFilters, setExtratoFilters] = useState<ExtratoFilters>(INITIAL_EXTRATO_FILTERS);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [activeMessage, setActiveMessage] = useState<string | null>(null);
  const [isAddBancaOpen, setIsAddBancaOpen] = useState(false);
  const [addBancaForm, setAddBancaForm] = useState<AddBancaFormState>(INITIAL_ADD_BANCA_FORM);
  const [isAddingBanca, setIsAddingBanca] = useState(false);
  const [totaisPopup, setTotaisPopup] = useState<TotaisPopupState | null>(null);
  const [statusMenu, setStatusMenu] = useState<StatusMenuState | null>(null);
  const [pixModal, setPixModal] = useState<PixModalState | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const totalDepositos = bancas.reduce((acc, banca) => acc + (banca.depositoCents || 0), 0);
  const totalBancas = bancas.reduce((acc, banca) => acc + (banca.bancaCents || 0), 0);
  const buscaNormalizada = busca.trim().toLowerCase();
  const buscaExtratoNormalizada = buscaExtrato.trim().toLowerCase();
  const filteredBancas = bancas.filter((banca) =>
    banca.nome.toLowerCase().includes(buscaNormalizada)
  );
  const filteredPagamentos = pagamentos.filter((pagamento) =>
    pagamento.nome.toLowerCase().includes(buscaNormalizada)
  );
  const filteredExtratoDepositos = extratos.depositos.filter((item) =>
    item.nome.toLowerCase().includes(buscaExtratoNormalizada)
  );
  const filteredExtratoPagamentos = extratos.pagamentos.filter((item) =>
    item.nome.toLowerCase().includes(buscaExtratoNormalizada)
  );

  const showToast = useCallback((message: string, type: ToastType | string = 'ok') => {
    if (toastTimerRef.current != null) {
      window.clearTimeout(toastTimerRef.current);
    }

    setToast({
      message: String(message || ''),
      type: normalizeToastType(type)
    });

    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2600);
  }, []);

  async function loadBancas(): Promise<Banca[]> {
    const data = sortByCreatedAtDesc(await apiFetch<Banca[]>('/api/bancas'));
    setBancas(data);
    setBancaDrafts((current) => {
      const next: Record<string, string> = {};
      data.forEach((item) => {
        next[item.id] =
          current[item.id] ??
          (typeof item.bancaCents === 'number' ? formatMoney(item.bancaCents) : '');
      });
      return next;
    });
    return data;
  }

  async function loadPagamentos(): Promise<Pagamento[]> {
    const data = sortByCreatedAtDesc(await apiFetch<Pagamento[]>('/api/pagamentos'));
    setPagamentos(data);
    return data;
  }

  async function loadExtratos(filters: ExtratoFilters = extratoFilters): Promise<ExtratosState> {
    let next: ExtratosState = { depositos: [], pagamentos: [] };

    if (filters.tipo === 'all' || filters.tipo === 'deposito') {
      next = {
        ...next,
        depositos: await apiFetch<ExtratoItem[]>(
          `/api/extratos?${buildExtratosQuery(filters, 'deposito')}`
        )
      };
    }

    if (filters.tipo === 'all' || filters.tipo === 'pagamento') {
      next = {
        ...next,
        pagamentos: await apiFetch<ExtratoItem[]>(
          `/api/extratos?${buildExtratosQuery(filters, 'pagamento')}`
        )
      };
    }

    setExtratos(next);
    return next;
  }

  async function saveBancaDraft(id: string): Promise<void> {
    const banca = bancas.find((item) => item.id === id);
    if (!banca) return;

    const bancaCents = centsFromCurrencyInput(bancaDrafts[id] || '');
    if ((banca.bancaCents || 0) === bancaCents) return;

    setBancas((current) =>
      current.map((item) => (item.id === id ? { ...item, bancaCents } : item))
    );

    await apiFetch<Banca>(`/api/bancas/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ bancaCents })
    });
  }

  async function handleToPagamento(id: string): Promise<void> {
    try {
      await saveBancaDraft(id);
      await apiFetch<{ ok: true }>(`/api/bancas/${encodeURIComponent(id)}/to-pagamento`, {
        method: 'POST'
      });
      await Promise.all([loadBancas(), loadPagamentos()]);
      showToast('Banca movida para pagamentos.', 'ok');
    } catch (error) {
      console.error(error);
      showToast('Erro ao mover para pagamentos.', 'error');
    }
  }

  async function handleToBanca(id: string): Promise<void> {
    try {
      await apiFetch<{ ok: true }>(`/api/pagamentos/${encodeURIComponent(id)}/to-banca`, {
        method: 'POST'
      });
      await Promise.all([loadPagamentos(), loadBancas()]);
      showToast('Pagamento voltou para bancas.', 'ok');
    } catch (error) {
      console.error(error);
      showToast('Erro ao voltar para bancas.', 'error');
    }
  }

  async function deleteBanca(id: string): Promise<void> {
    try {
      await apiFetch<{ ok: true }>(`/api/bancas/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      await loadBancas();
      showToast('Banca excluída.', 'ok');
    } catch (error) {
      console.error(error);
      showToast('Erro ao excluir banca.', 'error');
    }
  }

  async function deleteAllBancas(): Promise<void> {
    if (!bancas.length) {
      showToast('Não há bancas para excluir.', 'error');
      return;
    }

    const confirmed = window.confirm(
      `Tem certeza que deseja excluir todas as ${bancas.length} bancas? Essa ação não pode ser desfeita.`
    );
    if (!confirmed) return;

    try {
      await Promise.all(
        bancas.map((banca) =>
          apiFetch<{ ok: true }>(`/api/bancas/${encodeURIComponent(banca.id)}`, {
            method: 'DELETE'
          })
        )
      );
      await loadBancas();
      showToast('Todas as bancas foram excluídas.', 'ok');
    } catch (error) {
      console.error(error);
      showToast('Erro ao excluir todas as bancas.', 'error');
    }
  }

  async function deletePagamento(id: string, silent = false): Promise<void> {
    try {
      await apiFetch<{ ok: true }>(`/api/pagamentos/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      await loadPagamentos();
      if (!silent) showToast('Pagamento excluído.', 'ok');
    } catch (error) {
      console.error(error);
      if (!silent) showToast('Erro ao excluir pagamento.', 'error');
    }
  }

  async function setPagamentoStatus(id: string, status: Pagamento['status']): Promise<void> {
    try {
      await apiFetch<Pagamento>(`/api/pagamentos/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      await loadPagamentos();
      showToast('Status atualizado.', 'ok');
    } catch (error) {
      console.error(error);
      showToast('Erro ao atualizar status.', 'error');
    }
  }

  async function handleAddBancaSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const nome = addBancaForm.nome.trim();
    const depositoCents = centsFromCurrencyInput(addBancaForm.deposito);
    const pixKey = normalizePixKeyByType(addBancaForm.pixType, addBancaForm.pixKey);

    if (!nome || !depositoCents) {
      showToast('Preencha nome e depósito.', 'error');
      return;
    }

    setIsAddingBanca(true);
    try {
      await apiFetch<Banca>('/api/bancas/manual', {
        method: 'POST',
        body: JSON.stringify({
          nome,
          depositoCents,
          pixType: addBancaForm.pixType || null,
          pixKey: pixKey || null
        })
      });

      setAddBancaForm(INITIAL_ADD_BANCA_FORM);
      setIsAddBancaOpen(false);
      await loadBancas();
      showToast('Banca adicionada com sucesso.', 'ok');
    } catch (error) {
      console.error(error);
      showToast('Erro ao criar banca manual.', 'error');
    } finally {
      setIsAddingBanca(false);
    }
  }

  function setActiveTabAndPersist(tab: AreaTabId): void {
    setActiveTab(tab);
    window.localStorage.setItem('area_tab', tab);
    setStatusMenu(null);
    setTotaisPopup(null);
  }

  function showTotais(kind: TotaisPopupState['kind'], anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const popupWidth = 240;
    const left = Math.min(
      Math.max(8, rect.left + rect.width / 2 - popupWidth / 2),
      window.innerWidth - popupWidth - 8
    );
    const top = rect.top > 100 ? rect.top - 86 : rect.bottom + 8;
    setTotaisPopup({ kind, top: Math.round(top), left: Math.round(left) });
  }

  function showStatusMenu(anchor: HTMLElement, item: Pagamento): void {
    const rect = anchor.getBoundingClientRect();
    const width = 160;
    setStatusMenu({
      id: item.id,
      current: item.status,
      top: Math.round(rect.bottom + 6),
      left: Math.round(Math.min(Math.max(8, rect.left), window.innerWidth - width - 8))
    });
  }

  function openPixModal(item: Pagamento): void {
    const emv = buildPixPayload({
      chave: item.pixKey || '',
      valorCents: Number(item.pagamentoCents || 0),
      nome: item.nome || 'RECEBEDOR',
      cidade: 'BRASILIA',
      txid: '***',
      tipo: item.pixType || null
    });

    setPixModal({
      nome: item.nome,
      valorCents: item.pagamentoCents,
      emv,
      qrUrl: `/qr?size=240&data=${encodeURIComponent(emv)}`
    });
  }

  async function copyPixCode(): Promise<void> {
    if (!pixModal?.emv) return;
    try {
      await navigator.clipboard.writeText(pixModal.emv);
      showToast('Código copia-e-cola copiado!', 'ok');
    } catch (error) {
      console.error(error);
      showToast('Não consegui copiar automaticamente.', 'error');
    }
  }

  function updateExtratoFilters(nextFilters: ExtratoFilters): void {
    setExtratoFilters(nextFilters);
    void loadExtratos(nextFilters).catch((error) => {
      console.error(error);
      showToast('Erro ao carregar extratos.', 'error');
    });
  }

  async function handleLogout(): Promise<void> {
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      console.error(error);
      showToast('Erro ao sair.', 'error');
    }
  }

  function callLegacyTabHook(tab: AreaTabId): void {
    const byTab: Partial<Record<AreaTabId, LegacyAdminModule | undefined>> = {
      palpite: window.PalpiteAdmin,
      torneio: window.TorneioAdmin,
      gorjeta: window.GorjetaAdmin,
      'batalha-bonus': window.BatalhaBonusAdmin,
      cashbacks: window.CashbackAdmin
    };

    const legacyModule = byTab[tab];
    if (!legacyModule) return;

    try {
      if (legacyModule.onTabShown) legacyModule.onTabShown();
      else if (legacyModule.refresh) void legacyModule.refresh();
    } catch (error) {
      console.error(error);
    }
  }

  useEffect(() => {
    const pathTab = tabFromPathname(location.pathname);
    if (pathTab && pathTab !== activeTab) {
      setActiveTabAndPersist(pathTab);
    }
  }, [location.pathname]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current != null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    window.apiFetch = apiFetch;
    window.notify = (message, type) => showToast(message, type);
    window.showToast = (message, type) => showToast(message, type);
  }, [showToast]);

  useEffect(() => {
    let cancelled = false;

    async function bootLegacyModules(): Promise<void> {
      if (!window.__banquinhasLegacyModulesBooted) {
        for (const src of LEGACY_MODULE_SCRIPTS) {
          await loadScript(src);
        }
        window.__banquinhasLegacyModulesBooted = true;
        document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
      }

      if (!cancelled) {
        callLegacyTabHook(activeTab);
      }
    }

    void bootLegacyModules().catch((error) => {
      console.error(error);
      window.__banquinhasLegacyModulesBooted = false;
      showToast('Erro ao carregar módulos da área.', 'error');
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void Promise.all([loadBancas(), loadPagamentos(), loadExtratos()]).catch((error) => {
      console.error(error);
      showToast('Erro ao carregar a área.', 'error');
    });
  }, []);

  useEffect(() => {
    const pathTab = tabFromPathname(location.pathname);
    if (!pathTab) {
      window.localStorage.setItem('area_tab', activeTab);
    }

    if (activeTab === 'bancas') {
      void loadBancas().catch((error) => {
        console.error(error);
        showToast('Erro ao carregar bancas.', 'error');
      });
    } else if (activeTab === 'pagamentos') {
      void loadPagamentos().catch((error) => {
        console.error(error);
        showToast('Erro ao carregar pagamentos.', 'error');
      });
    } else if (activeTab === 'extratos') {
      void loadExtratos().catch((error) => {
        console.error(error);
        showToast('Erro ao carregar extratos.', 'error');
      });
    } else {
      callLegacyTabHook(activeTab);
    }
  }, [activeTab]);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let active = true;

    const connect = () => {
      if (!active) return;
      eventSource = new EventSource('/api/stream');

      eventSource.addEventListener('bancas-changed', () => {
        void loadBancas().catch(console.error);
      });
      eventSource.addEventListener('pagamentos-changed', () => {
        void loadPagamentos().catch(console.error);
      });
      eventSource.addEventListener('extratos-changed', () => {
        void loadExtratos().catch(console.error);
      });
      eventSource.addEventListener('cashbacks-changed', () => {
        if (window.CashbackAdmin?.refresh) {
          void Promise.resolve(window.CashbackAdmin.refresh()).then(() => {
            if (activeTab === 'cashbacks') window.CashbackAdmin?.render?.();
          });
        }
      });
      eventSource.addEventListener('ping', () => {});
      eventSource.onerror = () => {
        try {
          eventSource?.close();
        } catch {}
        reconnectTimer = window.setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      try {
        eventSource?.close();
      } catch {}
    };
  }, []);

  useEffect(() => {
    const timers = pagamentos
      .filter((item) => item.status === 'pago' && item.paidAt)
      .map((item) => {
        const deadline = new Date(item.paidAt || '').getTime() + 3 * 60 * 1000;
        const delay = deadline - Date.now();

        if (delay <= 0) {
          void deletePagamento(item.id, true);
          return null;
        }

        return window.setTimeout(() => {
          void deletePagamento(item.id, true);
        }, delay);
      })
      .filter((timer): timer is number => timer != null);

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [pagamentos]);

  useEffect(() => {
    if (!totaisPopup) return;

    const hide = () => setTotaisPopup(null);
    document.addEventListener('click', hide);
    return () => {
      document.removeEventListener('click', hide);
    };
  }, [totaisPopup]);

  useEffect(() => {
    if (!statusMenu) return;

    const hide = () => setStatusMenu(null);
    document.addEventListener('click', hide);
    return () => {
      document.removeEventListener('click', hide);
    };
  }, [statusMenu]);

  return (
    <>
      <style>{AREA_RUNTIME_CSS}</style>

      <header className="hero">
        <div className="hero-overlay" />
        <div className="hero-wrap">
          <img
            src={`/assets/img/banner-admin.svg?v=${ASSET_VERSION}`}
            alt="Banquinhas"
            className="hero-logo"
          />
          <div>
            <h1 className="hero-title">Banquinhas</h1>
          </div>
        </div>
      </header>

      <main className="layout">
        <aside className="sidebar">
          <div className="brand">
            <img
              src={`/assets/img/banner-admin.svg?v=${ASSET_VERSION}`}
              alt="Bancas"
              className="brand-img"
            />
            <strong>Bancas</strong>
          </div>

          <nav className="nav">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`nav-btn${activeTab === tab.id ? ' active' : ''}`}
                data-tab={tab.id}
                onClick={(event) => {
                  event.currentTarget.blur();
                  setActiveTabAndPersist(tab.id);
                }}
              >
                {tab.label}
              </button>
            ))}

            <button
              id="logoutBtn"
              className="btn btn--ghost"
              style={{ marginLeft: 'auto' }}
              type="button"
              onClick={() => {
                void handleLogout();
              }}
            >
              Sair
            </button>
          </nav>
        </aside>

        <section className="content">
          <div className={`tab tab-view${activeTab === 'bancas' ? ' show' : ''}`} id="tab-bancas">
            <div className="bar totbar">
              <input
                id="busca"
                className="input busca-nome"
                type="text"
                placeholder="Buscar por nome..."
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
              />

              <div className="totais">
                <button
                  type="button"
                  className="totais-pill"
                  id="btnAddBanca"
                  onClick={() => {
                    setAddBancaForm(INITIAL_ADD_BANCA_FORM);
                    setIsAddBancaOpen(true);
                  }}
                >
                  Adicionar banca
                </button>

                <button
                  type="button"
                  className="totais-pill"
                  id="totalDepositos"
                  data-total={formatMoney(totalDepositos)}
                  onClick={(event) => {
                    event.stopPropagation();
                    showTotais('depositos', event.currentTarget);
                  }}
                >
                  Soma dos Depósitos
                </button>

                <button
                  type="button"
                  className="totais-pill"
                  id="totalBancas"
                  data-total={formatMoney(totalBancas)}
                  onClick={(event) => {
                    event.stopPropagation();
                    showTotais('bancas', event.currentTarget);
                  }}
                >
                  Soma das Bancas
                </button>
              </div>
            </div>

            <div className="card">
              <div className="table-wrap">
                <table className="table" id="tblBancas" aria-label="Tabela de Bancas">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>Depósito (R$)</th>
                      <th>Banca (R$)</th>
                      <th className="col-acoes">
                        <div className="th-acoes">
                          <span>Ações</span>
                          <button
                            type="button"
                            id="btnDelAllBancas"
                            className="btn btn--danger btn--small"
                            onClick={() => {
                              void deleteAllBancas();
                            }}
                          >
                            Excluir todos
                          </button>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {!filteredBancas.length ? (
                      <tr>
                        <td colSpan={4} className="muted" style={{ padding: 14 }}>
                          Sem registros ainda.
                        </td>
                      </tr>
                    ) : null}

                    {filteredBancas.map((banca) => {
                      const hasMessage = !!banca.message?.trim();
                      return (
                        <tr key={banca.id} data-id={banca.id}>
                          <td>{banca.nome}</td>
                          <td>{formatMoney(banca.depositoCents)}</td>
                          <td>
                            <input
                              type="text"
                              className="input input-money"
                              data-role="banca"
                              data-id={banca.id}
                              placeholder="R$ 0,00"
                              value={bancaDrafts[banca.id] ?? ''}
                              onChange={(event) => {
                                setBancaDrafts((current) => ({
                                  ...current,
                                  [banca.id]: formatCurrencyInput(event.target.value)
                                }));
                              }}
                              onBlur={() => {
                                void saveBancaDraft(banca.id).catch((error) => {
                                  console.error(error);
                                  showToast('Erro ao salvar banca.', 'error');
                                });
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  event.currentTarget.blur();
                                }
                              }}
                            />
                          </td>
                          <td className="col-acoes">
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <button
                                className="btn btn--primary"
                                type="button"
                                data-action="to-pagamento"
                                data-id={banca.id}
                                onClick={() => {
                                  void handleToPagamento(banca.id);
                                }}
                              >
                                Pagamento
                              </button>
                              <button
                                className="btn"
                                type="button"
                                data-action="ver-msg"
                                data-id={banca.id}
                                disabled={!hasMessage}
                                onClick={() => setActiveMessage(banca.message || '(sem mensagem)')}
                              >
                                Ver mensagem
                              </button>
                              <button
                                className="btn btn--danger"
                                type="button"
                                data-action="del-banca"
                                data-id={banca.id}
                                onClick={() => {
                                  void deleteBanca(banca.id);
                                }}
                              >
                                Excluir
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div
            className={`tab tab-view${activeTab === 'pagamentos' ? ' show' : ''}`}
            id="tab-pagamentos"
          >
            <div className="card">
              <div className="table-wrap">
                <table className="table" id="tblPagamentos" aria-label="Tabela de Pagamentos">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>Pagamento (R$)</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!filteredPagamentos.length ? (
                      <tr>
                        <td colSpan={3} className="muted" style={{ padding: 14 }}>
                          Sem pagamentos ainda.
                        </td>
                      </tr>
                    ) : null}

                    {filteredPagamentos.map((pagamento) => {
                      const isPago = pagamento.status === 'pago';
                      return (
                        <tr key={pagamento.id} data-id={pagamento.id}>
                          <td>{pagamento.nome}</td>
                          <td>{formatMoney(pagamento.pagamentoCents)}</td>
                          <td className="col-acoes">
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <button
                                type="button"
                                className={`status-btn ${isPago ? 'status--pago' : 'status--nao'}`}
                                data-action="status-open"
                                data-id={pagamento.id}
                                data-status={pagamento.status}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  showStatusMenu(event.currentTarget, pagamento);
                                }}
                              >
                                {isPago ? 'Pago' : 'Não pago'} <span className="caret" />
                              </button>

                              <button
                                className="btn btn--primary"
                                type="button"
                                data-action="to-banca"
                                data-id={pagamento.id}
                                onClick={() => {
                                  void handleToBanca(pagamento.id);
                                }}
                              >
                                Bancas
                              </button>

                              <button
                                className="btn btn--primary"
                                type="button"
                                data-action="fazer-pix"
                                data-id={pagamento.id}
                                onClick={() => openPixModal(pagamento)}
                              >
                                Fazer PIX
                              </button>
                              <button
                                className="btn btn--danger"
                                type="button"
                                data-action="del-pag"
                                data-id={pagamento.id}
                                onClick={() => {
                                  void deletePagamento(pagamento.id);
                                }}
                              >
                                Excluir
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className={`tab tab-view${activeTab === 'extratos' ? ' show' : ''}`} id="tab-extratos">
            <div className="card extratos-card">
              <div className="bar extratos-bar">
                <div className="extratos-filtros-grid">
                  <div>
                    <label className="muted" htmlFor="filtro-tipo">
                      Tipo
                    </label>
                    <select
                      id="filtro-tipo"
                      className="input"
                      value={extratoFilters.tipo}
                      onChange={(event) =>
                        updateExtratoFilters({
                          ...extratoFilters,
                          tipo: event.target.value as ExtratoTipo
                        })
                      }
                    >
                      <option value="all">Todos</option>
                      <option value="deposito">Depósitos</option>
                      <option value="pagamento">Pagamentos</option>
                    </select>
                  </div>

                  <div>
                    <label className="muted" htmlFor="filtro-range">
                      Período
                    </label>
                    <select
                      id="filtro-range"
                      className="input"
                      value={extratoFilters.range}
                      onChange={(event) =>
                        updateExtratoFilters({
                          ...extratoFilters,
                          range: event.target.value as ExtratoRange
                        })
                      }
                    >
                      <option value="today">Hoje</option>
                      <option value="last7">Últimos 7 dias</option>
                      <option value="last30">Últimos 30 dias</option>
                      <option value="custom">Intervalo personalizado</option>
                    </select>
                  </div>

                  <div>
                    <label className="muted" htmlFor="filtro-from">
                      De
                    </label>
                    <input
                      id="filtro-from"
                      type="date"
                      className="input"
                      disabled={extratoFilters.range !== 'custom'}
                      value={extratoFilters.from}
                      onChange={(event) =>
                        setExtratoFilters({ ...extratoFilters, from: event.target.value })
                      }
                    />
                  </div>

                  <div>
                    <label className="muted" htmlFor="filtro-to">
                      Até
                    </label>
                    <input
                      id="filtro-to"
                      type="date"
                      className="input"
                      disabled={extratoFilters.range !== 'custom'}
                      value={extratoFilters.to}
                      onChange={(event) =>
                        setExtratoFilters({ ...extratoFilters, to: event.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="extratos-busca-acao">
                  <input
                    id="busca-extrato"
                    className="input"
                    type="text"
                    placeholder="Buscar por nome..."
                    value={buscaExtrato}
                    onChange={(event) => setBuscaExtrato(event.target.value)}
                  />
                  <button
                    id="btn-filtrar"
                    className="btn btn--primary"
                    type="button"
                    onClick={() => updateExtratoFilters(extratoFilters)}
                  >
                    Aplicar filtros
                  </button>
                  <button
                    id="btn-limpar"
                    className="btn btn--ghost"
                    type="button"
                    onClick={() => {
                      setBuscaExtrato('');
                      updateExtratoFilters(INITIAL_EXTRATO_FILTERS);
                    }}
                  >
                    Limpar
                  </button>
                </div>
              </div>

              <div className="extratos-cols">
                <div
                  className="extratos-col"
                  data-card="deps"
                  style={{ display: extratoFilters.tipo === 'pagamento' ? 'none' : undefined }}
                >
                  <h3>Depósitos</h3>
                  <div className="table-wrap">
                    <table
                      className="table"
                      id="tblExtratosDepositos"
                      aria-label="Extratos - Depósitos"
                    >
                      <thead>
                        <tr>
                          <th>Nome</th>
                          <th>Valor (R$)</th>
                          <th>Data</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!filteredExtratoDepositos.length ? (
                          <tr>
                            <td colSpan={3} className="muted" style={{ padding: 14 }}>
                              Sem depósitos ainda.
                            </td>
                          </tr>
                        ) : null}
                        {filteredExtratoDepositos.map((item) => (
                          <tr key={item.id}>
                            <td>{item.nome}</td>
                            <td>{formatMoney(item.valorCents)}</td>
                            <td>{formatDateTime(item.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div
                  className="extratos-col"
                  data-card="pags"
                  style={{ display: extratoFilters.tipo === 'deposito' ? 'none' : undefined }}
                >
                  <h3>Pagamentos</h3>
                  <div className="table-wrap">
                    <table
                      className="table"
                      id="tblExtratosPagamentos"
                      aria-label="Extratos - Pagamentos"
                    >
                      <thead>
                        <tr>
                          <th>Nome</th>
                          <th>Valor (R$)</th>
                          <th>Data</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!filteredExtratoPagamentos.length ? (
                          <tr>
                            <td colSpan={3} className="muted" style={{ padding: 14 }}>
                              Sem pagamentos ainda.
                            </td>
                          </tr>
                        ) : null}
                        {filteredExtratoPagamentos.map((item) => (
                          <tr key={item.id}>
                            <td>{item.nome}</td>
                            <td>{formatMoney(item.valorCents)}</td>
                            <td>{formatDateTime(item.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className={`tab tab-view${activeTab === 'sorteio' ? ' show' : ''}`} id="tab-sorteio">
            <SorteioPanel notify={showToast} />
          </div>
          <LegacyHtmlTab id="palpite" activeTab={activeTab} html={PALPITE_HTML} />
          <LegacyHtmlTab id="torneio" activeTab={activeTab} />
          <LegacyHtmlTab id="gorjeta" activeTab={activeTab} html={GORJETA_HTML} />
          <LegacyHtmlTab id="batalha-bonus" activeTab={activeTab} />
          <LegacyHtmlTab id="cashbacks" activeTab={activeTab} />
        </section>
      </main>

      {totaisPopup ? (
        <div
          id="totaisPopup"
          className="totais-popup show"
          style={{ top: totaisPopup.top, left: totaisPopup.left }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="totais-popup-header">
            <span className="totais-popup-title">
              {totaisPopup.kind === 'depositos' ? 'Soma dos Depósitos' : 'Soma das Bancas'}
            </span>
            <button
              type="button"
              className="totais-popup-close"
              aria-label="Fechar"
              onClick={() => setTotaisPopup(null)}
            >
              ×
            </button>
          </div>
          <p className="totais-popup-value">
            {totaisPopup.kind === 'depositos' ? formatMoney(totalDepositos) : formatMoney(totalBancas)}
          </p>
        </div>
      ) : null}

      {statusMenu ? (
        <div
          className="status-float show"
          style={{ top: statusMenu.top, left: statusMenu.left }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className={`status-item pago${statusMenu.current === 'pago' ? ' active' : ''}`}
            data-value="pago"
            type="button"
            onClick={() => {
              void setPagamentoStatus(statusMenu.id, 'pago');
              setStatusMenu(null);
            }}
          >
            Pago
          </button>
          <button
            className={`status-item nao${statusMenu.current === 'nao_pago' ? ' active' : ''}`}
            data-value="nao_pago"
            type="button"
            onClick={() => {
              void setPagamentoStatus(statusMenu.id, 'nao_pago');
              setStatusMenu(null);
            }}
          >
            Não pago
          </button>
        </div>
      ) : null}

      <div className={`toast${toast ? ` show toast--${toast.type}` : ''}`} id="toast">
        {toast?.message || ''}
      </div>

      <LegacyDialog id="msgModal" open={activeMessage != null} onClose={() => setActiveMessage(null)}>
        <div className="msg-modal-box">
          <h3>Mensagem</h3>
          <p id="msgText">{activeMessage || '(sem mensagem)'}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn--ghost" type="button" onClick={() => setActiveMessage(null)}>
              Fechar
            </button>
          </div>
        </div>
      </LegacyDialog>

      <LegacyDialog
        id="addBancaModal"
        open={isAddBancaOpen}
        onClose={() => setIsAddBancaOpen(false)}
      >
        <div className="add-banca-card">
          <div className="add-banca-header">
            <div>
              <h3 className="add-banca-title">Adicionar banca</h3>
              <p className="add-banca-sub">Crie uma banca manual informando depósito e PIX da pessoa.</p>
            </div>
            <button type="button" className="add-banca-close" onClick={() => setIsAddBancaOpen(false)}>
              &times;
            </button>
          </div>

          <form id="addBancaForm" className="add-banca-form" onSubmit={handleAddBancaSubmit}>
            <div className="add-banca-row">
              <div className="add-banca-field">
                <label className="muted" htmlFor="addBancaNome">
                  Nome
                </label>
                <input
                  id="addBancaNome"
                  className="input"
                  autoComplete="off"
                  placeholder="ex: dudufpss"
                  value={addBancaForm.nome}
                  onChange={(event) =>
                    setAddBancaForm((current) => ({ ...current, nome: event.target.value }))
                  }
                />
              </div>
              <div className="add-banca-field">
                <label className="muted" htmlFor="addBancaDeposito">
                  Depósito (R$)
                </label>
                <input
                  id="addBancaDeposito"
                  className="input"
                  autoComplete="off"
                  placeholder="ex: 50,00"
                  value={addBancaForm.deposito}
                  onChange={(event) =>
                    setAddBancaForm((current) => ({
                      ...current,
                      deposito: formatCurrencyInput(event.target.value)
                    }))
                  }
                />
              </div>
            </div>

            <div className="add-banca-field">
              <label className="muted" htmlFor="addPixType">
                PIX da pessoa
              </label>
              <div className="add-banca-pix-row">
                <select
                  id="addPixType"
                  className="input"
                  value={addBancaForm.pixType}
                  onChange={(event) => {
                    const pixType = event.target.value as AddBancaFormState['pixType'];
                    setAddBancaForm((current) => ({
                      ...current,
                      pixType,
                      pixKey:
                        pixType === 'cpf'
                          ? formatCpf(current.pixKey)
                          : pixType === 'phone'
                            ? formatPhoneBr(current.pixKey)
                            : current.pixKey
                    }));
                  }}
                >
                  <option value="">Tipo de chave</option>
                  <option value="email">E-mail</option>
                  <option value="cpf">CPF</option>
                  <option value="phone">Telefone</option>
                  <option value="random">Chave aleatória</option>
                </select>
                <input
                  id="addPixKey"
                  className="input"
                  autoComplete="off"
                  placeholder={
                    addBancaForm.pixType === 'email'
                      ? 'e-mail da pessoa'
                      : addBancaForm.pixType === 'cpf'
                        ? 'CPF (somente números)'
                        : addBancaForm.pixType === 'phone'
                          ? 'Telefone com DDD (somente números)'
                          : 'chave PIX (e-mail, CPF, tel.)'
                  }
                  value={addBancaForm.pixKey}
                  onChange={(event) => {
                    const rawValue = event.target.value;
                    setAddBancaForm((current) => ({
                      ...current,
                      pixKey:
                        current.pixType === 'cpf'
                          ? formatCpf(rawValue)
                          : current.pixType === 'phone'
                            ? formatPhoneBr(rawValue)
                            : rawValue
                    }));
                  }}
                />
              </div>
            </div>

            <div className="add-banca-actions">
              <button type="button" className="btn btn--ghost" onClick={() => setIsAddBancaOpen(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn--primary" disabled={isAddingBanca}>
                {isAddingBanca ? 'Salvando...' : 'Salvar banca'}
              </button>
            </div>
          </form>
        </div>
      </LegacyDialog>

      <LegacyDialog id="payPixModal" className="pix-modal" open={pixModal != null} onClose={() => setPixModal(null)}>
        <div className="pix-card">
          <h3 className="pix-title">Escaneie para pagar</h3>
          <div className="pix-qr-wrap">
            {pixModal ? <img id="payPixQr" className="pix-qr" src={pixModal.qrUrl} alt="QR Code Pix" /> : null}
          </div>
          <div className="pix-code">
            <input id="payPixEmv" className="pix-emv" readOnly value={pixModal?.emv || ''} />
            <button
              id="payPixCopy"
              className="btn btn--primary"
              type="button"
              onClick={() => {
                void copyPixCode();
              }}
            >
              Copiar
            </button>
          </div>
          <p className="pix-status" id="payPixHint">
            O valor já está preenchido. Após enviar, feche e marque como <strong>Pago</strong>.
          </p>
          <div className="pix-actions">
            <button id="payPixClose" className="btn btn--ghost" type="button" onClick={() => setPixModal(null)}>
              Fechar
            </button>
          </div>
          <span style={{ display: 'none' }}>{pixModal ? `${pixModal.nome}-${pixModal.valorCents}` : ''}</span>
        </div>
      </LegacyDialog>
    </>
  );
}
