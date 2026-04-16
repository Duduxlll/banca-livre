import { type FormEvent, useEffect, useState } from 'react';
import { Modal } from '../components/Modal';
import { PageCard } from '../components/PageCard';
import { SectionHeader } from '../components/SectionHeader';
import { useAdminStream } from '../hooks/useAdminStream';
import { apiFetch } from '../lib/api';
import {
  centsFromCurrencyInput,
  formatCpf,
  formatCurrencyInput,
  formatMoney,
  formatPhoneBr,
  normalizePixKeyByType
} from '../lib/format';
import { useToast } from '../providers/ToastProvider';
import type { Banca, PixType } from '../types';

interface AddBancaFormState {
  nome: string;
  deposito: string;
  pixType: '' | Exclude<PixType, null>;
  pixKey: string;
}

const INITIAL_FORM: AddBancaFormState = {
  nome: '',
  deposito: '',
  pixType: '',
  pixKey: ''
};

export function BancasPage(): JSX.Element {
  const { showToast } = useToast();
  const [bancas, setBancas] = useState<Banca[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [activeMessage, setActiveMessage] = useState<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [form, setForm] = useState<AddBancaFormState>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);

  async function loadBancas(): Promise<void> {
    const data = await apiFetch<Banca[]>('/api/bancas');
    setBancas(data);
    setDrafts((current) => {
      const next: Record<string, string> = {};
      data.forEach((item) => {
        next[item.id] =
          current[item.id] ??
          (typeof item.bancaCents === 'number' ? formatMoney(item.bancaCents) : '');
      });
      return next;
    });
    setLoading(false);
  }

  useEffect(() => {
    void loadBancas().catch((error) => {
      console.error(error);
      showToast('Erro ao carregar bancas.', 'error');
      setLoading(false);
    });
  }, []);

  useAdminStream(['bancas-changed'], () => {
    void loadBancas().catch((error) => {
      console.error(error);
    });
  });

  const visibleBancas = bancas.filter((item) =>
    item.nome.toLowerCase().includes(query.trim().toLowerCase())
  );
  const totalDepositos = bancas.reduce((sum, item) => sum + (item.depositoCents || 0), 0);
  const totalBancas = bancas.reduce((sum, item) => sum + (item.bancaCents || 0), 0);

  async function saveDraft(id: string): Promise<void> {
    const banca = bancas.find((item) => item.id === id);
    if (!banca) return;

    const bancaCents = centsFromCurrencyInput(drafts[id] || '');
    if ((banca.bancaCents || 0) === bancaCents) return;

    await apiFetch<Banca>(`/api/bancas/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ bancaCents })
    });
  }

  async function handleToPagamento(id: string): Promise<void> {
    try {
      await saveDraft(id);
      await apiFetch<{ ok: true }>(`/api/bancas/${encodeURIComponent(id)}/to-pagamento`, {
        method: 'POST'
      });
      await loadBancas();
      showToast('Banca movida para pagamentos.', 'success');
    } catch (error) {
      console.error(error);
      showToast('Não foi possível mover para pagamentos.', 'error');
    }
  }

  async function handleDelete(id: string): Promise<void> {
    const confirmed = window.confirm('Deseja excluir essa banca?');
    if (!confirmed) return;

    try {
      await apiFetch<{ ok: true }>(`/api/bancas/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      await loadBancas();
      showToast('Banca excluída.', 'success');
    } catch (error) {
      console.error(error);
      showToast('Não foi possível excluir a banca.', 'error');
    }
  }

  async function handleDeleteAll(): Promise<void> {
    if (!bancas.length) {
      showToast('Não há bancas para excluir.', 'info');
      return;
    }

    const confirmed = window.confirm(
      `Tem certeza que deseja excluir todas as ${bancas.length} bancas?`
    );
    if (!confirmed) return;

    try {
      await Promise.all(
        bancas.map((item) =>
          apiFetch<{ ok: true }>(`/api/bancas/${encodeURIComponent(item.id)}`, {
            method: 'DELETE'
          })
        )
      );
      await loadBancas();
      showToast('Todas as bancas foram excluídas.', 'success');
    } catch (error) {
      console.error(error);
      showToast('Não foi possível excluir todas as bancas.', 'error');
    }
  }

  function handleDraftChange(id: string, rawValue: string): void {
    setDrafts((current) => ({
      ...current,
      [id]: formatCurrencyInput(rawValue)
    }));
  }

  function handlePixTypeChange(value: AddBancaFormState['pixType']): void {
    setForm((current) => ({
      ...current,
      pixType: value,
      pixKey:
        value === 'cpf'
          ? formatCpf(current.pixKey)
          : value === 'phone'
            ? formatPhoneBr(current.pixKey)
            : current.pixKey
    }));
  }

  function handlePixKeyChange(rawValue: string): void {
    setForm((current) => {
      if (current.pixType === 'cpf') {
        return { ...current, pixKey: formatCpf(rawValue) };
      }
      if (current.pixType === 'phone') {
        return { ...current, pixKey: formatPhoneBr(rawValue) };
      }
      return { ...current, pixKey: rawValue };
    });
  }

  async function handleAddSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const depositoCents = centsFromCurrencyInput(form.deposito);
    const nome = form.nome.trim();
    const pixKey = normalizePixKeyByType(form.pixType, form.pixKey);

    if (!nome || !depositoCents) {
      showToast('Preencha nome e depósito.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch<Banca>('/api/bancas/manual', {
        method: 'POST',
        body: JSON.stringify({
          nome,
          depositoCents,
          pixType: form.pixType || null,
          pixKey: pixKey || null
        })
      });

      setForm(INITIAL_FORM);
      setIsAddOpen(false);
      await loadBancas();
      showToast('Banca adicionada com sucesso.', 'success');
    } catch (error) {
      console.error(error);
      showToast('Erro ao criar banca manual.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <SectionHeader
        title="Bancas"
        description="Aqui já está rodando em React. Você pode adicionar bancas manuais, ajustar valores e enviar para pagamentos usando as APIs atuais."
        actions={
          <div className="header-actions">
            <button type="button" className="btn btn--ghost" onClick={handleDeleteAll}>
              Excluir todas
            </button>
            <button type="button" className="btn btn--primary" onClick={() => setIsAddOpen(true)}>
              Adicionar banca
            </button>
          </div>
        }
      />

      <div className="metric-grid">
        <article className="metric-card">
          <span>Depósitos</span>
          <strong>{formatMoney(totalDepositos)}</strong>
        </article>
        <article className="metric-card">
          <span>Bancas</span>
          <strong>{formatMoney(totalBancas)}</strong>
        </article>
      </div>

      <PageCard
        title="Lista ativa"
        subtitle="Os dados continuam vindo do mesmo backend atual."
        actions={
          <input
            className="input search-input"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome..."
          />
        }
      >
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Depósito</th>
                <th>Banca</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {!loading && !visibleBancas.length ? (
                <tr>
                  <td colSpan={4}>
                    <div className="empty-state">Sem bancas para mostrar.</div>
                  </td>
                </tr>
              ) : null}

              {visibleBancas.map((item) => {
                const hasMessage = !!item.message?.trim();
                return (
                  <tr key={item.id}>
                    <td>{item.nome}</td>
                    <td>{formatMoney(item.depositoCents)}</td>
                    <td>
                      <input
                        className="input table-money-input"
                        type="text"
                        value={drafts[item.id] ?? ''}
                        onChange={(event) => handleDraftChange(item.id, event.target.value)}
                        onBlur={() => {
                          void saveDraft(item.id).catch((error) => {
                            console.error(error);
                            showToast('Erro ao salvar banca.', 'error');
                          });
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.currentTarget.blur();
                          }
                        }}
                        placeholder="R$ 0,00"
                      />
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          type="button"
                          className="btn btn--primary"
                          onClick={() => {
                            void handleToPagamento(item.id);
                          }}
                        >
                          Pagamento
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost"
                          disabled={!hasMessage}
                          onClick={() => setActiveMessage(item.message || '(sem mensagem)')}
                        >
                          Ver mensagem
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger"
                          onClick={() => {
                            void handleDelete(item.id);
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
      </PageCard>

      <Modal open={!!activeMessage} title="Mensagem" onClose={() => setActiveMessage(null)}>
        <div className="stack-gap">
          <p className="muted-block">{activeMessage}</p>
          <div className="modal-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setActiveMessage(null)}>
              Fechar
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={isAddOpen} title="Adicionar banca" onClose={() => setIsAddOpen(false)} size="wide">
        <form className="form-grid" onSubmit={handleAddSubmit}>
          <label className="field">
            <span>Nome</span>
            <input
              className="input"
              type="text"
              value={form.nome}
              onChange={(event) => setForm((current) => ({ ...current, nome: event.target.value }))}
              placeholder="ex: dudufpss"
            />
          </label>

          <label className="field">
            <span>Depósito (R$)</span>
            <input
              className="input"
              type="text"
              value={form.deposito}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  deposito: formatCurrencyInput(event.target.value)
                }))
              }
              placeholder="ex: 50,00"
            />
          </label>

          <label className="field">
            <span>Tipo de chave PIX</span>
            <select
              className="input"
              value={form.pixType}
              onChange={(event) => handlePixTypeChange(event.target.value as AddBancaFormState['pixType'])}
            >
              <option value="">Tipo de chave</option>
              <option value="email">E-mail</option>
              <option value="cpf">CPF</option>
              <option value="phone">Telefone</option>
              <option value="random">Chave aleatória</option>
            </select>
          </label>

          <label className="field field--full">
            <span>Chave PIX</span>
            <input
              className="input"
              type="text"
              value={form.pixKey}
              onChange={(event) => handlePixKeyChange(event.target.value)}
              placeholder="e-mail, CPF, telefone ou chave aleatória"
            />
          </label>

          <div className="modal-actions modal-actions--full">
            <button type="button" className="btn btn--ghost" onClick={() => setIsAddOpen(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? 'Salvando...' : 'Salvar banca'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
