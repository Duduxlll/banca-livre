import { useEffect, useState } from 'react';
import { Modal } from '../components/Modal';
import { PageCard } from '../components/PageCard';
import { SectionHeader } from '../components/SectionHeader';
import { useAdminStream } from '../hooks/useAdminStream';
import { apiFetch } from '../lib/api';
import { formatDateTime, formatMoney } from '../lib/format';
import { buildPixPayload } from '../lib/pix';
import { useToast } from '../providers/ToastProvider';
import type { Pagamento } from '../types';

interface PixModalState {
  nome: string;
  valorCents: number;
  emv: string;
  qrUrl: string;
}

export function PagamentosPage(): JSX.Element {
  const { showToast } = useToast();
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [activeMessage, setActiveMessage] = useState<string | null>(null);
  const [pixModal, setPixModal] = useState<PixModalState | null>(null);

  async function loadPagamentos(): Promise<void> {
    const data = await apiFetch<Pagamento[]>('/api/pagamentos');
    setPagamentos(data);
    setLoading(false);
  }

  useEffect(() => {
    void loadPagamentos().catch((error) => {
      console.error(error);
      showToast('Erro ao carregar pagamentos.', 'error');
      setLoading(false);
    });
  }, []);

  useAdminStream(['pagamentos-changed'], () => {
    void loadPagamentos().catch((error) => {
      console.error(error);
    });
  });

  useEffect(() => {
    const timers = pagamentos
      .filter((item) => item.status === 'pago' && item.paidAt)
      .map((item) => {
        const deadline = new Date(item.paidAt || '').getTime() + 3 * 60 * 1000;
        const delay = deadline - Date.now();

        if (delay <= 0) {
          void handleDelete(item.id, true);
          return null;
        }

        return window.setTimeout(() => {
          void handleDelete(item.id, true);
        }, delay);
      })
      .filter((timer): timer is number => timer != null);

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [pagamentos]);

  const visiblePagamentos = pagamentos.filter((item) =>
    item.nome.toLowerCase().includes(query.trim().toLowerCase())
  );

  async function handleSetStatus(id: string, status: Pagamento['status']): Promise<void> {
    try {
      await apiFetch<Pagamento>(`/api/pagamentos/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      await loadPagamentos();
      showToast('Status atualizado.', 'success');
    } catch (error) {
      console.error(error);
      showToast('Não foi possível atualizar o status.', 'error');
    }
  }

  async function handleToBanca(id: string): Promise<void> {
    try {
      await apiFetch<{ ok: true }>(`/api/pagamentos/${encodeURIComponent(id)}/to-banca`, {
        method: 'POST'
      });
      await loadPagamentos();
      showToast('Pagamento enviado de volta para bancas.', 'success');
    } catch (error) {
      console.error(error);
      showToast('Não foi possível voltar esse item para bancas.', 'error');
    }
  }

  async function handleDelete(id: string, silent = false): Promise<void> {
    try {
      await apiFetch<{ ok: true }>(`/api/pagamentos/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      await loadPagamentos();
      if (!silent) {
        showToast('Pagamento excluído.', 'success');
      }
    } catch (error) {
      console.error(error);
      if (!silent) {
        showToast('Não foi possível excluir o pagamento.', 'error');
      }
    }
  }

  async function handleOpenPix(item: Pagamento): Promise<void> {
    if (!item.pixKey) {
      showToast('Esse pagamento não tem chave PIX cadastrada.', 'error');
      return;
    }

    const emv = buildPixPayload({
      chave: item.pixKey,
      valorCents: item.pagamentoCents,
      nome: item.nome,
      tipo: item.pixType
    });

    const qrUrl = `/qr?size=240&data=${encodeURIComponent(emv)}`;
    setPixModal({
      nome: item.nome,
      valorCents: item.pagamentoCents,
      emv,
      qrUrl
    });
  }

  async function copyPixCode(): Promise<void> {
    if (!pixModal?.emv) return;
    try {
      await navigator.clipboard.writeText(pixModal.emv);
      showToast('Código PIX copiado.', 'success');
    } catch (error) {
      console.error(error);
      showToast('Não foi possível copiar o código PIX.', 'error');
    }
  }

  return (
    <>
      <SectionHeader
        title="Pagamentos"
        description="Status, QR do PIX e retorno para bancas já estão rodando na interface principal."
      />

      <PageCard
        title="Fila de pagamentos"
        subtitle="Os pagamentos marcados como pagos continuam sendo apagados automaticamente depois de 3 minutos, igual ao comportamento anterior."
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
                <th>Valor</th>
                <th>Status</th>
                <th>Pago em</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {!loading && !visiblePagamentos.length ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">Sem pagamentos para mostrar.</div>
                  </td>
                </tr>
              ) : null}

              {visiblePagamentos.map((item) => (
                <tr key={item.id}>
                  <td>{item.nome}</td>
                  <td>{formatMoney(item.pagamentoCents)}</td>
                  <td>
                    <select
                      className={`status-select ${
                        item.status === 'pago' ? 'status-select--paid' : 'status-select--pending'
                      }`}
                      value={item.status}
                      onChange={(event) => {
                        void handleSetStatus(
                          item.id,
                          event.target.value as Pagamento['status']
                        );
                      }}
                    >
                      <option value="nao_pago">Não pago</option>
                      <option value="pago">Pago</option>
                    </select>
                  </td>
                  <td>{formatDateTime(item.paidAt)}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => {
                          void handleToBanca(item.id);
                        }}
                      >
                        Bancas
                      </button>
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => {
                          void handleOpenPix(item);
                        }}
                      >
                        Fazer PIX
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={!item.message?.trim()}
                        onClick={() => setActiveMessage(item.message || '(sem mensagem)')}
                      >
                        Ver mensagem
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger"
                        onClick={() => {
                          const confirmed = window.confirm('Deseja excluir esse pagamento?');
                          if (confirmed) {
                            void handleDelete(item.id);
                          }
                        }}
                      >
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
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

      <Modal open={!!pixModal} title="Fazer PIX" onClose={() => setPixModal(null)}>
        <div className="stack-gap">
          <div className="pix-summary">
            <strong>{pixModal?.nome}</strong>
            <span>{formatMoney(pixModal?.valorCents || 0)}</span>
          </div>

          <div className="pix-qr-wrap">
            {pixModal ? <img src={pixModal.qrUrl} alt="QR Code PIX" className="pix-qr" /> : null}
          </div>

          <label className="field">
            <span>Código copia e cola</span>
            <textarea className="input code-input" readOnly value={pixModal?.emv || ''} />
          </label>

          <div className="modal-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setPixModal(null)}>
              Fechar
            </button>
            <button type="button" className="btn btn--primary" onClick={() => void copyPixCode()}>
              Copiar código
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
