import { type ReactNode, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { SorteioInscrito, SorteioState } from '../types';

type Notify = (message: string, type?: 'ok' | 'success' | 'error' | 'info' | string) => void;

const WHEEL_COLORS = [
  '#ffd76b',
  '#ffb366',
  '#ff8a80',
  '#ff9ecd',
  '#b39fff',
  '#7ecbff',
  '#80e8c2',
  '#c6ff8f'
];

function formatSorteioDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return `${date.toLocaleDateString('pt-BR')} ${date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  })}`;
}

function winnerIndexFromAngle(angleFinal: number, total: number): number {
  if (!total) return -1;
  const arc = (Math.PI * 2) / total;
  const pointerAngle = (3 * Math.PI) / 2;
  const twoPi = Math.PI * 2;
  let diff = pointerAngle - angleFinal;
  diff = ((diff % twoPi) + twoPi) % twoPi;
  return Math.floor(diff / arc) % total;
}

function Dialog(props: {
  id: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  const { id, open, onClose, children } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }

    if (!open && dialog.open) dialog.close();
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
      id={id}
      ref={dialogRef}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>
  );
}

export function SorteioPanel({ notify }: { notify: Notify }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const angleRef = useRef(0);
  const animationRef = useRef<number | null>(null);
  const inscritosRef = useRef<SorteioInscrito[]>([]);
  const [state, setState] = useState<SorteioState>({
    open: false,
    channelId: null,
    messageId: null
  });
  const [inscritos, setInscritos] = useState<SorteioInscrito[]>([]);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<SorteioInscrito | null>(null);
  const [winnerText, setWinnerText] = useState('Vencedor: —');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [idWinner, setIdWinner] = useState<SorteioInscrito | null>(null);
  const [winnerFlash, setWinnerFlash] = useState(false);

  function drawWheel(angle = angleRef.current): void {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const currentInscritos = inscritosRef.current;
    const width = canvas.width;
    const height = canvas.height;
    const cx = width / 2;
    const cy = height / 2;
    const outsideRadius = Math.min(width, height) / 2 - 10;
    const textRadius = outsideRadius - 24;
    const total = currentInscritos.length || 1;
    const arc = (Math.PI * 2) / total;

    ctx.clearRect(0, 0, width, height);

    for (let index = 0; index < total; index += 1) {
      const itemAngle = angle + index * arc;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, outsideRadius, itemAngle, itemAngle + arc, false);
      ctx.closePath();
      ctx.fillStyle = currentInscritos.length ? WHEEL_COLORS[index % WHEEL_COLORS.length] : '#333';
      ctx.fill();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(itemAngle + arc / 2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#111';
      ctx.font = '12px system-ui';
      ctx.fillText(currentInscritos[index]?.nome_twitch || 'Sem inscritos', textRadius, 4);
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, 55, 0, Math.PI * 2);
    ctx.fillStyle = '#061b10';
    ctx.fill();
    ctx.strokeStyle = 'rgba(34,224,122,.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#7CFFB3';
    ctx.font = 'bold 16px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('SORTEIO', cx, cy + 6);
  }

  async function loadState(silent = false): Promise<void> {
    try {
      const data = await apiFetch<SorteioState>('/api/sorteio/state');
      setState(data);
    } catch (error) {
      console.error('Erro ao buscar estado do sorteio:', error);
      if (!silent) notify('Erro ao buscar estado do sorteio.', 'error');
    }
  }

  async function loadInscritos(silent = false): Promise<void> {
    try {
      const data = await apiFetch<SorteioInscrito[]>('/api/sorteio/inscricoes');
      const next = Array.isArray(data) ? data : [];
      inscritosRef.current = next;
      setInscritos(next);
      drawWheel();

      if (!silent) notify('Lista de inscritos do sorteio atualizada.', 'ok');
    } catch (error) {
      console.error('Erro ao carregar inscritos do sorteio:', error);
      if (!silent) notify('Erro ao carregar inscritos do sorteio.', 'error');
    }
  }

  async function setSorteioOpen(open: boolean): Promise<void> {
    try {
      const data = await apiFetch<SorteioState>('/api/sorteio/state', {
        method: 'PATCH',
        body: JSON.stringify({ open })
      });
      setState(data);
      notify(open ? 'Sorteio aberto no Discord.' : 'Sorteio fechado no Discord.', 'ok');
    } catch (error) {
      console.error('Erro ao alterar estado do sorteio:', error);
      notify('Erro ao alterar estado do sorteio.', 'error');
    }
  }

  async function deleteInscrito(id: number): Promise<void> {
    if (!id) return;

    try {
      const data = await apiFetch<{ ok: true }>(`/api/sorteio/inscricoes/${id}`, {
        method: 'DELETE'
      });
      if (!data?.ok) throw new Error('Resposta inválida da API');

      const next = inscritosRef.current.filter((item) => item.id !== id);
      inscritosRef.current = next;
      setInscritos(next);
      drawWheel();
      notify('Inscrito removido do sorteio.', 'ok');
    } catch (error) {
      console.error('Erro ao excluir inscrito do sorteio:', error);
      notify('Erro ao excluir inscrito do sorteio.', 'error');
    }
  }

  async function clearInscritos(): Promise<void> {
    try {
      const data = await apiFetch<{ ok: true }>('/api/sorteio/inscricoes', {
        method: 'DELETE'
      });
      if (!data?.ok) throw new Error('Resposta inválida da API');

      inscritosRef.current = [];
      setInscritos([]);
      setWinner(null);
      setWinnerText('Vencedor: —');
      drawWheel();
      notify('Todas as inscrições do sorteio foram removidas.', 'ok');
    } catch (error) {
      console.error('Erro ao limpar inscrições do sorteio:', error);
      notify('Erro ao limpar inscrições do sorteio.', 'error');
    }
  }

  function spinWheel(): void {
    const currentInscritos = inscritosRef.current;
    if (spinning || !currentInscritos.length) return;

    setSpinning(true);
    setWinner(null);
    setWinnerText('Girando...');

    if (animationRef.current != null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    const twoPi = Math.PI * 2;
    const initialAngle = ((angleRef.current % twoPi) + twoPi) % twoPi;
    const finalAngle = initialAngle + (5 + Math.random() * 3) * twoPi + Math.random() * twoPi;
    const duration = 3500;
    const startTime = performance.now();

    const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);

    const step = (now: number) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = easeOutCubic(progress);
      const nextAngle = initialAngle + (finalAngle - initialAngle) * eased;
      angleRef.current = nextAngle;
      drawWheel(nextAngle);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(step);
        return;
      }

      animationRef.current = null;
      setSpinning(false);

      const normalized = ((angleRef.current % twoPi) + twoPi) % twoPi;
      angleRef.current = normalized;
      const winnerIndex = winnerIndexFromAngle(normalized, currentInscritos.length);
      const nextWinner = currentInscritos[winnerIndex] || null;

      setWinner(nextWinner);
      setWinnerText(nextWinner?.nome_twitch ? `Vencedor: ${nextWinner.nome_twitch}` : 'Vencedor: —');
      setWinnerFlash(false);
      window.requestAnimationFrame(() => setWinnerFlash(true));
      window.setTimeout(() => setWinnerFlash(false), 560);

      if (nextWinner?.nome_twitch) notify(`Vencedor: ${nextWinner.nome_twitch}`, 'ok');
    };

    animationRef.current = requestAnimationFrame(step);
  }

  async function copyWinnerId(): Promise<void> {
    const id = idWinner?.mensagem?.trim();
    if (!id) return;

    try {
      await navigator.clipboard.writeText(id);
      notify('ID copiado para a área de transferência.', 'ok');
    } catch (error) {
      console.error('Erro ao copiar ID:', error);
      notify('Não consegui copiar automaticamente.', 'error');
    }
  }

  async function refreshList(): Promise<void> {
    setIsRefreshing(true);
    try {
      await loadInscritos(false);
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    inscritosRef.current = inscritos;
    drawWheel();
  }, [inscritos]);

  useEffect(() => {
    void loadState(true);
    void loadInscritos(true);

    const eventSource = new EventSource('/api/stream');
    eventSource.addEventListener('sorteio-state', (event) => {
      try {
        const data = JSON.parse(event.data || '{}') as { open?: boolean };
        if (typeof data.open === 'boolean') {
          setState((current) => ({ ...current, open: !!data.open }));
        }
      } catch {}
    });

    return () => {
      if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
      eventSource.close();
    };
  }, []);

  const hasWinnerId = !!winner?.mensagem?.trim();

  return (
    <>
      <div className="card sorteio-header-card">
        <div className="sorteio-header-admin">
          <div>
            <h2>Sorteio da Live</h2>
            <div className="palpite-status-row">
              <span
                id="sorteioStatusBadge"
                className={`p-status ${state.open ? 'p-open' : 'p-closed'}`}
              >
                {state.open ? 'ABERTO' : 'FECHADO'}
              </span>
              <span id="sorteioStatusText" className="p-status-text">
                {state.open ? 'Inscrições abertas (Discord)' : 'Inscrições fechadas (Discord)'}
              </span>
            </div>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              Inscrições pelo Discord (bot).
            </p>
          </div>
          <div className="sorteio-actions">
            <button
              className="btn btn--primary"
              id="btnSorteioOpen"
              type="button"
              disabled={state.open}
              onClick={() => {
                void setSorteioOpen(true);
              }}
            >
              🟢 Abrir Sorteio
            </button>
            <button
              className="btn btn--ghost"
              id="btnSorteioClose"
              type="button"
              disabled={!state.open}
              onClick={() => {
                void setSorteioOpen(false);
              }}
            >
              🔴 Fechar Sorteio
            </button>
            <button
              id="btnSorteioAtualizar"
              className={`btn-soft${isRefreshing ? ' is-loading' : ''}`}
              type="button"
              onClick={() => {
                void refreshList();
              }}
            >
              Atualizar lista
            </button>
            <button
              id="btnSorteioLimpar"
              className="btn-soft danger"
              type="button"
              onClick={() => {
                if (!inscritos.length) {
                  notify('Não há inscrições para limpar.', 'error');
                  return;
                }
                setConfirmClearOpen(true);
              }}
            >
              Limpar todos
            </button>
          </div>
        </div>
      </div>

      <div className="sorteio-layout">
        <div className="card sorteio-wheel-card">
          <div className="wheel-wrapper">
            <canvas ref={canvasRef} id="sorteioWheel" width="500" height="500" />
            <div className="wheel-pointer" />
          </div>
          <button
            id="btnSorteioGirar"
            className={`btn-girar${spinning ? ' is-spinning' : ''}`}
            type="button"
            disabled={spinning || !inscritos.length}
            onClick={spinWheel}
          >
            Girar roleta
          </button>
          <div className={`winner-box${winnerFlash ? ' flash' : ''}`} id="sorteioWinnerBox">
            <span id="sorteioWinnerLabel">
              {winner?.nome_twitch ? (
                <>
                  Vencedor: <strong>{winner.nome_twitch}</strong>
                </>
              ) : (
                winnerText
              )}
            </span>
            <button
              id="btnSorteioVerCodigo"
              className="btn-soft btn-soft-mini"
              style={{ marginLeft: 8, display: hasWinnerId ? 'inline-block' : 'none' }}
              type="button"
              onClick={() => {
                if (!winner?.mensagem) {
                  notify('Nenhum ID disponível para este vencedor.', 'error');
                  return;
                }
                setIdWinner(winner);
              }}
            >
              Ver ID
            </button>
          </div>
        </div>

        <div className="card sorteio-list-card">
          <div className="sorteio-list-header">
            <span id="sorteioTotalInscritos">
              {inscritos.length} inscrito{inscritos.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="sorteio-list">
            <table className="table" aria-label="Inscritos no sorteio">
              <thead>
                <tr>
                  <th>Nome Twitch</th>
                  <th>Data</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody id="tbodySorteio">
                {inscritos.map((inscrito) => (
                  <tr key={inscrito.id}>
                    <td>{inscrito.nome_twitch}</td>
                    <td>{formatSorteioDate(inscrito.criado_em)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-mini-del"
                        onClick={() => {
                          void deleteInscrito(inscrito.id);
                        }}
                      >
                        Excluir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Dialog id="sorteioConfirmModal" open={confirmClearOpen} onClose={() => setConfirmClearOpen(false)}>
        <div className="sorteio-confirm-box">
          <h3 className="sorteio-confirm-title">Confirmar ação</h3>
          <p className="sorteio-confirm-text">
            Tem certeza que deseja apagar TODAS as inscrições do sorteio? Essa ação não pode ser desfeita.
          </p>
          <div className="sorteio-confirm-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setConfirmClearOpen(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                setConfirmClearOpen(false);
                void clearInscritos();
              }}
            >
              Apagar tudo
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog id="idModal" open={idWinner != null} onClose={() => setIdWinner(null)}>
        <div className="id-modal-box">
          <h3 style={{ margin: '0 0 6px', fontWeight: 800 }}>ID do vencedor</h3>
          <p style={{ margin: '0 0 4px', fontSize: '0.9rem', color: '#cfd2e8' }}>
            Use esse ID para confirmar com a pessoa na live.
          </p>
          <div className="id-modal-code">
            <div>
              <div className="id-modal-label">Nome Twitch</div>
              <div className="id-modal-value">{idWinner?.nome_twitch || '—'}</div>
            </div>
            <div>
              <div className="id-modal-label">ID</div>
              <div className="id-modal-value id-modal-value--code">{idWinner?.mensagem || '—'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="btn btn--ghost" onClick={() => setIdWinner(null)}>
              Fechar
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                void copyWinnerId();
              }}
            >
              Copiar ID
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
